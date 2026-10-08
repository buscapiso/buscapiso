"""Modelos de la API. Aqui, y solo aqui, los datos del motor (en espanol)
pasan a los nombres en ingles que ve el frontend."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from buscapiso.almacen import ESTADOS

Status = Literal["new", "liked", "hidden", "contacted", "visit_scheduled", "visited",
                 "applied", "got_it", "rejected", "discarded"]
assert set(Status.__args__) == set(ESTADOS)

_GENERO = {"chicas": "female_only", "chicos": "male_only", "mixto": "mixed",
           "desconocido": "unknown"}


class HistoryEntry(BaseModel):
    status: Status
    note: str
    at: str


class Listing(BaseModel):
    id: str
    portal: str
    url: str
    title: str
    price: int | None
    expenses: int | None
    total_cost: int | None
    neighbourhood: str
    municipality: str
    lat: float | None
    lon: float | None
    approximate_location: bool
    photo: str
    description: str
    travel: dict[str, float]
    routes: dict[str, str]
    travel_source: str
    score: float
    reasons: list[str]
    gender: str
    gender_confirmed: bool
    roommates: int | None
    available_from: str
    published: str
    also_on: list[str]
    status: Status
    note: str
    group: Literal["accepted", "possible"]
    first_seen: str
    last_seen: str


class ListingDetail(Listing):
    history: list[HistoryEntry]


class StatusChange(BaseModel):
    status: Status
    note: str | None = None


class NoteChange(BaseModel):
    note: str


def _web_url(url: str) -> str:
    """Solo enlaces web: la URL viene del HTML de un portal, y un javascript:
    en un href se ejecutaria dentro de la app."""
    return url if url.strip().lower().startswith(("http://", "https://")) else ""


def listing_from_row(row: dict) -> Listing:
    d = row["datos"]
    return Listing(
        id=d["id"], portal=d["portal"], url=_web_url(d.get("url", "")), title=d.get("titulo", ""),
        price=d.get("precio"), expenses=d.get("gastos_extra"),
        total_cost=d.get("coste_total"),
        neighbourhood=d.get("barrio", ""), municipality=d.get("municipio", ""),
        lat=d.get("lat"), lon=d.get("lon"),
        approximate_location=d.get("coords_aproximadas", True),
        photo=d.get("foto", ""), description=d.get("descripcion", ""),
        travel=d.get("trayectos", {}), routes=d.get("rutas", {}),
        travel_source=d.get("trayectos_fuente", "graph"),
        score=d.get("puntuacion", 0.0), reasons=d.get("motivos", []),
        gender=_GENERO.get(d.get("genero_piso", "desconocido"), "unknown"),
        gender_confirmed=d.get("genero_confirmado", False),
        roommates=d.get("companeros"), available_from=d.get("disponible_desde", ""),
        published=d.get("publicado_texto", ""), also_on=d.get("tambien_en", []),
        status=row["estado"], note=row["nota"], group=row["grupo"],
        first_seen=row["primera_vez"], last_seen=row["ultima_vez"],
    )


def detail_from_row(row: dict) -> ListingDetail:
    return ListingDetail(
        **listing_from_row(row).model_dump(),
        history=[HistoryEntry(status=e, note=n, at=c) for e, n, c in row["historial"]],
    )
