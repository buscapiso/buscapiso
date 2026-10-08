"""Tiempos de trayecto: el grafo propio y los proveedores con horarios reales.

Todo proveedor devuelve Trip por cada origen, o None si no hay forma
razonable de llegar. El grafo propio es el respaldo: no necesita red ni
clave y nunca lanza TravelError.
"""
from __future__ import annotations

import datetime as dt
import json
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Callable, Protocol
from zoneinfo import ZoneInfo

from buscapiso.transporte import FACTOR_RODEO, Red, haversine_m, minutos_andando

BICI_M_MIN = 250.0          # 15 km/h
BICI_EXTRA_MIN = 2.0        # coger y dejar la bici


class TravelError(Exception):
    """El proveedor no ha podido responder (red, cupo, clave)."""


@dataclass(frozen=True)
class Trip:
    minutes: float
    detail: str
    source: str


def graph_trip(red: Red, lat: float, lon: float, destino: dict) -> Trip | None:
    modo = destino.get("modo", "transporte")
    metros = haversine_m(lat, lon, destino["lat"], destino["lon"])
    if modo == "a_pie":
        return Trip(minutos_andando(metros), "walk", "graph")
    if modo == "bici":
        return Trip(metros * FACTOR_RODEO / BICI_M_MIN + BICI_EXTRA_MIN, "bike", "graph")
    r = red.ruta_a_punto(lat, lon, destino["lat"], destino["lon"])
    return Trip(r.minutos, r.detalle, "graph") if r is not None else None


MADRID = ZoneInfo("Europe/Madrid")


def next_departure(hhmm: str, now: dt.datetime) -> dt.datetime:
    """Proximo dia laborable, a partir de manana, a esa hora de Madrid, en UTC.
    Los horarios reales cambian con el dia y la hora: un piso a 20 min a las
    8:30 de un martes puede estar a 35 un domingo a medianoche."""
    h, m = (int(x) for x in hhmm.split(":"))
    dia = now.astimezone(MADRID).date() + dt.timedelta(days=1)
    while dia.weekday() >= 5:
        dia += dt.timedelta(days=1)
    local = dt.datetime(dia.year, dia.month, dia.day, h, m, tzinfo=MADRID)
    return local.astimezone(dt.timezone.utc)


class TravelProvider(Protocol):
    name: str

    def trips(self, origins: list[tuple[float, float]], destino: dict) -> list[Trip | None]: ...


class GraphProvider:
    name = "graph"

    def __init__(self, red: Red):
        self.red = red

    def trips(self, origins, destino):
        return [graph_trip(self.red, lat, lon, destino) for lat, lon in origins]


def _celda(x: float) -> float:
    """Redondeo a 1/2000 de grado: unos 55 m de latitud y 40 de longitud."""
    return round(x * 2000) / 2000


class CachedProvider:
    def __init__(self, inner: TravelProvider, con: sqlite3.Connection, ttl_days: int = 7,
                 now: Callable[[], dt.datetime] = lambda: dt.datetime.now(dt.timezone.utc)):
        self.inner, self.con, self.ttl, self.now = inner, con, dt.timedelta(days=ttl_days), now
        self.name = inner.name

    def _clave(self, lat, lon, d) -> tuple:
        return (self.name, d.get("modo", "transporte"), d.get("salida", "08:30"),
                _celda(lat), _celda(lon), _celda(d["lat"]), _celda(d["lon"]))

    def trips(self, origins, destino):
        limite = (self.now() - self.ttl).isoformat()
        resultado: list[Trip | None] = []
        faltan: list[int] = []
        for i, (lat, lon) in enumerate(origins):
            fila = self.con.execute(
                "SELECT minutos, detalle FROM trayectos WHERE proveedor=? AND modo=? AND "
                "salida=? AND lat=? AND lon=? AND dlat=? AND dlon=? AND cuando >= ?",
                (*self._clave(lat, lon, destino), limite)).fetchone()
            resultado.append(Trip(fila[0], fila[1], self.name) if fila else None)
            if fila is None:
                faltan.append(i)
        if faltan:
            nuevos = self.inner.trips([origins[i] for i in faltan], destino)
            with self.con:
                for i, t in zip(faltan, nuevos):
                    resultado[i] = t
                    if t is not None:
                        self.con.execute(
                            "INSERT OR REPLACE INTO trayectos VALUES (?,?,?,?,?,?,?,?,?,?)",
                            (*self._clave(*origins[i], destino), t.minutes, t.detail,
                             self.now().isoformat()))
        return resultado


PROJECT_URL = "https://github.com/feal-ca/buscapiso"
TRANSITOUS_PLAN = "https://api.transitous.org/api/v4/plan"


def transitous_user_agent(contact: str) -> str:
    return f"buscapiso/0.2 (+{PROJECT_URL}; contact: {contact.strip()})"


def _get_json(url: str, headers: dict) -> dict:
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def _lineas(itinerario: dict) -> str:
    lineas = [leg["routeShortName"] for leg in itinerario.get("legs", [])
              if leg.get("routeShortName")]
    return " > ".join(lineas) or "walk"


class TransitousProvider:
    """API publica de Transitous (MOTIS). Sus condiciones: proyecto abierto y no
    comercial, User-Agent con contacto, y avisarles antes de un uso intensivo."""
    name = "transitous"

    def __init__(self, contact: str, fetch: Callable[[str, dict], dict] | None = None,
                 pause: float = 1.0,
                 now: Callable[[], dt.datetime] = lambda: dt.datetime.now(dt.timezone.utc)):
        if not contact.strip():
            raise ValueError("Transitous needs a contact (email or URL) in the User-Agent")
        self.headers = {"User-Agent": transitous_user_agent(contact)}
        self.fetch = fetch or _get_json
        self.pause, self.now = pause, now

    def _url(self, lat, lon, d) -> str:
        cuando = next_departure(d.get("salida", "08:30"), self.now())
        q = {"fromPlace": f"{lat},{lon}", "toPlace": f"{d['lat']},{d['lon']}",
             "time": cuando.strftime("%Y-%m-%dT%H:%M:%SZ")}
        modo = d.get("modo", "transporte")
        if modo in ("a_pie", "bici"):
            q["directModes"] = "WALK" if modo == "a_pie" else "BIKE"
            q["maxDirectTime"] = "7200"
        return f"{TRANSITOUS_PLAN}?{urllib.parse.urlencode(q)}"

    def _trip(self, datos: dict, modo: str) -> Trip | None:
        if modo in ("a_pie", "bici"):
            directos = datos.get("direct") or []
            if not directos:
                return None
            return Trip(directos[0]["duration"] / 60, "walk" if modo == "a_pie" else "bike",
                        self.name)
        itinerarios = datos.get("itineraries") or []
        if not itinerarios:
            return None
        mejor = min(itinerarios, key=lambda i: i["duration"])
        return Trip(mejor["duration"] / 60, _lineas(mejor), self.name)

    def trips(self, origins, destino):
        modo = destino.get("modo", "transporte")
        salida: list[Trip | None] = []
        fallos = 0
        for i, (lat, lon) in enumerate(origins):
            if i and self.pause:
                time.sleep(self.pause)
            try:
                salida.append(self._trip(self.fetch(self._url(lat, lon, destino),
                                                    self.headers), modo))
            except (OSError, ValueError, KeyError) as e:
                fallos += 1
                ultimo = e
                salida.append(None)
        if origins and fallos == len(origins):
            raise TravelError(f"Transitous did not answer: {ultimo}")
        return salida


GOOGLE_MATRIX = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix"
_GOOGLE_MODE = {"transporte": "TRANSIT", "a_pie": "WALK", "bici": "BICYCLE"}
GOOGLE_BATCH = 100


def _post_json(url: str, headers: dict, body: dict) -> list:
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={**headers, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


class GoogleProvider:
    """Routes API de Google, con la clave de la usuaria. Cobra por elemento
    (origen x destino), con un cupo gratuito mensual."""
    name = "google"

    def __init__(self, api_key: str, post: Callable[[str, dict, dict], list] | None = None,
                 now: Callable[[], dt.datetime] = lambda: dt.datetime.now(dt.timezone.utc)):
        self.key, self.post, self.now = api_key, post or _post_json, now

    def trips(self, origins, destino):
        modo = _GOOGLE_MODE[destino.get("modo", "transporte")]
        headers = {"X-Goog-Api-Key": self.key,
                   "X-Goog-FieldMask": "originIndex,destinationIndex,duration,condition"}
        salida: list[Trip | None] = [None] * len(origins)
        for inicio in range(0, len(origins), GOOGLE_BATCH):
            bloque = origins[inicio:inicio + GOOGLE_BATCH]
            body = {
                "origins": [{"waypoint": {"location": {"latLng":
                            {"latitude": lat, "longitude": lon}}}} for lat, lon in bloque],
                "destinations": [{"waypoint": {"location": {"latLng":
                                 {"latitude": destino["lat"], "longitude": destino["lon"]}}}}],
                "travelMode": modo,
            }
            if modo == "TRANSIT":
                body["departureTime"] = next_departure(
                    destino.get("salida", "08:30"), self.now()).strftime("%Y-%m-%dT%H:%M:%SZ")
            try:
                elementos = self.post(GOOGLE_MATRIX, headers, body)
            except urllib.error.HTTPError as e:
                raise TravelError(f"Google Routes answered HTTP {e.code}") from None
            except OSError as e:
                raise TravelError(f"Google Routes did not answer: {e}") from None
            for el in elementos:
                if el.get("condition") == "ROUTE_EXISTS" and "duration" in el:
                    segundos = float(el["duration"].rstrip("s"))
                    salida[inicio + el["originIndex"]] = Trip(segundos / 60, "Google", self.name)
        return salida


def provider_from_settings(con, get_key=None, cached: bool = True
                           ) -> tuple[object | None, str | None]:
    """(proveedor, aviso) segun los ajustes. cached=False para la prueba de
    trayecto de la web, que debe preguntar al proveedor de verdad."""
    from buscapiso import almacen, keys
    ajustes = almacen.leer_ajustes(con)
    cual = ajustes.get("travel_provider", "graph")
    if cual == "transitous":
        contacto = ajustes.get("transitous_contact", "").strip()
        if not contacto:
            return None, "Transitous needs a contact (email or URL) in the settings"
        p = TransitousProvider(contacto)
        return (CachedProvider(p, con) if cached else p), None
    if cual == "google":
        clave = (get_key or keys.get_google_key)()
        if not clave:
            return None, "Google Routes needs an API key in the settings"
        p = GoogleProvider(clave)
        return (CachedProvider(p, con) if cached else p), None
    return None, None
