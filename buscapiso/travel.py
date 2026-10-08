"""Tiempos de trayecto: el grafo propio y los proveedores con horarios reales.

Todo proveedor devuelve Trip por cada origen, o None si no hay forma
razonable de llegar. El grafo propio es el respaldo: no necesita red ni
clave y nunca lanza TravelError.
"""
from __future__ import annotations

from dataclasses import dataclass

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
