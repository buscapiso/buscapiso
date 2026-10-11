# Cualquier ciudad de España

Fecha: 2026-10-11 · Proyecto B de la spec web + extensión

## Qué cambia

Hasta ahora buscapiso solo buscaba en Barcelona, con una lista de zonas hecha
a mano (`barcelona.json`). Ahora se puede elegir cualquier municipio en
Ajustes → Search. La app pregunta a cada portal cómo lo llama y qué distritos
tiene, y guarda el resultado con el mismo formato que Barcelona.

## De dónde salen los nombres

Ningún portal publica una lista de municipios aparte, pero todos la llevan en
sus páginas de búsqueda:

| Portal | Dónde | Qué da |
|---|---|---|
| Fotocasa | JSON incrustado (`combinedLocationIds`, `locationFacets`) | municipio con su código INE, distritos, municipios de una comarca |
| Habitaclia | `__INITIAL_PROPS__` (`geography`, `GEOGRAPHY_SONS`, `GEOGRAPHY_SAME_LEVEL`) | el mismo árbol, con la ruta canónica y los municipios vecinos |
| Idealista | desplegable de la barra de migas | el municipio y sus distritos |
| Roomgo | `/{provincia}/piso-compartido-{ciudad}` | redirige a la portada si no tiene la ciudad |
| De Piso en Piso | `find-places.php?city=` | lista vacía si no tiene la ciudad |

Fotocasa y Habitaclia son de la misma empresa: comparten identificadores (el
sexto es el código INE) y el trozo de URL del municipio (`granada-capital`,
`armilla`).

## Cómo se descubre una ciudad

1. Nominatim da los candidatos. La provincia sale del código ISO 3166-2
   (`ES-BI` → Vizcaya), porque Nominatim no siempre trae `province`.
2. Fotocasa: se prueba `{nombre}-capital` y `{nombre}`, con el nombre entero
   y cada variante (`donostia-san-sebastian`, `donostia`). La página vale si
   dice que es un municipio con ese nombre.
3. Habitaclia: el mismo trozo bajo cada nombre de la provincia, incluidos los
   locales (`gipuzkoa-provincia`). Habitaclia contesta 200 con otra zona
   cuando no existe la pedida, así que se comprueba que la página sea un
   municipio con el mismo código INE. Si la regla falla, se baja desde la
   provincia por las comarcas.
4. Idealista: `{nombre}-{provincia}`, comprobado con la barra de migas. Es el
   único que puede abrir una pestaña, por su captcha.
5. Zonas: los distritos de los tres portales, casados por nombre, y hasta 12
   municipios vecinos de Habitaclia a menos de 15 km. Un distrito que un
   portal no nombra igual se busca en ese portal con la ciudad entera. Sin
   distritos, la ciudad es una sola zona.

Todo pasa por la extensión, desde el navegador de cada persona. Sin ella, la
pantalla explica que hace falta. Barcelona sigue usando su lista hecha a mano.

## Datos

- `City` añade `province`, `center`, `catalanStreets` y `portals` (la ciudad
  entera en cada portal). En Habitaclia la ruta lleva la provincia delante.
- Las ciudades descubiertas van al almacén `cities` de IndexedDB (versión 2).
- La clave de una ciudad es `{nombre}-{provincia}` (`granada-granada`). Los
  anuncios ya se guardaban por ciudad.
- Las calles se buscan en catalán ("Carrer") solo en las cuatro provincias
  catalanas.

## Comprobado

Con `fetch` directo contra los portales reales (sin Idealista, que bloquea
fuera de un navegador): Madrid, Bilbao, l'Hospitalet de Llobregat, València,
Donostia / San Sebastián y Salamanca se descubren en Fotocasa y Habitaclia
con sus distritos, con entre 4 y 12 peticiones. Idealista queda por probar
con la extensión.
