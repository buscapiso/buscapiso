"""API JSON y servidor de la web app."""
from __future__ import annotations

import asyncio
import contextlib
import json
import pathlib
import sqlite3

from typing import Literal

from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from buscapiso import almacen, keys, paths
from buscapiso.api.schemas import (Listing, ListingDetail, NoteChange, StatusChange,
                                   detail_from_row, listing_from_row)
from buscapiso.api.searches import SearchRunner
from buscapiso.geocodificador import Geocodificador
from buscapiso.pipeline import SearchOptions
from buscapiso.profiles import SearchProfile, to_engine_cfg
from buscapiso.seed import active_profile
from buscapiso.transporte import Red
from buscapiso.travel import (TRANSITOUS_URL, GraphProvider, TravelError,
                              provider_from_settings)

WEB_DIST = pathlib.Path(__file__).resolve().parents[1] / "web_dist"
SOURCES = ["idealista", "fotocasa", "roomgo", "depisoenpiso"]
GENDERS = ["female_only", "male_only", "mixed", "any"]


class SearchRequest(BaseModel):
    skip_details: bool = False
    from_cache: bool = False
    pages: int | None = None


class SettingsChange(BaseModel):
    travel_provider: Literal["graph", "transitous", "google"] | None = None
    transitous_contact: str | None = None
    motis_url: str | None = None
    google_key: str | None = None


def create_app(db_path: pathlib.Path | None = None,
               static_dir: pathlib.Path | None = None,
               runner=None, get_key=None, set_key=None, geocode=None,
               provider_factory=None) -> FastAPI:
    app = FastAPI(title="buscapiso")
    ruta_db = db_path
    get_key = get_key or keys.get_google_key
    set_key = set_key or keys.set_google_key
    provider_factory = provider_factory or (
        lambda con: provider_from_settings(con, get_key=get_key, cached=False))

    def _geocode_real(q: str) -> list[dict]:
        con = almacen.abrir(ruta_db or paths.db_path())
        try:
            return Geocodificador(con).buscar(q)
        finally:
            con.close()

    geocode = geocode or _geocode_real
    runner = runner or SearchRunner()
    app.state.runner = runner

    @contextlib.contextmanager
    def db():
        # Una conexion por peticion: sqlite3 no comparte conexiones entre los
        # hilos en los que FastAPI ejecuta las rutas sincronas.
        con = almacen.abrir(ruta_db or paths.db_path())
        try:
            yield con
        finally:
            con.close()

    def _detalle(con: sqlite3.Connection, id_: str) -> ListingDetail:
        fila = almacen.leer_anuncio(con, id_)
        if fila is None:
            raise HTTPException(404, f"no listing {id_}")
        return detail_from_row(fila)

    @app.get("/api/meta")
    def meta() -> dict:
        return {"statuses": list(almacen.ESTADOS), "sources": SOURCES,
                "genders": GENDERS}

    @app.get("/api/listings")
    def listings(status: str | None = Query(default=None),
                 group: str | None = Query(default=None)) -> list[Listing]:
        estados = [s for s in (status or "").split(",") if s] or None
        with db() as con:
            return [listing_from_row(f)
                    for f in almacen.listar_anuncios(con, estados, group)]

    @app.get("/api/listings/{id_}")
    def listing(id_: str) -> ListingDetail:
        with db() as con:
            return _detalle(con, id_)

    @app.post("/api/listings/{id_}/status")
    def change_status(id_: str, body: StatusChange) -> ListingDetail:
        with db() as con:
            if not almacen.marcar(con, id_, body.status, body.note):
                raise HTTPException(404, f"no listing {id_}")
            return _detalle(con, id_)

    @app.put("/api/listings/{id_}/note")
    def change_note(id_: str, body: NoteChange) -> ListingDetail:
        with db() as con:
            if not almacen.anotar(con, id_, body.note):
                raise HTTPException(404, f"no listing {id_}")
            return _detalle(con, id_)

    def _lista(con) -> list[dict]:
        return [{"name": n, "active": a} for n, a in almacen.listar_perfiles(con)]

    @app.get("/api/profiles")
    def profiles() -> list[dict]:
        with db() as con:
            active_profile(con)
            return _lista(con)

    @app.get("/api/profiles/active")
    def profile_active() -> SearchProfile:
        with db() as con:
            return active_profile(con)

    @app.get("/api/profiles/{name}")
    def profile(name: str) -> SearchProfile:
        with db() as con:
            p = almacen.cargar_perfil(con, name)
        if p is None:
            raise HTTPException(404, f"no profile {name}")
        return p

    @app.put("/api/profiles/{name}")
    def save_profile(name: str, body: SearchProfile) -> SearchProfile:
        if body.name != name:
            raise HTTPException(400, "the profile name in the body must match the URL")
        with db() as con:
            almacen.guardar_perfil(con, body)
        return body

    @app.post("/api/profiles/{name}/activate")
    def activate(name: str) -> list[dict]:
        with db() as con:
            if not almacen.activar_perfil(con, name):
                raise HTTPException(404, f"no profile {name}")
            return _lista(con)

    @app.delete("/api/profiles/{name}", status_code=204)
    def delete_profile(name: str) -> Response:
        with db() as con:
            if (name, True) in almacen.listar_perfiles(con):
                raise HTTPException(409, "the active profile cannot be deleted")
            if not almacen.borrar_perfil(con, name):
                raise HTTPException(404, f"no profile {name}")
        return Response(status_code=204)

    @app.post("/api/searches", status_code=202)
    def start_search(body: SearchRequest) -> dict:
        with db() as con:
            perfil = active_profile(con)
        opciones = SearchOptions(pages=body.pages, skip_details=body.skip_details,
                                 from_cache=body.from_cache)
        try:
            id_ = runner.start(perfil, opciones, ruta_db or paths.db_path())
        except RuntimeError:
            raise HTTPException(409, "a search is already running")
        return {"id": id_}

    @app.get("/api/searches/current")
    def search_state() -> dict:
        return runner.state()

    @app.get("/api/searches/current/stream")
    async def search_stream() -> StreamingResponse:
        async def fuente():
            enviados = 0
            while True:
                nuevos, sigue = runner.events_since(enviados)
                for e in nuevos:
                    yield f"data: {json.dumps(e, ensure_ascii=False)}\n\n"
                enviados += len(nuevos)
                if not sigue and not runner.events_since(enviados)[0]:
                    return
                await asyncio.sleep(0.25)

        return StreamingResponse(fuente(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache"})

    def _settings(con) -> dict:
        a = almacen.leer_ajustes(con)
        return {"travel_provider": a.get("travel_provider", "graph"),
                "transitous_contact": a.get("transitous_contact", ""),
                "has_google_key": bool(get_key()),
                "motis_url": a.get("motis_url", TRANSITOUS_URL)}

    @app.get("/api/settings")
    def settings() -> dict:
        with db() as con:
            return _settings(con)

    @app.put("/api/settings")
    def save_settings(body: SettingsChange) -> dict:
        if body.google_key is not None:
            try:
                set_key(body.google_key.strip() or None)
            except keys.KeysUnavailable as e:
                raise HTTPException(503, str(e))
        with db() as con:
            actual = _settings(con)
            proveedor = body.travel_provider or actual["travel_provider"]
            contacto = (body.transitous_contact if body.transitous_contact is not None
                        else actual["transitous_contact"]).strip()
            url = (body.motis_url if body.motis_url is not None
                   else actual["motis_url"]).strip().rstrip("/") or TRANSITOUS_URL
            if not url.startswith(("http://", "https://")):
                raise HTTPException(422, "The server address must start with http:// or https://")
            if proveedor == "transitous" and url == TRANSITOUS_URL and not contacto:
                raise HTTPException(422, "Transitous needs a contact (email or URL)")
            if proveedor == "google" and not get_key():
                raise HTTPException(422, "Google Routes needs an API key")
            almacen.guardar_ajuste(con, "travel_provider", proveedor)
            almacen.guardar_ajuste(con, "transitous_contact", contacto)
            almacen.guardar_ajuste(con, "motis_url", url)
            return _settings(con)

    @app.post("/api/settings/test-route")
    def test_route() -> dict:
        origen = (41.3792, 2.1404)
        with db() as con:
            perfil = active_profile(con)
            cfg, _ = to_engine_cfg(perfil)
            destino = (cfg["destinos"] or [{"nombre": "Fira", "lat": 41.3519, "lon": 2.1307,
                                            "modo": "transporte", "salida": "08:30"}])[0]
            g = GraphProvider(Red.cargar()).trips([origen], destino)[0]
            provider, aviso = provider_factory(con)
        salida = {"graph": {"minutes": g.minutes, "detail": g.detail} if g else None,
                  "provider": None, "error": aviso}
        if provider is not None:
            try:
                t = provider.trips([origen], destino)[0]
                salida["provider"] = ({"name": provider.name, "minutes": t.minutes,
                                       "detail": t.detail} if t else None)
            except TravelError as e:
                salida["error"] = str(e)
        return salida

    @app.get("/api/geocode")
    def geocode_route(q: str = Query(min_length=2)) -> list[dict]:
        try:
            return geocode(q)
        except OSError as e:
            raise HTTPException(502, f"Address search is unavailable: {e}")

    app.state.db = db
    estaticos = static_dir if static_dir is not None else WEB_DIST
    if (estaticos / "index.html").exists():
        app.mount("/", StaticFiles(directory=estaticos, html=True), name="web")
    else:
        @app.get("/")
        def sin_web() -> dict:
            return {"hint": "The web app is not built yet. Run: "
                            "npm --prefix web ci && npm --prefix web run build"}

    return app
