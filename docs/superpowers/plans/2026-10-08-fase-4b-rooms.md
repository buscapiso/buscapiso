# Fase 4b: una página Rooms, Settings por secciones y lo que pidió la usuaria al probar. Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Lo que pidió la usuaria tras probar la app (8 de octubre, noche):
1. El modelo de IA se elige en un desplegable, nunca escribiéndolo a mano.
2. Los barrios se eligen de un desplegable.
3. y 5. Menos pestañas. La estructura A elegida en los mockups: **Rooms** (búsqueda integrada, criterios editables, filtros por estado en chips, vistas List, Map y Board) y **Settings** (secciones).
4. "Re-score" es un botón aparte de "Search now", y "Skip full listings" solo afecta a la búsqueda real.

**Architecture:**
- **Backend:**
  - `POST /api/ai/models` con `{base_url, key?}` devuelve `{models: [id…]}`. Llama a `GET {base_url}/models`, la lista estándar de las APIs compatibles con OpenAI (Gemini, OpenAI, OpenRouter, Ollama), con la clave enviada o la guardada. Para Claude no hace falta: la lista con precios es fija y viene de la referencia de la API.
  - `GET /api/neighbourhoods` devuelve `{names: [...]}`: los barrios y municipios de los anuncios guardados más las zonas del catálogo, sin repetidos y en orden alfabético.
- **Frontend:**
  - Rutas `#/`, que lleva el filtro y la vista en la propia URL (`#/?f=liked&v=map`); `#/listing/<id>`; y `#/settings/<sección>`. Las rutas antiguas (`#/liked`, `#/map`, `#/board`, `#/search`, `#/phone`, `#/profile`) redirigen a las nuevas.
  - Rooms carga todos los anuncios una vez y filtra en el navegador; los contadores de cada chip salen de ahí. Hay unos cientos, así que no hace falta paginar.
  - En la vista Board se ocultan los chips de estado, porque el tablero ya está organizado por estado.
  - Los criterios se editan en un popover por chip: `CriteriaBar` con `CriterionEditor`. Al guardar, "Re-score now" lanza una búsqueda desde la caché.
  - `SearchPanel` sustituye a la página Search, y Settings tiene una barra lateral de secciones (arriba, en el móvil).
  - Navegación: Rooms y Settings, también en la barra inferior del móvil.

## Review Focus
1. Volver atrás o recargar conserva el filtro y la vista.
2. Editar un criterio no pisa el resto del perfil: se lee el perfil, se cambia un campo y se guarda el perfil entero.
3. Si `/models` falla (clave mala, servidor apagado), se ve el error y se puede escribir el modelo a mano como último recurso.
4. Los barrios ya elegidos que no están en la lista no se pierden.
5. Con la búsqueda en marcha, la lista se recarga sola al terminar.

## Tasks
1. Backend: `/api/ai/models` y `/api/neighbourhoods`, con sus tests (la llamada HTTP se inyecta).
2. `AISettings`: desplegable de modelos con "Load models" y el modo manual como recurso. `NeighbourhoodPicker`: buscador con chips, para excluir, penalizar y preferir.
3. Router nuevo, `Nav` con dos entradas y redirecciones de las rutas antiguas.
4. `SearchPanel`, con los botones Search now y Re-score, la casilla Skip full listings, el progreso en línea y el registro plegable.
5. `CriteriaBar` y `CriterionEditor`: presupuesto máximo, género, minutos por destino con límite y portales. "Edit all" lleva a Settings.
6. Página Rooms: chips de estado con contadores y vistas List, Map y Board. Borrar `Listings.svelte`, `MapPage.svelte`, `Board.svelte` como página, `Search.svelte` y `Phone.svelte` como página, y moverlos a componentes.
7. Settings por secciones: What you're looking for (con Describe), Places & travel, Neighbourhoods, Automatic searches, Phone & alerts (el QR) y AI.
8. E2E actualizado, capturas a 1280 y 390 px, y README.
