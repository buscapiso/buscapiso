# Fase 2b: tiempos de todos a uno con MOTIS. Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pedir a Transitous (o a un MOTIS propio) una sola consulta por destino, en lugar de una por anuncio, y calcular con ella el tiempo de todos los anuncios. Además, permitir apuntar el proveedor a un servidor MOTIS local.

**Architecture:** `GET /api/v1/one-to-all?one=<destino>&time=<llegada>&arriveBy=true&maxTravelTime=90` devuelve, para cada parada desde la que se llega a tiempo, cuántos minutos antes de la hora de llegada hay que salir de ella (unas 12.500 paradas y 4 MB para Fira). El tiempo de un anuncio es el mínimo, entre las paradas a menos de 1.200 m, de esos minutos más el tramo a pie hasta la parada. Para que sea rápido, las paradas se agrupan en celdas de 0,01°. A pie y en bici se sigue usando `plan` con `directModes`, una petición por anuncio. Ese caso es raro y el grafo ya lo estima bien. La URL del servidor es un ajuste: por defecto `https://api.transitous.org`, o cualquier MOTIS propio (`./motis server` escucha en `http://localhost:8080`). El contacto solo es obligatorio con el servidor público.

**Semántica:** con este cambio, la hora de cada destino pasa a ser la hora a la que quieres llegar ("Be there by"). Los minutos cuentan desde que sales de casa hasta esa hora, incluida la espera. Es la cifra que importa para ir al trabajo, y explica por qué Sants → Fira da 22,5 min en lugar de los 19 de la consulta `plan`. Google pasa a usar `arrivalTime` en lugar de `departureTime`, para medir lo mismo.

**Spec:** `docs/specs/2026-10-08-plan-v2.md`, apartado 8.

## Global Constraints

- Rama `fase-2b`, creada desde `fase-2`. Las mismas reglas de tests, red y commits que en la fase 2.
- Fixture real recortada en `tests/fixtures/transitous_one_to_all.json` (las 862 paradas a menos de 1,3 km de Sants y de Collblanc, con llegada a Fira el martes 13 de octubre de 2026 a las 8:30).

## Review Focus

1. Un anuncio a más de 1.200 m de cualquier parada alcanzable obtiene `None` (y conserva el tiempo del grafo), nunca 0.
2. Con un MOTIS propio no se exige contacto. Con el servidor público sí.
3. Cien anuncios cuestan una petición por destino, no cien.

---

### Task 1: Proveedor "todos a uno"

**Files:** Modify `buscapiso/travel.py`, `tests/test_transitous.py`, `tests/test_google_routes.py`.

**Interfaces:**
- `TransitousProvider(contact: str = "", base_url: str = TRANSITOUS_URL, fetch=None, pause=1.0, now=...)`. Lanza `ValueError` si `base_url` es el servidor público y `contact` está vacío.
- En modo `transporte`, `trips(origins, destino)` hace una sola petición `one-to-all` y devuelve un `Trip(minutes, f"via {parada}", name)` por origen, o `None`.
- `GoogleProvider` envía `arrivalTime` en `TRANSIT`.

- [ ] **Step 1: Tests que fallan.** Añadir a `tests/test_transitous.py`:

```python
def test_transit_uses_one_request_for_all_origins():
    llamadas = []

    def fetch(url, headers):
        llamadas.append(url)
        return json.loads((FIX / "transitous_one_to_all.json").read_text())

    p = TransitousProvider("ana@example.org", fetch=fetch, pause=0)
    lejos = (41.5931, 1.8378)
    viajes = p.trips([SANTS, (41.37587, 2.1184), lejos], FIRA)
    assert len(llamadas) == 1
    q = urllib.parse.parse_qs(urllib.parse.urlparse(llamadas[0]).query)
    assert "/api/v1/one-to-all" in llamadas[0]
    assert q["one"] == ["41.3519,2.1307"] and q["arriveBy"] == ["true"]
    assert viajes[0].minutes == pytest.approx(22.6, abs=0.5)
    assert viajes[0].detail == "via Barcelona Sants"
    assert viajes[1].minutes == pytest.approx(15.4, abs=0.5)
    assert viajes[2] is None


def test_a_local_motis_needs_no_contact():
    p = TransitousProvider(base_url="http://localhost:8080")
    assert p.name == "transitous"
    with pytest.raises(ValueError):
        TransitousProvider(base_url="https://api.transitous.org")
```

Sustituir `test_transit_takes_the_fastest_itinerary_and_names_its_lines` y `test_one_failed_request_gives_none_for_that_origin` (que usaban `plan` en modo transporte) por versiones en modo `a_pie`, porque `plan` queda solo para a pie y bici. `test_all_requests_failing_is_a_travel_error` sigue valiendo: si falla la única petición `one-to-all`, se lanza `TravelError`.

En `tests/test_google_routes.py`, cambiar `body["departureTime"]` por `body["arrivalTime"]` en el primer test, y en el de a pie comprobar que no aparece ninguno de los dos.

- [ ] **Step 2: Implementar.** En `travel.py`:

```python
TRANSITOUS_URL = "https://api.transitous.org"
RADIO_PARADA_M = 1200.0


def _celda_parada(lat: float, lon: float) -> tuple[int, int]:
    return int(lat * 100), int(lon * 100)


class _Paradas:
    """Paradas con sus minutos hasta el destino, agrupadas por celdas de 0,01 grados."""

    def __init__(self, todas: list[dict]):
        self.celdas: dict[tuple[int, int], list[tuple[float, float, float, str]]] = {}
        for x in todas:
            p = x["place"]
            self.celdas.setdefault(_celda_parada(p["lat"], p["lon"]), []).append(
                (p["lat"], p["lon"], float(x["duration"]), p.get("name", "")))

    def mejor(self, lat: float, lon: float) -> tuple[float, str] | None:
        ci, cj = _celda_parada(lat, lon)
        mejor = None
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                for plat, plon, minutos, nombre in self.celdas.get((ci + di, cj + dj), ()):
                    m = haversine_m(lat, lon, plat, plon)
                    if m <= RADIO_PARADA_M:
                        total = minutos + minutos_andando(m)
                        if mejor is None or total < mejor[0]:
                            mejor = (total, nombre)
        return mejor
```

Con celdas de 0,01° (~1,1 km de latitud y ~830 m de longitud) y las vecinas, se cubre el radio de 1.200 m en latitud y casi por completo en longitud. Las paradas que caen fuera estarían a más de 830 m en ese eje, y alguna más cercana suele ganar igualmente.

En `TransitousProvider`:
- El constructor acepta `contact=""` y `base_url=TRANSITOUS_URL`. Solo exige contacto si `base_url.rstrip("/") == TRANSITOUS_URL`. La cabecera es `transitous_user_agent(contact)` si hay contacto, o `"buscapiso/0.2"` si no.
- `_url` construye `f"{self.base}/api/v4/plan?..."` (solo a pie y en bici).
- `_url_todos(d)` construye `f"{self.base}/api/v1/one-to-all?one={lat},{lon}&time=<llegada>&arriveBy=true&maxTravelTime=90"`, donde la llegada es `next_departure(d["salida"], now())`.
- En `trips`, si el modo es `transporte`: una petición a `_url_todos`. Si falla, `TravelError`. Si no, `_Paradas(datos["all"])` y, por cada origen, `Trip(total, f"via {nombre}", self.name)` o `None`. Los demás modos siguen el bucle actual.

En `GoogleProvider`, `body["arrivalTime"]` en lugar de `body["departureTime"]`.

- [ ] **Step 3:** `.venv/bin/python -m pytest tests -q` en verde, y commit `feat: one request per destination with MOTIS one-to-all`.

### Task 2: Servidor MOTIS configurable

**Files:** Modify `buscapiso/travel.py` (`provider_from_settings`), `buscapiso/api/app.py`, `tests/test_refine.py`, `tests/test_api_settings.py`, `web/src/lib/api.ts`, `web/src/lib/components/TravelSettings.svelte`, su test y `en.json`.

- Ajuste nuevo `motis_url` (por defecto `https://api.transitous.org`). `GET /api/settings` lo devuelve. `PUT` lo acepta, y solo exige contacto cuando `motis_url` es el servidor público.
- `provider_from_settings` crea `TransitousProvider(contact, base_url=motis_url)`.
- En `TravelSettings`, con Transitous elegido, un campo `t('travel.server')` con la ayuda `t('travel.serverHelp')`. El contacto solo es obligatorio si el servidor es el público.
- La etiqueta del destino `profile.destDepart` pasa a ser "Be there by".
- Tests: `test_settings_choose_the_provider` añade el caso de servidor local sin contacto; `test_api_settings` añade `test_a_local_motis_server_needs_no_contact`; el test de `TravelSettings` comprueba que con servidor local se puede guardar sin contacto.
- Commit `feat: point the timetable provider at your own MOTIS server`.

### Task 3: Documentación

- En el README, sección "Tu propio servidor MOTIS": descargar el binario `motis-linux-amd64` de las releases de `motis-project/motis`, un extracto OSM de Cataluña (Geofabrik) y los GTFS (TMB pide registro en developer.tmb.cat; FGC y AMB los publican en sus portales de datos abiertos), y ejecutar `./motis config cataluna.osm.pbf tmb.zip fgc.zip …`, `./motis import` y `./motis server`. Después, en Settings, servidor `http://localhost:8080`.
- En la spec, apartado 8: la consulta `one-to-all` (una por destino), la medida "salir para llegar a las 8:30" y el servidor configurable.
- Commit `docs: self-hosted MOTIS and one-to-all travel times`.
