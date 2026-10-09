# Buscapiso: habitación en Barcelona

Busca habitaciones en Idealista, Fotocasa, Roomgo y De Piso en Piso, las sitúa en el mapa, calcula el trayecto real
a **Fira (L9)** y a **Collblanc**, descarta lo que no cumple tus requisitos y te
deja un informe HTML ordenado, marcando lo que es nuevo desde la última vez.

## Cómo se ejecuta

```bash
cd ~/buscapiso
.venv/bin/buscapiso
```

La primera vez crea el perfil `default` a partir de `config.yaml` y
`zonas.yaml`. Desde entonces los ajustes viven en `pisos.db`; los flags solo
cambian la búsqueda en curso.

Se abre una ventana de Chromium. **Déjala visible**: es lo que evita el bloqueo
anti-bot de Idealista. Tarda unos minutos y al terminar abre `informe.html`.

Si aparece un captcha, resuélvelo en esa ventana: el programa espera 90 segundos
y sigue solo.

### Opciones

```bash
.venv/bin/buscapiso --paginas 5        # rastrea más (por defecto 3)
.venv/bin/buscapiso --solo-nuevos      # solo lo publicado en 48 h
.venv/bin/buscapiso --sin-fichas       # más rápido, sin abrir fichas
.venv/bin/buscapiso --no-abrir         # no abre el navegador al acabar
.venv/bin/buscapiso --municipios barcelona/sants-montjuic
.venv/bin/buscapiso --desde-cache      # reusa lo descargado
.venv/bin/buscapiso --max-minutos 60   # amplía el límite de trayecto
.venv/bin/buscapiso --presupuesto 700  # amplía el coste máximo
.venv/bin/buscapiso --fuentes idealista fotocasa
```

Una búsqueda completa con los tres portales tarda unos **12-15 minutos**: la
mayor parte se va en geocodificar (Nominatim solo permite 1 consulta/segundo) y
en abrir fichas. Con `--sin-fichas` baja a la mitad.

`--desde-cache` es la que más usarás después de la primera vez: reprocesa el
HTML ya guardado sin tocar Idealista, así puedes cambiar los pesos del perfil
(ver "Qué tocar") y ver el efecto al instante sin arriesgarte a un bloqueo.

### Seguimiento

```bash
.venv/bin/buscapiso mark a1b2c3d4e5f6 contacted "escrito el lunes"
.venv/bin/buscapiso statuses
```

Estados: `liked`, `hidden`, `contacted`, `visit_scheduled`, `visited`,
`applied`, `got_it`, `rejected`, `discarded`. Lo que marcas como `hidden` o
`discarded` no vuelve a aparecer. Los nombres antiguos (`marcar`, `estados`,
`interesa`, `contactado`, `visita`, `descartado`) siguen funcionando. Cada
cambio queda en un historial.

### Perfiles

```bash
.venv/bin/buscapiso profile list                  # el activo lleva *
.venv/bin/buscapiso profile export default p.json
.venv/bin/buscapiso profile import p.json --use   # tras editar el JSON
```

## La web app

```bash
.venv/bin/pip install -e '.[dev]'
npm --prefix web ci && npm --prefix web run build   # una vez, y tras cada cambio en web/
.venv/bin/buscapiso serve
```

Se abre en `http://127.0.0.1:8770`. Desde ahí ves los anuncios, los marcas
(me gusta, ocultar, contactado, visita...), escribes notas, editas lo que
buscas y lanzas la búsqueda viendo el progreso. La ventana de Chromium sigue
abriéndose al buscar, igual que desde el terminal. La pestaña Map enseña los
anuncios y tus destinos sobre un mapa de OpenStreetMap.

Para trabajar en el frontend: `buscapiso serve --no-open` en un terminal y
`npm --prefix web run dev` en otro, que recarga al guardar y reenvía `/api`
al servidor.

Los motivos de la puntuación y los mensajes de progreso de la búsqueda siguen
en español, porque los genera el motor; traducirlos queda pendiente.

### Tiempos de trayecto

Por defecto los minutos salen del grafo propio de metro, FGC y Rodalies:
gratis, sin red y con un error de unos ±4 minutos. En Settings → Travel times
se puede elegir:

- Transitous: horarios reales, autobuses incluidos, gratis y sin clave. Es un
  servicio comunitario para proyectos de código abierto y no comerciales;
  cada petición lleva el contacto que pongas.
- Google Maps: horarios reales con tu propia clave de la Routes API. Google
  cobra por trayecto, con un cupo gratuito mensual. La clave se guarda en el
  llavero del sistema, o en la variable `BUSCAPISO_GOOGLE_KEY`.

Solo se recalculan con horarios reales los mejores anuncios de cada búsqueda
(40 por defecto); el resto conserva la estimación. Si el proveedor falla, la
búsqueda sigue con la estimación y lo avisa.

Con Transitous, cada destino cuesta una sola petición: el servidor devuelve
cuánto antes hay que salir de cada parada para llegar a la hora que pongas en
"Be there by", y el tiempo de cada piso es el de su mejor parada a menos de
1,2 km más el tramo a pie. Por eso los minutos incluyen la espera: desde
plaça de Sants hay que salir 22 minutos antes de las 8:30 para llegar a Fira,
aunque el tren tarde menos.

#### Tu propio servidor MOTIS

Transitous es una instancia pública de MOTIS, un motor libre (licencia MIT).
Puedes montar el tuyo y apuntar buscapiso a él; así no dependes del servidor
público ni de sus condiciones de uso.

```bash
mkdir motis && cd motis
wget https://github.com/motis-project/motis/releases/latest/download/motis-linux-amd64.tar.bz2
tar xf motis-linux-amd64.tar.bz2
wget https://download.geofabrik.de/europe/spain/cataluna-latest.osm.pbf   # ~270 MB
# Horarios GTFS: la lista de feeds de Barcelona que usa Transitous está en
# https://github.com/public-transport/transitous/blob/main/feeds/es.json
# (metro y bus de TMB, bus metropolitano, Cercanías...). El de TMB pide
# registrarse en developer.tmb.cat.
./motis config cataluna-latest.osm.pbf tmb.zip amb.zip rodalies.zip
./motis import
./motis server        # escucha en http://localhost:8080
```

Después, en Settings → Travel times → Transitous, pon `http://localhost:8080`
como servidor. Con un servidor propio no hace falta poner contacto.

### IA (opcional)

Con una clave de IA propia, cada búsqueda lee la descripción de los mejores
anuncios (30 por defecto): quién vive en el piso, gastos, normas, si es de
temporada, edad de los compañeros, fecha de entrada, un resumen de una frase,
pros, contras y cosas que comprobar antes de pagar. Un anuncio "posible" cuyo
género confirma la IA pasa a la bandeja principal. Lo que publica el portal
siempre manda sobre lo que deduce la IA, y cada anuncio solo se paga una vez:
el resultado se guarda por su texto.

En la ficha, "Draft a message" escribe el primer mensaje al anunciante en su
idioma, con lo que pongas en "About you". En Settings, "Describe what you're
looking for" rellena el perfil a partir de una descripción libre (lo revisas
antes de guardar).

Se configura en Settings → AI:

- Claude: clave en console.anthropic.com → API Keys. Opus 5.5 cuesta $4/$20
  por millón de tokens de entrada/salida; Haiku 5.5, $0,10/$0,50. Con 30
  anuncios por búsqueda son unos 45.000 tokens de entrada y 12.000 de salida:
  unos 0,40 $ con Opus 5.5 y menos de 1 céntimo con Haiku 5.5.
- Gemini: clave en aistudio.google.com → Get API key (tiene nivel gratuito).
- OpenAI u OpenRouter: clave en su web.
- Ollama: gratis y privado, en tu ordenador. Instálalo, ejecuta `ollama pull`
  con un modelo y escribe su nombre. No necesita clave.

La clave se guarda en el llavero del sistema (o en `BUSCAPISO_<PROVEEDOR>_KEY`,
por ejemplo `BUSCAPISO_ANTHROPIC_KEY`), nunca en la base de datos. Si la IA
falla, la búsqueda sigue con las expresiones regulares de siempre y lo avisa.

### En el móvil

```bash
.venv/bin/buscapiso serve --lan
```

Con `--lan`, buscapiso también acepta conexiones de la red de casa. Abre la
pestaña Phone en el ordenador y escanea el QR con el móvil (misma Wi-Fi). El
enlace lleva una clave privada: sin ella, desde otro dispositivo solo se ve un
error 401. "Revoke phone access" cambia la clave y deja fuera a los móviles
que tenían la anterior. En el propio ordenador nunca se pide.

En el móvil, "Añadir a pantalla de inicio" la deja como una app más, con la
barra de pestañas abajo. Por la Wi-Fi de casa va por HTTP, así que no funciona
sin conexión. Fuera de casa, instala Tailscale en el ordenador y en el móvil y
ejecuta `tailscale serve 8770`: tendrás una dirección HTTPS privada con la que
también funciona como app sin conexión.

### Búsquedas automáticas

En Settings → Automatic searches, buscapiso busca solo cada 2 a 24 horas
mientras está abierto, dentro de la franja que elijas (por defecto de 8:00 a
23:00) y nunca encima de otra búsqueda. La ventana de Chromium se abre cada
vez, igual que al buscar a mano.

### Avisos en el móvil (ntfy)

En Settings → Phone notifications, activa "Send good new rooms to my phone".
Instala la app gratuita ntfy (iOS o Android), pulsa + y suscríbete al tema que
aparece. Tras cada búsqueda llega un aviso si hay anuncios nuevos con al menos
la puntuación que elijas (80 por defecto), con los tres mejores: coste, minutos
y barrio. El tema es aleatorio porque en ntfy.sh cualquiera que sepa su nombre
puede leerlo.

## Las zonas se calculan solas

No hay lista de zonas que mantener. El buscador coge el límite de
`max_minutos` del primer destino de `destinos` (o `--max-minutos`), calcula con el grafo de
metro cuánto se tarda desde cada zona del catálogo hasta Fira, y rastrea las que
entran. Subir el límite amplía el rastreo de verdad:

```
--max-minutos 30  ->  6 zonas
--max-minutos 60  -> 16 zonas, con el Eixample, Gràcia y Ciutat Vella
```

El catálogo está en `datos/zonas.json`, con el slug de cada portal y el
centroide de cada zona. Para añadir una, edita `datos/build_zonas.py` y
ejecútalo: geocodifica el centroide y valida que caiga dentro de la conurbación.

## Pisos sin género confirmado

Fotocasa y De Piso en Piso no publican si el piso es de chicas. Descartarlos
tiraba opciones buenas por falta de un dato que se resuelve con un mensaje, así
que van a una sección propia del informe cuando puntúan por encima de
`requisitos.puntos_minimos_para_preguntar`. Suelen colarse ahí las mejores
puntuaciones de todo el informe, porque Fotocasa publica la antigüedad exacta y
un anuncio de hace un día se lleva el bonus de novedad.

Si prefieres no verlos, pon `preguntar_si_genero_desconocido: false`.

## Qué tocar

`config.yaml` y `zonas.yaml` solo se leen la primera vez, para crear el perfil
`default`. Para cambiar ajustes después, exporta el perfil, edita el JSON e
impórtalo (ver "Perfiles").

**`config.yaml`** contiene el presupuesto, los requisitos, los pesos del ranking y
los destinos con los que se crea ese primer perfil.

Los ajustes que más notarás:

| Ajuste | Qué hace |
|---|---|
| `presupuesto.coste_total_maximo` | descarte duro por precio total (habitación + gastos) |
| `destinos[].max_minutos` | descarte duro por tiempo a ese destino (`null` = sin límite) |
| `requisitos.solo_chicas` | `false` incluye pisos mixtos |
| `pesos.novedad` | cuánto premia un anuncio recién publicado |
| `presupuesto.gastos_si_no_declara` | gastos que supongo cuando el anuncio los calla |
| `busqueda.orden` | `nuevos`, `baratos` o `relevancia` |
| `fuentes` | qué portales rastrear |
| `requisitos.preguntar_si_genero_desconocido` | mostrar los de género sin confirmar |
| `requisitos.puntos_minimos_para_preguntar` | listón para esa sección |

**`zonas.yaml`** tiene tus listas de zonas a `excluir`, `penalizar` y `preferir`.
Viene vacío a propósito: eso lo decides tú, no yo.

## Cómo funciona

```
idealista   ─┐
fotocasa    ─┼─parser──► Anuncio ──deduplicar──► geocodificación ──► lat/lon
roomgo      ─┤
depisoenpiso─┘
                                      │
                                      ▼
                          grafo de metro (Dijkstra)
                                      │
                                      ▼
                   filtros duros ──► puntuación ──► informe.html
                                      │
                                      ▼
                            SQLite (histórico y novedades)
```

El diseño completo y el porqué de cada decisión está en
`docs/specs/2026-09-17-buscapiso-diseno.md`.

## Tests

```bash
.venv/bin/python -m pytest tests/ -q
```

Corren sin red, contra HTML real guardado en `tests/fixtures/`. Si Idealista
cambia su HTML, estos tests dicen exactamente qué se rompió.

## Qué aporta cada portal

| Portal | Género del piso | Ubicación | Volumen en Barcelona |
|---|---|---|---|
| Idealista | filtro por URL, dato fiable | calle (geocodificada) | ~5.100 habitaciones |
| Fotocasa | solo si la descripción lo dice | del portal, nivel barrio | ~8.000 habitaciones |
| Roomgo | publicado en la tarjeta | calle (geocodificada) | medio, casi todo mixto |
| De Piso en Piso | solo si la descripción lo dice | exacta, del portal | ~10 por búsqueda |

Fotocasa no pinta los anuncios en el HTML: los manda en un JSON incrustado que
luego renderiza con JavaScript. Eso juega a favor, porque ese JSON trae
coordenadas, antigüedad del anuncio en días y un campo `isTemporaryRental`,
datos que en Idealista hay que geocodificar o deducir con expresiones
regulares. El buscador localiza ese JSON por su clave `realEstates` y no por el
nombre de la variable de JavaScript, que el framework renombra en cada
despliegue.

Con 8.000 anuncios en Barcelona, Fotocasa se recorre ordenado de más barato a
más caro. Así las primeras páginas ya contienen todo lo que cabe en el
presupuesto, y el rastreo se detiene en cuanto una página entera lo supera.

De Piso en Piso no publica el género en la tarjeta, así que el buscador abre la
ficha de cada anuncio para leer la descripción. Muchas están en catalán
("Busquem només 3 Noies estudiants"), y la detección lo contempla.

## Habitaclia

Habitaclia ya no tiene sección de habitaciones. Su página
`/pisoscompartidos.htm`, que aún aparece en los buscadores, devuelve error, lo
mismo que las cuatro variantes de URL que probé, y su portada no enlaza ninguna
categoría de habitaciones o pisos compartidos. Pertenece al mismo grupo que
Fotocasa, donde sí existe esa sección.

## Limitaciones honestas

- **Badi sigue sin funcionar.** Su API responde 401 y exige cuenta. El módulo
  está escrito (`fuentes/badi.py`) pero desactivado y sin verificar.
- **Fotocasa no publica el género del piso.** Se deduce de la descripción,
  así que sobrevive menos de lo que su volumen sugiere.
- **De Piso en Piso aporta poco volumen**: unos 10 anuncios por búsqueda, de
  los cuales sobreviven los pocos cuya descripción indica piso de chicas. A
  cambio son los únicos con coordenadas exactas.
- **"Se permiten visitas" no existe como dato en Idealista.** Sus normas de la
  casa son fumar, parejas, mascotas y menores. Se usan las dos señales más
  cercanas: `no admite parejas` (norma, resta) y la frase de ambiente
  `no suelen tener visitas` (costumbre, resta menos). Esto solo se sabe abriendo
  la ficha, y solo se abren las mejores candidatas.
- **El filtro "solo chicas" de Idealista significa "admite chicas".** El
  estricto se aplica en local, y por eso sobrevive menos de un 20% de lo
  rastreado: hacen falta varias páginas para juntar candidatas.
- **Los tiempos de trayecto son estimaciones** (±4 min), no horarios reales.
