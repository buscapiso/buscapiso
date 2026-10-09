# buscapiso: notas técnicas

buscapiso es una web estática (GitHub Pages) con una extensión de navegador.
No hay servidor: el motor corre en la página, los datos viven en IndexedDB y la
extensión lee los portales desde el navegador de cada persona. El diseño está
en `docs/specs/2026-10-09-web-extension-diseno.md` y el plan, con los hallazgos
de la prueba de viabilidad, en `docs/superpowers/plans/2026-10-09-fase-7-web.md`.

La app de escritorio (Python, FastAPI, Playwright) se retiró tras la v0.3.0.
Su código sigue en el historial de git.

## Dónde está cada cosa

| Carpeta | Qué hay |
|---|---|
| `web/src/engine/` | El motor, sin DOM de página ni IndexedDB: modelo, fuentes, deduplicado, geocodificación, trayectos, cobertura, ranking, IA, avisos, pipeline, programador |
| `web/src/engine/sources/` | Un fichero por portal: URLs, parser y marcadores de bloqueo. Ninguno pide nada por su cuenta |
| `web/src/store/` | IndexedDB (`db.ts`), el "servidor" local que atiende las rutas `/api/...` (`backend.ts`) y exportar/importar (`transfer.ts`) |
| `web/src/lib/api.ts` | La única puerta de la interfaz. En la web usa el backend local; en los tests de componentes, `fetch` simulado |
| `web/src/lib/extension.ts` | El cliente de la extensión: `hello`, `fetch`, `cancel` por `window.postMessage` |
| `extension/` | La extensión (JavaScript sin compilar, para que se pueda revisar tal cual). `build.mjs` genera los paquetes de Chrome y Firefox |
| `web/e2e/` | Pruebas de punta a punta con Playwright: la extensión real contra un portal falso, y la web compilada |

## Cómo se lee cada portal

| Portal | Desde la extensión | Género del piso | Ubicación |
|---|---|---|---|
| Idealista | `fetch` da 403; pestaña, y la persona resuelve el captcha | icono de la tarjeta, dato fiable | calle, geocodificada |
| Fotocasa | `fetch` normal | solo si la descripción lo dice | del portal, nivel barrio |
| Habitaclia (pisos) | `fetch` normal | no aplica | del portal, a veces exacta |
| Roomgo | `fetch` normal | publicado en la tarjeta | calle, geocodificada |
| De Piso en Piso | sin extensión: sus endpoints JSON admiten CORS | de la ficha (descripción) | exacta |

Comprobado el 2026-10-09 con Chromium y un perfil limpio. Si un portal empieza a
bloquear `fetch`, la extensión pasa sola a modo pestaña; si cambia su HTML, se
arregla el parser en `web/src/engine/sources/` y basta con desplegar la web.

Idealista: con `fetch` responde 403 (DataDome). En la pestaña aparece el
captcha y la persona lo resuelve; después la extensión vuelve a probar `fetch`,
que con la cookie nueva puede bastar. Con el navegador marcado como
automatizado no pasa nunca, así que el e2e no toca Idealista.

Fotocasa no pinta los anuncios en el HTML: los manda en un JSON incrustado que
se localiza por su clave `realEstates`, no por el nombre de la variable de
JavaScript, que cambia en cada despliegue. Se recorre de más barato a más caro
y se para en cuanto una página entera supera el presupuesto.

"Se permiten visitas" no existe como dato en Idealista: sus normas son fumar,
parejas, mascotas y menores. Se usan `no admite parejas` (norma) y la frase de
ambiente `no suelen tener visitas` (costumbre, resta menos). Solo se sabe
abriendo la ficha, y solo se abren las mejores candidatas.

## Ficheros dorados

`web/src/engine/__golden__/` guarda la salida de los parsers y del ranking de
la versión Python sobre las mismas páginas de `__fixtures__/`. Los tests de
TypeScript tienen que dar lo mismo campo a campo, motivos de puntuación
incluidos (con el redondeo de Python: al par en los empates, y "-0"). El
script que los generó (`scripts/golden.py`) está en el historial de git.

`idealista_pisos.html` es una página real de pisos del Eixample capturada con
la extensión resolviendo el captcha; no tiene dorado porque Python nunca leyó
pisos de Idealista.

## Tests

```bash
npm --prefix web test          # motor, almacén, pantallas y extensión (Vitest)
npm --prefix web run check     # tipos (svelte-check)
npm --prefix web run e2e       # Playwright: extensión real y web compilada
```

## Tu propio servidor MOTIS

Transitous es una instancia pública de MOTIS, un motor libre (licencia MIT).
Puedes montar el tuyo y ponerlo en Settings → Places & travel → Timetable
server:

```bash
mkdir motis && cd motis
wget https://github.com/motis-project/motis/releases/latest/download/motis-linux-amd64.tar.bz2
tar xf motis-linux-amd64.tar.bz2
wget https://download.geofabrik.de/europe/spain/cataluna-latest.osm.pbf   # ~270 MB
# Horarios GTFS: la lista de feeds que usa Transitous está en
# https://github.com/public-transport/transitous/blob/main/feeds/es.json
./motis config cataluna-latest.osm.pbf tmb.zip amb.zip rodalies.zip
./motis import
./motis server        # escucha en http://localhost:8080
```

El servidor tiene que permitir peticiones desde la web (CORS). Para Ollama,
arráncalo con `OLLAMA_ORIGINS=https://buscapiso.github.io`.

## Publicar

### Una sola vez

1. Crear la organización de GitHub `buscapiso` (gratis, desde la cuenta
   personal) y transferir el repositorio a `buscapiso/buscapiso`.
2. En el repositorio, Settings → Pages → Source: GitHub Actions. Cada push a
   `main` publica la web en `https://buscapiso.github.io/buscapiso/`.
3. Chrome Web Store: cuenta de desarrollador (5 $ una vez), subir
   `buscapiso-chrome.zip` y publicarla como oculta (unlisted).
4. Firefox Add-ons: subir `buscapiso-firefox.zip` como oculta; Mozilla
   devuelve un `.xpi` firmado.
5. Poner los dos enlaces en `STORE` de `web/src/lib/extensionState.svelte.ts`.

El origen `https://buscapiso.github.io` está dentro de la extensión (el
content script solo se inyecta ahí). Cambiar de dominio exige publicar otra
versión de la extensión. No se añade un dominio que aún no sea nuestro: quien
lo registrase podría pedir páginas de los portales con las cookies de los
usuarios.

### Cada versión de la extensión

Subir la versión en `extension/build.mjs` y en `extension/src/protocol.js`, y
etiquetar `ext-vX.Y.Z`: el workflow adjunta los dos zip a la release. Si cambia
el protocolo, subir `PROTOCOL` en los dos lados; la web pide actualizar a quien
tenga una extensión más antigua.

### Comprobación en vivo antes de publicar

Ningún test toca los portales reales. Antes de cada versión, en Chrome y en
Firefox, con la extensión de la tienda:

- [ ] Búsqueda de habitaciones: Idealista (resolver el captcha si sale),
      Fotocasa, Roomgo y De Piso en Piso traen anuncios.
- [ ] Búsqueda de pisos: Idealista, Fotocasa y Habitaclia traen anuncios.
- [ ] Anotar en el log de la búsqueda qué portales fueron por fetch y cuáles
      por pestaña.
- [ ] Parar a mitad cierra las pestañas de trabajo.
- [ ] Exportar, importar en un iPad (o en otro navegador) y ver la lista
      puntuada con el perfil de ese dispositivo.

## Antes de abrirla al público

- Escribir a Transitous: su política pide avisar antes de muchas peticiones
  de usuarios distintos. buscapiso hace una por destino y búsqueda para el
  transporte público, y una por anuncio (solo los mejores) a pie o en bici.
- Revisar si Nominatim sigue siendo aceptable para geocodificar las
  direcciones de Idealista (máximo 1 petición por segundo) o conviene Photon o
  el geocodificador de Transitous.

## Limitaciones

- Solo Barcelona y su área metropolitana (`web/src/engine/data/barcelona.json`).
- Buscar exige ordenador (o Firefox en Android) con la extensión. En iPad e
  iPhone se importa.
- Badi necesita sesión iniciada y no está incluido; con la extensión podría
  funcionar usando la sesión de cada persona.
- El filtro "solo chicas" de Idealista significa "admite chicas": el filtro
  estricto se aplica en local.
- Safari puede borrar los datos de una web que no se visita en unos 7 días,
  salvo que esté en la pantalla de inicio. La copia de seguridad está en
  Settings → Your data.
