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
  id: string; label: string; types: ListingType[];
  hosts: string[];              // lo que la extensión debe poder leer
  net: NetRules;                // pausa, marcas de bloqueo y de veto, minLength, direct
  discover(c: CityCandidate, ctx: DiscoverCtx): Promise<Coverage | null>;
  search(q: SearchQuery, net: Net): AsyncIterable<Batch>;
  detail?(l: RawListing, net: Net): Promise<Partial<RawListing>>;
  details?: 'all' | 'best';     // 'all': sin la ficha el anuncio no sirve
}
```

- `search` decide cómo pedir, cuándo pasar de página y cuándo parar. Entrega
  lotes (`{ listings, label }`) que el pipeline deduplica, cuenta y enseña.
- `Net` envuelve la extensión, o `fetch` directo si el portal admite CORS.
  Aplica las `NetRules` de la fuente (pausa entre peticiones, bloqueo, veto) y
  lanza `Blocked`, `Banned`, `Cancelled` o `NoExtension`. El pipeline los trata
  en un solo sitio, con los mismos avisos que ahora.
- Dos ayudas cubren los casos comunes: `pagedHtml({ listUrl, parseList,
  pageSize, totalPages?, shouldStop? })` reproduce el bucle actual y
  `embeddedJson` lee el JSON que la página lleva dentro. Las cinco fuentes
  actuales pasan a `pagedHtml` sin cambiar sus parsers.
- El registro (`SOURCES`, en orden) es la única lista de portales. Las listas
  de habitaciones y pisos, la barra de criterios y los ajustes salen de `types`.

## Ciudades y zonas

`City.portals` pasa a `City.sources: Record<id, unknown>` y cada zona lleva
`refs: Record<id, unknown>` en vez de un campo por portal. Lo que hay dentro
solo lo lee la fuente que lo escribió.

`discover` de cada fuente devuelve `{ city, zones }`, donde cada zona es
`{ label, town, ref, count }`. Las fuentes se descubren en el orden del
registro y cada una recibe los *hechos* que dejaron las anteriores
(`ctx.facts`): Habitaclia usa el código INE y el trozo de URL de Fotocasa.
`cities/discover.ts` se queda con lo común: juntar zonas por nombre,
situarlas en el mapa, la caja y las notas por portal.

Las ciudades guardadas (`barcelona.json` y las descubiertas, en IndexedDB) se
convierten al leerlas: `portals.X` pasa a `sources.X` y `area.X` a
`area.refs.X`. Los anuncios guardados no cambian: `source` sigue siendo el id.

## Portales nuevos

| Portal | Qué tiene | Cómo se lee |
|---|---|---|
| pisos.com | habitaciones y pisos | HTML paginado (`ad-preview`), sin antibots |
| HousingAnywhere | habitaciones y pisos a medio plazo | JSON incrustado (`__CACHED_DATA__`) o su API de búsqueda |
| Spotahome | habitaciones y pisos a medio plazo | JSON incrustado de React Router |
| Badi | habitaciones | API JSON (`api.badiapp.com`) |

HousingAnywhere y Spotahome rellenan `minStayMonths` y `availableFrom`, que el
perfil ya filtra (`move_in`, `stay_months`). Badi se empieza con una prueba en
un navegador real para encontrar su búsqueda; si exige iniciar sesión, se
para y se pregunta.

Los dominios nuevos van a `host_permissions` de la extensión, que necesita una
versión nueva (zip de Chrome y xpi firmado de Firefox).

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
  `source === id`, URL, y precio o null, y declara sus `hosts`.
- Un test de la conversión de ciudades guardadas al formato nuevo.

## Fuera de alcance

Frescura (comprobaciones frecuentes, búsquedas sin pestaña abierta) y
Milanuncios, por su antibots.
