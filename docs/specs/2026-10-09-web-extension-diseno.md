# buscapiso en el navegador: web estática + extensión

Fecha: 2026-10-09 · Proyecto A de dos (el B es «cualquier ciudad de España»)

## Objetivo

Que cualquiera pueda usar buscapiso enviándole un enlace, sin instalar una
aplicación de escritorio ni saber nada técnico. La web hace todo lo que hace
hoy la app (puntuar, tiempos de trayecto, notas y estados, IA opcional,
avisos), y una extensión del navegador lee los portales desde el navegador de
cada persona, con su IP y sus cookies.

Público: primero amistades (5 a 30 personas, con el enlace enviado por mí),
sin cerrar la puerta a una herramienta pública más adelante.

### Fuera de este proyecto

- Ciudades distintas de Barcelona. El diseño trata la ciudad como un
  parámetro en todas partes, pero el catálogo de ciudades y zonas es el
  proyecto B.
- Buscar desde iPad o iPhone. Allí la web funciona entera salvo el botón de
  buscar, y los anuncios llegan importando un fichero.
- Sincronizar entre dispositivos, cuentas de usuario y cualquier servidor
  propio.
- Badi (ver «Trabajo futuro»).

## Decisiones tomadas

| Tema | Decisión | Motivo |
|---|---|---|
| Dónde se lee cada portal | Extensión (Manifest V3) en el navegador de cada persona | Una página web no puede leer otras webs (misma procedencia, CORS); un servidor en un centro de datos lo bloquearía DataDome y obligaría a redistribuir anuncios |
| Dónde corre el motor | En la página, en TypeScript | El iPad no tiene extensión y aun así tiene que puntuar y calcular trayectos |
| Servidor | Ninguno. Web estática en GitHub Pages | Gratis, sin datos de nadie en mis manos |
| Datos | IndexedDB de cada navegador | Lo mismo |
| Trayectos | Transitous por defecto, sin configurar nada; Google con clave propia y MOTIS propio como opciones | Transitous cubre España (184 fuentes) y admite peticiones desde el navegador (`access-control-allow-origin: *`) |
| Móviles | Escritorio (Chrome, Edge, Firefox, Brave...) y Firefox para Android buscan. iPad, iPhone y Chrome para Android importan | Chrome para Android no tiene extensiones; Safari las exige dentro de una app de la App Store (99 €/año) |
| App de escritorio | Se retira. La v0.3.0 (con el PR #10) es la última | Mantener dos versiones obliga a arreglar cada cambio de portal dos veces |
| Migrar datos del escritorio | No | Solo hay una usuaria, y prefiere empezar de cero |
| Origen de la web | `https://buscapiso.github.io` (organización de GitHub `buscapiso`, gratuita) | El origen va dentro de la extensión y lo revisan las tiendas; cambiarlo luego exige actualizarla |

## Arquitectura

```
┌──────────────── web de buscapiso (estática, GitHub Pages) ─────────────────┐
│  UI en Svelte (las pantallas de hoy)                                       │
│     │  mismas firmas que el api.ts actual                                  │
│  api.ts ── fachada ──► engine/ (TypeScript, funciones puras)               │
│                          parsers · dedupe · ranking · coverage · pipeline  │
│                        store/ (IndexedDB)                                  │
│                        services/ (llamados desde el navegador)             │
│                          Transitous · Google Routes · Nominatim · ntfy · IA│
│     │ window.postMessage                                                   │
├─────┼──────────────────────────────────────────────────────────────────────┤
│  content script «puente» (solo se inyecta en la web de buscapiso)          │
└─────┼──────────────────────────────────────────────────────────────────────┘
      │ mensajes de runtime
┌─────▼──────── extensión buscapiso (MV3: Chrome, Edge, Firefox) ────────────┐
│  fetcher: «dame el HTML de la URL X»                                       │
│    1. fetch() en segundo plano con las cookies de la persona               │
│    2. si sale captcha → pestaña real, espera (quizá lo resuelva), lee el   │
│       DOM y la cierra                                                      │
└────────────────────────────────────────────────────────────────────────────┘
```

Reglas:

- La extensión no interpreta, no guarda y no decide nada. Convierte una
  URL en HTML. Todo lo que se sabe de cada portal vive en la web, así que un
  cambio de portal se arregla desplegando la web, sin esperar la revisión de
  las tiendas.
- El motor no toca el DOM de la página ni IndexedDB. Recibe el fetcher,
  el almacén y los servicios como parámetros, y se prueba en Vitest con
  fixtures y dobles.
- `api.ts` sigue siendo la única puerta de la UI. Conserva las firmas que
  tienen sentido (`listListings`, `setStatus`, `saveProfile`, `startSearch`,
  `streamSearch`...) y por dentro llama al motor y al almacén en lugar de
  hacer `fetch('/api/...')`.
  - Desaparecen `getAccess`, `rotateAccess`, `setPhoneAccess`, `getBrowser`,
    `installBrowser` y `quitApp`.
  - Aparecen `getExtensionStatus`, `exportListings` e `importListings`.
- Las búsquedas programadas corren mientras haya una pestaña de buscapiso
  abierta, igual que hoy («mientras está abierta»). Un Web Lock evita que
  dos pestañas las lancen a la vez. La extensión no necesita base de datos ni
  lógica en segundo plano.
- Las claves (Google, IA) se guardan en IndexedDB. En el navegador no hay
  llavero del sistema, y Ajustes lo dice: «guardada solo en este navegador».

## La extensión

### Protocolo

La página habla con el puente por `window.postMessage`. El puente comprueba
que el mensaje viene del origen de buscapiso, le pone un id y lo pasa al
script de fondo. Las respuestas vuelven por el mismo camino. Se usa un puente
y no `externally_connectable` porque Firefox no admite lo segundo.

```ts
// web → extensión
{ type: 'hello', protocol: 1 }
  → { type: 'hello', protocol: 1, version: '1.0.0', browser: 'chrome' | 'firefox' }

{ type: 'fetch', id, url, portal,
  blockedMarkers: string[],   // los manda la web: la extensión no sabe qué es un captcha
  readyMarkers?: string[],    // señal opcional de «página lista» en modo pestaña
  allowTab: boolean, timeoutMs: number }
  → { type: 'result', id, ok: true, html, finalUrl, via: 'fetch' | 'tab' }
  → { type: 'result', id, ok: false,
      reason: 'blocked' | 'timeout' | 'network' | 'not-allowed' | 'cancelled' }
  → { type: 'progress', id, state: 'needs-user' }   // captcha esperando en una pestaña visible

{ type: 'cancel' }   // Parar: cierra las pestañas de trabajo y falla lo pendiente
```

### Cómo se pide cada página

1. Primero `fetch(url, {credentials: 'include'})` desde el fondo, con las
   cookies de la persona en ese portal (incluida la de DataDome si ha
   navegado por Idealista). Si el HTML no contiene ningún `blockedMarker` y
   tiene una longitud razonable, se devuelve.
2. Si no, una pestaña de trabajo por portal, abierta en segundo plano.
   Al terminar de cargar se lee `document.documentElement.outerHTML`. Si
   sigue apareciendo un marcador de bloqueo, la pestaña pasa al frente, se
   emite `needs-user` y se vuelve a mirar cada 2 s hasta que desaparezca o
   venza el plazo (180 s por defecto).
3. Un portal que ha necesitado pestaña sigue en modo pestaña el resto de
   la búsqueda, reutilizando esa misma pestaña. Todas se cierran al acabar la
   búsqueda o al pulsar Parar.

### Ritmo

Lo marca el pipeline de la web, no la extensión: entre dos peticiones al
mismo portal espera un tiempo aleatorio en el rango de cada fuente (de 3 a
8 s, como en Python). Los portales van en paralelo, una cola cada uno.
Los límites de páginas por zona y el paso de «leer la ficha de los 15
mejores» no cambian.

### Permisos

- `host_permissions` solo para `*.idealista.com`, `*.fotocasa.es`,
  `*.habitaclia.com`, `*.roomgo.es` y `*.depisoenpiso.com`, más el origen de
  la web para el puente. Ni `<all_urls>`, ni historial, ni `webRequest`.
- `tabs` y `scripting`.
- El fondo rechaza cualquier URL fuera de esa lista, pida lo que pida la
  página.
- Una compilación solo para desarrollo añade `http://localhost/*` (para el
  servidor de portales falsos de los tests y para `vite dev`). Nunca se sube
  a las tiendas.

### Una sola fuente, dos paquetes

El código vive en `extension/`. Un script genera los paquetes de Chrome y de
Firefox, que solo se diferencian en `manifest.json`: `background.service_worker`
frente a `background.scripts`, y `browser_specific_settings` en Firefox.
Solo se usan APIs de WebExtensions, nada exclusivo de Chrome, para que una
versión de Safari sea en el futuro cuestión de empaquetar.

## Datos

### Nombres

El motor nuevo usa nombres en inglés en todas partes. Desaparece la
traducción de `schemas.py` (`precio` → `price`, `genero_piso` → `gender`).

### Almacenes de IndexedDB

| Almacén | Contenido | Quién escribe |
|---|---|---|
| `listings` | Lo que dijo el portal: source, sourceId, url, type, title, price, expenses, address, neighbourhood, municipality, lat, lon, approximateLocation, gender, genderConfirmed, bedrooms, roommates, smokingAllowed, ownerLivesIn, visitsAllowed, couplesAllowed, minStayMonths, availableFrom, description, photo, detailRead, surfaceM2, bathrooms, floor, elevator, furnished... más `city`, `firstSeen`, `lastSeen` y `missingSince?` | búsquedas e importaciones |
| `userState` | status, note, historial de estados | solo la persona |
| `derived` | score, reasons, group (accepted/possible), minutos y rutas por destino, resumen/pros/contras/alertas de la IA, alsoOn | el motor; se recalcula cuando hace falta |
| `profiles`, `settings` | perfiles de búsqueda, proveedor de trayectos, horario, ntfy, IA y claves | la persona |
| `travelCache`, `aiCache` | respuestas de Transitous o Google, y lecturas de la IA | el motor |

El id de un anuncio sigue siendo `sha1("portal:sourceId")` truncado a 12
caracteres hexadecimales. El mismo anuncio tiene el mismo id en cualquier
dispositivo, y en eso se apoya la fusión de importaciones.

Al arrancar se llama a `navigator.storage.persist()`. Safari puede borrar el
IndexedDB de una web tras unos 7 días sin visitarla, salvo que se haya
añadido a la pantalla de inicio, así que en dispositivos de Apple se muestra
el aviso de añadirla.

### Fichero de exportación

`buscapiso-<ciudad>-<fecha>.json`:

```jsonc
{
  "format": "buscapiso", "version": 1, "kind": "share" | "backup",
  "exportedAt": "2026-10-09T13:10:00Z", "app": "1.0.0",
  "summary": { "city": "barcelona", "types": ["room"], "count": 312,
               "sources": ["idealista", "fotocasa", "roomgo"],
               "searchedFrom": "...", "searchedTo": "..." },
  "listings": [ /* filas de `listings` */ ],
  "personal": { "userState": [], "profiles": [], "settings": {} }  // solo en backup
}
```

- Se exportan todos los anuncios de la ciudad activa, de los dos tipos.
  `missingSince` no viaja: es un dato de cada dispositivo.
- `share` lleva solo anuncios, para mandárselos a otra persona. Su
  dispositivo calcula la puntuación, los trayectos y la IA con su perfil y
  sus sitios.
- `backup` añade estados, notas, perfiles y ajustes, para llevarse los
  datos propios a otro navegador.
- Las claves no se exportan nunca, en ninguno de los dos.

### Importación

1. Valida `format` y `version`, acepta solo URLs `http(s)` (la regla de
   `_web_url` de hoy), descarta campos desconocidos y rechaza ficheros de más
   de 50 MB.
2. Antes de tocar nada muestra un resumen: «312 anuncios · Barcelona ·
   habitaciones · buscados del 7 al 9 de octubre · 41 nuevos para ti».
3. Fusiona por id. `firstSeen` se queda con la fecha más antigua y los datos
   del portal con la copia de `lastSeen` más reciente.
4. Los anuncios que ya estaban, de la misma ciudad y tipo, y que no vienen en
   un fichero más reciente reciben `missingSince`. La UI los marca como «no
   aparece en los datos más recientes». No se borran.
5. `userState` solo se escribe al importar un `backup`, y solo en anuncios
   sin estado local. Las notas propias siempre ganan.
6. Al terminar se recalcula `derived` de lo importado.

## El motor: de Python a TypeScript

Va en `web/src/engine/`. Cada módulo es puro y recibe lo de fuera como
parámetro.

| Módulo nuevo | Viene de | Notas |
|---|---|---|
| `model.ts` | `modelo.py` | `RawListing`, `Derived`, `UserState`, `totalCost`, `estimatedCost` |
| `sources/{idealista,fotocasa,habitaclia,roomgo,depisoenpiso}.ts` | `fuentes/*.py` | Cada una exporta `buildUrls(area, profile, page)`, `parseList(html)`, `parseDetail(html)` si la tiene, `blockedMarkers` y su rango de pausa. Ninguna pide nada por sí misma |
| `sources/base.ts` | `fuentes/base.py` | `inferGender`, `surface` |
| `fetcher.ts` | sustituye a `navegador.py` | Envuelve el puente: una cola por portal, pausas aleatorias, cancelación y eventos `needs-user`. En los tests, un doble que lee fixtures |
| `dedupe.ts` | `deduplicar.py` | Misma lógica |
| `geocode.ts` | `geocodificador.py` | Nominatim a 1 petición/s, caché en IndexedDB y, si falla, centroide del barrio, como hoy. Lo necesita Idealista, cuyo listado no trae coordenadas |
| `travel.ts` | `travel.py`, `transporte.py` | Transitous por defecto: `one-to-all` para transporte público (una petición por destino, no por anuncio) y `plan` a pie y en bici. Google Routes con clave propia y MOTIS con URL propia (es el mismo cliente). Caché en `travelCache`. Si falla el enrutado: distancia en línea recta a paso de peatón, marcada como «estimación» |
| `coverage.ts` | `cobertura.py` | Elige zonas por tiempo con `one-to-all` contra el centroide de cada zona, en lugar del grafo escrito a mano. `zonas.json` de Barcelona se copia tal cual |
| `ranking.ts` | `ranking.py` | Misma puntuación, mismos motivos, mismos grupos aceptado/posible |
| `profiles.ts` | `profiles.py` | Esquema del perfil, valores por defecto y validación con zod |
| `pipeline.ts` | `pipeline.py` | Cobertura → fetch por portal en paralelo → parseo → dedupe → geocodificación → trayectos → puntuación → guardado → IA sobre los mejores → aviso. Emite los mismos `SearchEvent` que la UI ya escucha |
| `ai/*.ts` | `ai/*.py` | Gemini, Claude (con la cabecera `anthropic-dangerous-direct-browser-access`), OpenAI, OpenRouter y Ollama. Mismos prompts y misma caché |
| `notify.ts` | `notify.py` | POST a ntfy desde la página |
| `scheduler.ts` | `api/scheduler.py` | Temporizador con la pestaña abierta, con Web Lock |

Se elimina (queda en el historial de git): `navegador.py`, `browser.py`,
`access.py`, `keys.py`, `informe.py`, `cli.py`, la red de Barcelona escrita a
mano (`red.json`, `build_red.py`), `fuentes/badi.py`, el empaquetado de
PyInstaller y su flujo de publicación. Tras la etiqueta v0.3.0, el paquete
`buscapiso/` de Python sale de `main`.

Se gana: los pisos enteros de Idealista, que en escritorio devolvían
captcha y desde una pestaña real deberían leerse.

### Cómo se demuestra que la traducción es fiel

- Ficheros dorados de los parsers. Antes de borrar Python, un script pasa
  los parsers actuales por todas las fixtures de `tests/fixtures/` y guarda
  la salida en JSON. Los tests de TypeScript leen las mismas fixtures y
  tienen que coincidir campo a campo.
- Ficheros dorados del ranking. Un conjunto de anuncios y perfiles,
  puntuado una vez con `ranking.py` y guardado. `ranking.ts` tiene que dar
  las mismas puntuaciones y los mismos motivos.
- `DOMParser` y BeautifulSoup no leen igual el HTML mal formado. Si aparece
  una diferencia y la lectura del navegador es la correcta, se corrige el
  fichero dorado con una nota que lo explique, no el parser.

## Cambios en la interfaz

Las rutas ya van por hash (`#/settings/places`), así que funcionan en GitHub
Pages sin reescrituras. `manifest.json` y `sw.js` ya la hacen instalable.

### Rooms

- `BrowserBanner` se sustituye por `ExtensionBanner`, con cuatro estados:
  - Sin extensión, en escritorio: «Para buscar, añade la extensión de
    buscapiso», con el enlace a la tienda que toque.
  - Firefox para Android: lo mismo, con el enlace de Firefox.
  - iPad, iPhone y otros móviles: «Para buscar hace falta un ordenador.
    Pide que te manden una exportación o hazla tú», con botón de Importar. En
    Apple, también el aviso de añadirla a la pantalla de inicio.
  - Extensión antigua: «Actualiza la extensión de buscapiso».
- La detección va por capacidad (¿ha contestado al `hello`?), no por el
  agente de usuario. El agente solo elige qué mensaje de ayuda enseñar, así
  que Brave, Vivaldi, Opera o Arc funcionan sin casos especiales.
- Sin extensión, «Buscar ahora» está desactivado y su tooltip dice por qué.
  Todo lo demás (filtros, re-puntuar, mapa, tablero) funciona en cualquier
  dispositivo.
- El progreso de la búsqueda tiene un estado nuevo para `needs-user`:
  «Idealista pide confirmar que eres una persona: resuélvelo en la pestaña
  que se acaba de abrir». Desaparece cuando la extensión informa de que ha
  ido bien.
- La pantalla de bienvenida deja de hablar de Chromium: elegir ciudad (solo
  Barcelona por ahora), añadir sitios, poner presupuesto, y buscar o
  importar.

### Ajustes

- Phone desaparece (QR, acceso por red local, revocar clave) junto con
  `PhonePanel.svelte`. Las notificaciones pasan a una sección Alerts.
  `#/settings/phone` y `#/phone` redirigen ahí.
- Sección nueva Data:
  - «Exportar para compartir» y «Copia de seguridad completa».
  - «Importar un fichero», con el resumen previo.
  - Estado del almacenamiento: «En este navegador · 312 anuncios · 18 MB ·
    persistente: sí/no».
  - «Borrar todos los datos», con confirmación dentro de la página, nunca con
    `confirm()`.
- Places & travel: desaparece el «mapa integrado». Transitous es el
  proveedor por defecto y no pide nada: el contacto que exige su política lo
  dan el Referer de la web y el pie de página. Se quedan Google (con clave) y
  MOTIS (con URL).
- AI: las claves dicen «guardada solo en este navegador». Ollama avisa de
  que necesita `OLLAMA_ORIGINS` con el origen de la web.
- Desaparece «Quit buscapiso».

### En todas las pantallas

Un pie con enlace al código y contacto, los créditos que piden Transitous y
OpenStreetMap, y una línea de privacidad: «Tus datos se quedan en este
navegador. buscapiso no tiene servidor».

## Seguridad y privacidad

- El puente solo atiende mensajes cuyo `event.origin` es el de la web y cuyo
  `event.source` es su propia ventana.
- El fondo solo pide URLs de los portales de la lista.
- La extensión no lista orígenes que no controlo. Si incluyera un dominio
  «para más adelante» y otra persona lo registrase, su web podría pedir
  páginas de los portales con las cookies de nuestros usuarios.
- CSP estricta en `index.html`: `script-src 'self'`; `connect-src` limitado a
  Transitous, Google, Nominatim, ntfy y los proveedores de IA (más la URL de
  MOTIS u Ollama que configure cada cual); `img-src` para las CDN de fotos
  de los portales.
- El texto importado o leído de un portal se muestra siempre como texto, nunca
  con `{@html}`.

## Pruebas

- Motor (Vitest, jsdom):
  - Ficheros dorados de parsers y ranking.
  - Pipeline con un fetcher falso que devuelve fixtures, incluida la
    secuencia «bloqueado y luego resuelto».
  - Almacén con `fake-indexeddb`.
  - Exportar e importar de ida y vuelta (exportar e importar en un almacén
    vacío deja lo mismo), reglas de fusión (las notas no se pisan,
    `missingSince`) y ficheros malos (versión equivocada, URLs `javascript:`,
    campos desconocidos, demasiado grandes).
- Extensión (Vitest con `chrome.*` simulado): el puente rechaza otros
  orígenes, el fondo rechaza URLs fuera de la lista, se detectan los
  marcadores, funciona el paso a pestaña y Parar cierra las pestañas de
  trabajo.
- De punta a punta (Playwright con Chromium y la extensión sin empaquetar,
  `--load-extension`): la web detecta la extensión, busca contra un
  servidor local de portales falsos, supera una página de captcha falsa
  «resolviéndola», y comprueba los anuncios, la exportación y la importación
  en un perfil limpio. Ningún test toca los portales reales.
- Comprobación en vivo, a mano, antes de cada publicación: una búsqueda
  real por portal en Chrome y en Firefox, anotando si cada uno ha ido por
  fetch o por pestaña.

## Despliegue

- Web: GitHub Pages desde una Action en cada push a `main` (`npm run
  build` y publicar). El repositorio pasa a la organización `buscapiso`
  (`buscapiso/buscapiso`), así que la web queda en
  `https://buscapiso.github.io/buscapiso/`, con `base: '/buscapiso/'` en
  Vite. El origen, que es lo que importa a la extensión, es
  `https://buscapiso.github.io`.
- Extensión:
  - Chrome Web Store: cuota única de 5 $, publicada como oculta
    (unlisted), así que solo la instala quien tiene el enlace.
  - Firefox Add-ons: gratis, también oculta, con un `.xpi` firmado.
  - Las revisiones tardan días; otra razón para que la extensión sea mínima.

## Orden de trabajo

0. Prueba de viabilidad (desechable). Una extensión mínima sin empaquetar
   pide una página de búsqueda de cada portal desde mi Chrome y mi Firefox, e
   informa de si ha ido por fetch o por pestaña. Si Idealista no se puede
   leer ni en una pestaña, se revisa la sección de la extensión antes de
   seguir.
1. Fusionar el PR #10 y etiquetar v0.3.0 como última versión de
   escritorio, con una nota en el README de que se retira.
2. Generar los ficheros dorados desde Python.
3. Traducir el motor (modelo, fuentes, dedupe, ranking, perfiles, trayectos,
   geocodificación, cobertura, IA, avisos) con sus tests.
4. Almacén en IndexedDB y fachada `api.ts`. La UI pasa a funcionar con el
   motor local.
5. Extensión, puente y fetcher, con el banco de pruebas de punta a punta.
6. Cambios de interfaz y sección Data con exportación e importación.
7. Crear la organización `buscapiso` y mover el repositorio, desplegar Pages,
   subir la extensión a las dos tiendas como oculta y pasar la comprobación
   en vivo.
8. Quitar el paquete de Python y el empaquetado, y reescribir el README para
   la web.

## Riesgos y cosas por vigilar

- DataDome puede cerrar también el modo pestaña. Es lo único que depende
  de un tercero; por eso la prueba de viabilidad va primero.
- Las cookies en `fetch()` desde la extensión. La protección total de
  cookies de Firefox o las reglas SameSite de Chrome pueden impedir que
  viajen. Entonces todo va por pestaña: funciona, pero más despacio.
- Uso de Transitous y Nominatim en la fase pública. Con amistades, el
  volumen es pequeño. Antes de abrirla al público hay que escribir a
  Transitous, como pide su política, y revisar si Nominatim sigue siendo
  aceptable para geocodificar o conviene pasar a otro servicio (Photon, o el
  geocodificador de Transitous).
- Safari borra datos de webs no visitadas. Mitigado con `persist()`, el
  aviso de pantalla de inicio y la copia de seguridad; en el peor caso, se
  vuelve a importar.
- Diferencias entre `DOMParser` y BeautifulSoup. Las detectan los
  ficheros dorados.

## Trabajo futuro

- Proyecto B: cualquier ciudad de España. Catálogo de ciudades y zonas,
  identificadores de ubicación de cada portal y elección de zonas con
  Transitous.
- Badi. Encaja mejor con la extensión que con el escritorio: necesita
  sesión iniciada, y el `fetch()` de la extensión ya lleva las cookies de la
  sesión de Badi de cada persona. El código viejo capturaba el token con
  Playwright (`_capturar_token`).
- Sincronización entre dispositivos. Exige servidor y cuentas. El formato
  `backup` es el punto de partida.
- Apple. Empaquetar la extensión como app de Safari (99 €/año y
  compilación en macOS). Como solo usa APIs de WebExtensions, debería ser
  cuestión de empaquetado.
- Dominio propio. Si llega, exige una actualización de la extensión con
  el origen nuevo.
