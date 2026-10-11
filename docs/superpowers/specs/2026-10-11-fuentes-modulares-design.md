# Fuentes modulares, y Badi, pisos.com, HousingAnywhere y Spotahome

Fecha: 2026-10-11

## Por qué

Añadir un portal hoy toca unos diez archivos fuera de `engine/sources/`: los
campos por portal de `City` y `Area`, las listas `ROOM_SOURCES` y
`FLAT_SOURCES`, la copia de esas listas en `CriteriaBar.svelte`, el
descubrimiento de ciudades, `barcelona.json` y el caso especial de Idealista en
`pipeline.ts`. Además, el contrato `Source` describe un método (páginas HTML
numeradas): el bucle de páginas, las reglas de parada y la detección de
bloqueos viven en el pipeline. Un portal con API JSON, como Badi, tendría que
fingir que es HTML paginado.

Objetivo: añadir un portal es un archivo en `sources/`, sus fixtures y una
línea en el registro. Nada más del motor ni de la interfaz cambia.

## El contrato

```ts
interface Source {
  name: string; label: string; types: ListingType[];
  net: NetRules;                // pausa, marcas de bloqueo y de veto, minLength, direct
  search(q: SearchQuery, net: Net): AsyncIterable<Batch>;
  planned?(q: SearchQuery): number;
  detail?(l: RawListing, net: Net): Promise<Partial<RawListing>>;
  details?: 'all' | 'best';     // 'all': sin la ficha el anuncio no sirve
  discover?(ctx: DiscoverCtx): Promise<Coverage | null>;
  retryDiscover?: boolean;      // segunda vuelta con lo que dejaron las demas
  fillZone?(zone): string | null;
}
```

- `search` decide cómo pedir, cuándo pasar de página y cuándo parar. Entrega
  lotes (`{ listings, label }`) que el pipeline deduplica, cuenta y enseña.
- `Net` (`engine/net.ts`) envuelve la extensión, o `fetch` directo si el
  portal o una petición concreta admite CORS. Aplica las `NetRules` de la
  fuente (pausa entre peticiones, bloqueo, veto) y lanza `NetError` con el
  motivo. El pipeline lo trata en un solo sitio, con los mismos avisos que
  antes, más uno para una extensión antigua (`not-allowed`).
- `pagedHtml({ listUrl, parseList, pageSize, ... })` reproduce el bucle de
  páginas de siempre. Las cinco fuentes de antes lo usan sin cambiar sus
  parsers; las nuevas escriben su propio `search`.
- El registro (`sources/index.ts`) es la única lista de portales. Las listas
  de habitaciones y pisos, la barra de criterios, los ajustes y la ficha
  salen de ahí.
- Los ajustes propios de un portal que ya existían (filtros de Idealista,
  orden de Fotocasa) se quedan en el perfil, como estaban.

## Ciudades y zonas

`City.portals` sigue siendo un mapa por portal, ahora `Record<id, string |
null>`, y cada zona lleva `portals` en vez de un campo por portal. Lo que hay
dentro solo lo lee la fuente que lo escribió.

`discover` de cada fuente devuelve `{ ref, zones?, note? }`, donde cada zona
es `{ label, town, ref, count }`. Las fuentes se descubren en el orden del
registro (Fotocasa, Habitaclia, Idealista...) y cada una recibe los *hechos*
que dejaron las anteriores (`ctx.facts`): Habitaclia usa el código INE y el
trozo de URL de Fotocasa. Fotocasa vuelve a probar al final con el trozo de
Habitaclia (`retryDiscover`) y nombra los pueblos que encontró Habitaclia
(`fillZone`). `cities/discover.ts` se queda con lo común: juntar zonas por
nombre, situarlas en el mapa, la caja y las notas por portal.

Las ciudades descubiertas antes se convierten al leerlas (`upgradeCity`) y,
antes de la primera búsqueda, se pregunta solo a los portales que no
conocían (`discoverMissing`). `barcelona.json` se convirtió a mano. Los
anuncios guardados no cambian: `source` sigue siendo el id.

Los perfiles recuerdan qué portales existían (`known_sources`): uno nuevo se
añade encendido una vez, y uno que la persona apaga sigue apagado.

## Portales nuevos

| Portal | Qué tiene | Cómo se lee |
|---|---|---|
| pisos.com | habitaciones y pisos | HTML paginado (`ad-preview`), directo: admite CORS |
| HousingAnywhere | habitaciones y pisos a medio plazo | la clave pública de Algolia sale de su página (extensión); Algolia, directo |
| Spotahome | habitaciones y pisos a medio plazo | API pública: puntos del mapa y fichas de 40 en 40 (extensión) |
| Badi | habitaciones y algún piso | token de invitado de badi.com; su API por la extensión, zona a zona: sin cuenta da dos páginas por búsqueda |

Ninguno exige iniciar sesión. HousingAnywhere y Spotahome rellenan
`minStayMonths` y `availableFrom`, que el perfil ya filtra; HousingAnywhere
dice además si se puede empadronar y si el piso es solo de chicas o chicos.

Los dominios nuevos van a `host_permissions` de la extensión, versión 1.1.0.
Las peticiones a APIs (con método, cabeceras o cuerpo) salen sin las cookies
de la persona: un POST con su sesión podría actuar en su cuenta.

## Errores

Una fuente que falla no tumba la búsqueda: el pipeline guarda lo que llegó y
avisa, como ahora. Un parser que no encuentra anuncios en una página que no es
de bloqueo devuelve un lote vacío; el aviso "0 listings" sale igual que hoy.

## Pruebas

- Los tests y golden actuales de las cinco fuentes pasan sin cambios: prueban
  que la migración no cambia nada.
- Cada portal nuevo tiene una página de ejemplo en `__fixtures__` y su test de
  parser.
- Un test de contrato recorre el registro: cada fuente entrega anuncios con
  `source === id`, URL, y precio o null.
- Tests de la conversión de ciudades guardadas y de los perfiles guardados.
- Una prueba en vivo desde Node (no queda en el repo) con Barcelona y Granada.

## Fuera de alcance

Frescura (comprobaciones frecuentes, búsquedas sin pestaña abierta) y
Milanuncios, por su antibots.
