"""Perfiles de busqueda: lo que quiere la usuaria, validado y en ingles.

La web app de la fase 1 edita estos modelos. El motor sigue leyendo el
diccionario en espanol que antes daba config.yaml: to_engine_cfg() lo
construye y from_engine_cfg() convierte un config.yaml antiguo en perfil.
Las dos direcciones van juntas; tests/test_profiles.py comprueba la ida y
vuelta.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

Source = Literal["idealista", "fotocasa", "roomgo", "depisoenpiso"]
Sort = Literal["newest", "cheapest", "relevance"]
Mode = Literal["transit", "walk", "bike"]

DEFAULT_WEIGHTS: dict[str, float] = {
    "minutos_gratis": 10,
    "euro_sobre_ideal": 0.12,
    "gastos_incluidos": 8,
    "novedad": 25,
    "dias_para_ser_nuevo": 7,
    "dias_para_estar_rancio": 90,
    "rancio": 30,
    "ambiente_joven": 8,
    "temporal": 25,
    "companeros_comodos": 3,
    "por_companero_extra": 4,
    "visitas": 10,
    "no_admite_parejas": 6,
    "edad_afin": 27,
    "margen_edad": 8,
    "dias_de_espera_tolerables": 21,
    "por_dia_de_espera": 0.8,
    "espera_maxima": 30,
    "zona_preferida": 12,
    "zona_penalizada": 20,
    "ubicacion_estimada": 6,
}

_GENDER = {"female_only": "chicas", "male_only": "chicos", "mixed": "mixto",
           "any": "cualquiera"}
_MODE = {"transit": "transporte", "walk": "a_pie", "bike": "bici"}
_VISITS = {"strict": "estricto", "preferred": "preferible", "indifferent": "indiferente"}
_SORT = {"newest": "nuevos", "cheapest": "baratos", "relevance": "relevancia"}
_IDEALISTA = {"no_live_in_owner": "sin_propietario", "with_students": "con_estudiantes",
              "with_workers": "con_trabajadores", "exterior": "exterior",
              "non_smokers": "sin_fumadores", "last_48h": "publicado_48h"}


def _invert(d: dict) -> dict:
    return {v: k for k, v in d.items()}


class Destination(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    max_minutes: float | None = Field(default=None, gt=0)
    minute_weight: float = Field(default=1.0, ge=0)
    mode: Mode = "transit"
    depart_at: str = Field(default="08:30", pattern=r"^([01]\d|2[0-3]):[0-5]\d$")


class Budget(BaseModel):
    ideal_total: int = Field(default=500, gt=0)
    max_total: int = Field(default=650, gt=0)
    assumed_expenses: int = Field(default=55, ge=0)

    @model_validator(mode="after")
    def _ideal_not_above_max(self) -> "Budget":
        if self.ideal_total > self.max_total:
            raise ValueError("ideal_total cannot be above max_total")
        return self


class Household(BaseModel):
    gender: Literal["female_only", "male_only", "mixed", "any"] = "any"
    ask_if_gender_unknown: bool = True
    min_score_to_ask: float = 60
    no_live_in_owner: bool = True
    visits: Literal["strict", "preferred", "indifferent"] = "preferred"


class Zones(BaseModel):
    exclude: list[str] = Field(default_factory=list)
    penalize: list[str] = Field(default_factory=list)
    prefer: list[str] = Field(default_factory=list)


class IdealistaFilters(BaseModel):
    max_price: int | None = Field(default=None, gt=0)
    no_live_in_owner: bool = False
    with_students: bool = False
    with_workers: bool = False
    exterior: bool = False
    non_smokers: bool = False
    last_48h: bool = False


class Crawl(BaseModel):
    sort: Sort = "newest"
    fotocasa_sort: Sort = "cheapest"
    max_pages: int = Field(default=3, ge=1, le=20)
    details_to_read: int = Field(default=12, ge=0, le=100)
    real_travel_times: int = Field(default=40, ge=0, le=200)


class SearchProfile(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    sources: list[Source] = Field(
        default_factory=lambda: ["idealista", "fotocasa", "roomgo", "depisoenpiso"],
        min_length=1)
    destinations: list[Destination] = Field(default_factory=list)
    budget: Budget = Field(default_factory=Budget)
    household: Household = Field(default_factory=Household)
    zones: Zones = Field(default_factory=Zones)
    idealista: IdealistaFilters = Field(default_factory=IdealistaFilters)
    crawl: Crawl = Field(default_factory=Crawl)
    weights: dict[str, float] = Field(default_factory=lambda: dict(DEFAULT_WEIGHTS))

    @field_validator("weights")
    @classmethod
    def _known_weights(cls, v: dict[str, float]) -> dict[str, float]:
        unknown = set(v) - set(DEFAULT_WEIGHTS)
        if unknown:
            raise ValueError(f"unknown weights: {', '.join(sorted(unknown))}")
        return {**DEFAULT_WEIGHTS, **v}

    @field_validator("destinations")
    @classmethod
    def _unique_destination_names(cls, v: list[Destination]) -> list[Destination]:
        names = [d.name for d in v]
        if len(names) != len(set(names)):
            raise ValueError("destination names must be unique")
        return v


def to_engine_cfg(p: SearchProfile) -> tuple[dict, dict]:
    """(cfg, zonas) con la forma que espera pipeline.run_search."""
    cfg = {
        "fuentes": list(p.sources),
        "filtros_idealista": {
            "precio_max": p.idealista.max_price,
            **{_IDEALISTA[k]: getattr(p.idealista, k) for k in _IDEALISTA},
        },
        "presupuesto": {
            "coste_total_ideal": p.budget.ideal_total,
            "coste_total_maximo": p.budget.max_total,
            "gastos_si_no_declara": p.budget.assumed_expenses,
        },
        "requisitos": {
            "genero": _GENDER[p.household.gender],
            "preguntar_si_genero_desconocido": p.household.ask_if_gender_unknown,
            "puntos_minimos_para_preguntar": p.household.min_score_to_ask,
            "sin_propietario": p.household.no_live_in_owner,
            "visitas_permitidas": _VISITS[p.household.visits],
        },
        "destinos": [
            {"nombre": d.name, "lat": d.lat, "lon": d.lon,
             "max_minutos": d.max_minutes, "peso_minuto": d.minute_weight,
             "modo": _MODE[d.mode], "salida": d.depart_at}
            for d in p.destinations
        ],
        "pesos": dict(p.weights),
        "busqueda": {
            "orden": _SORT[p.crawl.sort],
            "orden_fotocasa": _SORT[p.crawl.fotocasa_sort],
            "max_paginas_por_municipio": p.crawl.max_pages,
            "fichas_a_enriquecer": p.crawl.details_to_read,
            "trayectos_reales": p.crawl.real_travel_times,
        },
    }
    zonas = {"excluir": list(p.zones.exclude), "penalizar": list(p.zones.penalize),
             "preferir": list(p.zones.prefer)}
    return cfg, zonas


def from_engine_cfg(cfg: dict, zonas: dict, name: str) -> SearchProfile:
    """Convierte un config.yaml + zonas.yaml en un perfil."""
    req, pres, bus = cfg["requisitos"], cfg["presupuesto"], cfg["busqueda"]
    filtros = cfg.get("filtros_idealista", {})
    idealista_en = _invert(_IDEALISTA)
    return SearchProfile(
        name=name,
        sources=cfg.get("fuentes", ["idealista"]),
        destinations=[
            Destination(name=d["nombre"], lat=d["lat"], lon=d["lon"],
                        max_minutes=d.get("max_minutos"),
                        minute_weight=d.get("peso_minuto", 1.0),
                        mode=_invert(_MODE)[d.get("modo", "transporte")],
                        depart_at=d.get("salida", "08:30"))
            for d in cfg.get("destinos", [])
        ],
        budget=Budget(ideal_total=pres["coste_total_ideal"],
                      max_total=pres["coste_total_maximo"],
                      assumed_expenses=pres["gastos_si_no_declara"]),
        household=Household(
            gender=_invert(_GENDER)[req.get("genero", "cualquiera")],
            ask_if_gender_unknown=req.get("preguntar_si_genero_desconocido", True),
            min_score_to_ask=req.get("puntos_minimos_para_preguntar", 60),
            no_live_in_owner=req.get("sin_propietario", True),
            visits=_invert(_VISITS)[req.get("visitas_permitidas", "preferible")],
        ),
        zones=Zones(exclude=zonas.get("excluir") or [],
                    penalize=zonas.get("penalizar") or [],
                    prefer=zonas.get("preferir") or []),
        idealista=IdealistaFilters(
            max_price=filtros.get("precio_max"),
            **{idealista_en[k]: bool(v) for k, v in filtros.items() if k in idealista_en},
        ),
        crawl=Crawl(sort=_invert(_SORT)[bus.get("orden", "nuevos")],
                    fotocasa_sort=_invert(_SORT)[bus.get("orden_fotocasa", "baratos")],
                    max_pages=bus.get("max_paginas_por_municipio", 3),
                    details_to_read=bus.get("fichas_a_enriquecer", 12),
                    real_travel_times=bus.get("trayectos_reales", 40)),
        weights=cfg.get("pesos", {}),
    )
