# Fase 6: instalador. Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Que una amiga descargue buscapiso, le dé doble clic y lo use sin terminal: la app se abre en el navegador, instala sola el Chromium que necesita, la guía en el primer uso y se cierra con un botón.

**Architecture:**
- **Datos.** `paths.data_dir()` busca en este orden: `BUSCAPISO_HOME`; la raíz del repositorio si se ejecuta desde el código fuente (como ahora, para no mover tus datos); y si no, `platformdirs.user_data_dir("buscapiso")`, que es `~/.local/share/buscapiso`, `%APPDATA%\buscapiso` o `~/Library/Application Support/buscapiso`.
- **Chromium.** `buscapiso/browser.py`:
  - `chromium_installed() -> bool` comprueba que existe el ejecutable que da Playwright.
  - `install_chromium(on_line)` ejecuta el driver de Playwright (`install chromium`) y pasa cada línea de salida.
  - API: `GET /api/browser` y `POST /api/browser/install`, que corre en un hilo; el progreso se consulta con `GET /api/browser`.
  - Rooms muestra un aviso con el botón "Install the browser (about 150 MB)" mientras falte.
- **Primer uso.** Si el perfil no tiene destinos y no hay anuncios, Rooms enseña tres pasos: dónde vas (Settings → Places), qué buscas (Settings) y Search now.
- **Arranque y cierre.**
  - En la versión empaquetada, `buscapiso` sin argumentos equivale a `serve`.
  - `POST /api/quit` (solo desde el propio ordenador) para el servidor, y Settings tiene "Quit buscapiso".
  - Si el puerto está ocupado porque buscapiso ya está abierto (responde `/api/meta`), se abre el navegador en lugar de fallar.
- **Empaquetado.**
  - `packaging/buscapiso.spec` (PyInstaller, modo carpeta) con `web_dist`, `datos` y los datos de segno y certifi.
  - `packaging/build.sh` compila la web y empaqueta.
  - `.github/workflows/build.yml` genera Linux, Windows y macOS al publicar una etiqueta `v*`, y sube los ficheros a la release.
- **README en inglés** para quien instala. El README actual pasa a `docs/README.es.md` (notas técnicas en español).

## Review Focus
1. Tus datos actuales no se mueven: desde el código fuente sigue siendo la raíz del repo.
2. Sin Chromium, la app no se rompe: avisa y ofrece instalarlo. Si la instalación falla, se ve el error.
3. Doble clic con buscapiso ya abierto: abre otra pestaña, sin error de puerto.
4. "Quit" desde el móvil no funciona (403).
5. El binario de Linux arranca y sirve la app (probado de verdad aquí). Windows y macOS solo se comprueban en CI.

## Tasks
1. `paths` con platformdirs y detección del código fuente.
2. `browser.py`, la API y el aviso en Rooms.
3. Pasos del primer uso en Rooms.
4. Arranque sin argumentos, `/api/quit`, botón Quit y el caso "ya está abierto".
5. Spec de PyInstaller y build local en Linux, con prueba de arranque del binario.
6. Workflow de GitHub Actions.
7. README en inglés.
