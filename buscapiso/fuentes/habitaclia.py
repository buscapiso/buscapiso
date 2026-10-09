"""Fuente Habitaclia, pisos enteros en alquiler.

Habitaclia ya no tiene seccion de habitaciones (ver fotocasa.py), pero sus
pisos se leen sin navegador: una peticion HTTP normal devuelve la pagina con
todos los datos en `window.__INITIAL_PROPS__ = JSON.parse("...")`. Ese JSON
trae precio, habitaciones, banos, metros, planta, caracteristicas (ascensor,
amueblado), coordenadas y fecha de actualizacion.

Los filtros van en la URL (maxPrice, minRooms, minSurface): probado el
2026-10-09, Barcelona pasa de 3.050 pisos a 60 con 1.400 EUR, 2 habitaciones
y 60 m2. No hay orden por fecha (sortBy solo acepta PRICE_ASC de lo probado).

Al ritmo de una persona: una pausa entre paginas y un User-Agent normal.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import pathlib
import random
import re
import time
import urllib.error
import urllib.parse
import urllib.request

from buscapiso.events import emit
from buscapiso.fuentes.base import Fuente, superficie
from buscapiso.modelo import TIPO_PISO, Anuncio

BASE = "https://www.habitaclia.com"
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/141.0 Safari/537.36")
_MARCA = "__INITIAL_PROPS__ = JSON.parse("

_PLANTAS = {"BASEMENT": "-1", "SEMI_BASEMENT": "-1", "GROUND": "0", "MEZZANINE": "0",
            "FIRST": "1", "SECOND": "2", "THIRD": "3", "FOURTH": "4", "FIFTH": "5",
            "SIXTH": "6", "SEVENTH": "7", "EIGHTH": "8", "NINTH": "9", "TENTH": "10",
            "PENTHOUSE": "penthouse"}


class HTTPError(RuntimeError):
    """Habitaclia no ha respondido con una pagina."""


def construir_url(zona: str, pagina: int = 1, filtros: dict | None = None) -> str:
    url = f"{BASE}/alquiler/viviendas/barcelona-provincia/{zona}/s"
    if pagina > 1:
        url += f"/{pagina}"
    q = {k: v for k, v in (filtros or {}).items() if v}
    return url + ("?" + urllib.parse.urlencode(q) if q else "")


def _props(html: str) -> dict | None:
    i = html.find(_MARCA)
    if i < 0:
        return None
    try:
        # El argumento de JSON.parse es una cadena JSON que contiene JSON.
        cadena, _ = json.JSONDecoder().raw_decode(html[i + len(_MARCA):])
        return json.loads(cadena)
    except (json.JSONDecodeError, TypeError):
        return None


def _contexto(html: str) -> dict:
    d = _props(html) or {}
    return (d.get("initialSearchResultsPage") or {}).get("initialSearchContext") or {}


def paginas_totales(html: str) -> int:
    pag = (_contexto(html).get("results") or {}).get("pagination") or {}
    return int(pag.get("totalPages") or 0)


def _dias_desde(fecha: str | None) -> int | None:
    """Dias desde la ultima actualizacion. Habitaclia no publica la fecha de
    alta en el listado; la de actualizacion es lo mas parecido."""
    if not fecha:
        return None
    try:
        cuando = dt.datetime.fromisoformat(re.sub(r"(\.\d{6})\d+", r"\1", fecha))
    except ValueError:
        return None
    return max(0, (dt.datetime.now(cuando.tzinfo) - cuando).days)


def _a_anuncio(it: dict) -> Anuncio | None:
    id_portal = it.get("id")
    ruta = (it.get("urls") or {}).get("canonical") or it.get("navigationUrl")
    if not id_portal or not ruta:
        return None
    resumen = it.get("summary") or {}
    loc = resumen.get("location") or {}
    prop = it.get("property") or {}
    tiene = set((prop.get("features") or {}).get("has") or [])
    no_tiene = set((prop.get("features") or {}).get("hasNot") or [])
    dinamicas = set(prop.get("dynamicFeatures") or [])
    coords = loc.get("coordinates") or {}
    calle = loc.get("address") or {}
    barrio = next((c.get("value") for c in loc.get("layers") or []
                   if c.get("type") == "neighbourhood"), "") or loc.get("district") or ""
    fotos = (resumen.get("multimedia") or {}).get("images") or []

    def si_no(clave: str) -> bool | None:
        return True if clave in tiene else False if clave in no_tiene else None

    return Anuncio(
        portal="habitaclia",
        id_portal=str(id_portal),
        url=BASE + ruta if ruta.startswith("/") else ruta,
        tipo=TIPO_PISO,
        titulo=resumen.get("title") or barrio or "Piso",
        precio=((it.get("transaction") or {}).get("price") or {}).get("amount") or None,
        direccion=" ".join(x for x in (calle.get("streetName"), calle.get("streetNumber")) if x),
        barrio=barrio,
        municipio=(loc.get("municipality") or "").removesuffix(" Capital"),
        lat=coords.get("latitude"),
        lon=coords.get("longitude"),
        # ZONE y STREET son posiciones de la zona o de la calle, no del portal.
        coords_aproximadas=loc.get("visibility") != "EXACT",
        habitaciones=prop.get("rooms"),
        banos=prop.get("bathrooms"),
        superficie_m2=superficie(prop.get("builtSurface")),
        planta=_PLANTAS.get(prop.get("floor") or "", ""),
        ascensor=si_no("ELEVATOR"),
        amueblado=si_no("FURNISHED"),
        exterior=True if "IS_EXTERIOR" in dinamicas else None,
        descripcion=(resumen.get("description") or "").strip(),
        descripcion_extra=("Alquiler temporal según el portal"
                           if "IS_TEMPORARY" in dinamicas else ""),
        foto=next((f["url"] for f in fotos if f.get("url")), ""),
        antiguedad_dias=_dias_desde(resumen.get("updatedAt")),
    )


def parsear_listado(html: str) -> list[Anuncio]:
    items = (_contexto(html).get("results") or {}).get("items") or []
    return [a for a in (_a_anuncio(it) for it in items) if a]


def _get_http(url: str) -> str:
    req = urllib.request.Request(url, headers={
        "User-Agent": UA, "Accept-Language": "es-ES,es;q=0.9,en;q=0.8"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        raise HTTPError(f"HTTP {e.code}") from e
    except (urllib.error.URLError, TimeoutError) as e:
        raise HTTPError(str(e)) from e


class Habitaclia(Fuente):
    nombre = "habitaclia"

    def __init__(self, cache_dir: pathlib.Path | None = None, pausa=(3.0, 6.0),
                 get=_get_http):
        self.cache_dir = cache_dir
        self.pausa = pausa
        self._get = get

    def _guardar(self, url: str, html: str) -> None:
        if not self.cache_dir:
            return
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        nombre = re.sub(r"\W+", "_", url.replace(BASE, ""))[:70]
        firma = hashlib.sha1(url.encode()).hexdigest()[:8]
        (self.cache_dir / f"habitaclia_{nombre}_{firma}.html").write_text(
            html, encoding="utf-8")

    def buscar(self, cfg: dict, max_paginas: int = 3) -> list[Anuncio]:
        zonas = cfg.get("zonas_habitaclia") or ["barcelona-capital"]
        piso = cfg.get("piso") or {}
        filtros = {
            "maxPrice": cfg.get("presupuesto", {}).get("coste_total_maximo"),
            "minRooms": piso.get("habitaciones_min") or None,
            "minSurface": piso.get("superficie_min"),
        }
        if cfg.get("busqueda", {}).get("orden_fotocasa") == "baratos":
            filtros["sortBy"] = "PRICE_ASC"

        resultados, vistos = [], set()
        primera = True
        for zona in zonas:
            for pagina in range(1, max_paginas + 1):
                if not primera:
                    time.sleep(random.uniform(*self.pausa))
                primera = False
                url = construir_url(zona, pagina, filtros)
                try:
                    html = self._get(url)
                except HTTPError as e:
                    emit("warning", f"  habitaclia {zona} page {pagina} failed ({e}); going on")
                    break
                lote = [a for a in parsear_listado(html) if a.id_portal not in vistos]
                if pagina == 1 and not lote and _props(html) is None:
                    emit("warning", f"  habitaclia {zona}: the page has no listings data "
                                    "(the site may have changed); going on")
                    break
                self._guardar(url, html)
                vistos.update(a.id_portal for a in lote)
                resultados.extend(lote)
                emit("info", f"  habitaclia {zona.split('/')[-1]} page {pagina}: "
                             f"{len(lote)} listings")
                if not lote or pagina >= paginas_totales(html):
                    break
        return resultados
