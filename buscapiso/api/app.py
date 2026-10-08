"""API JSON y servidor de la web app."""
from __future__ import annotations

import asyncio
import contextlib
import json
import pathlib
import sqlite3

from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from buscapiso import almacen, paths
from buscapiso.api.schemas import (Listing, ListingDetail, NoteChange, StatusChange,
                                   detail_from_row, listing_from_row)
from buscapiso.api.searches import SearchRunner
from buscapiso.pipeline import SearchOptions
from buscapiso.profiles import SearchProfile
from buscapiso.seed import active_profile

WEB_DIST = pathlib.Path(__file__).resolve().parents[1] / "web_dist"
SOURCES = ["idealista", "fotocasa", "roomgo", "depisoenpiso"]
GENDERS = ["female_only", "male_only", "mixed", "any"]


class SearchRequest(BaseModel):
    skip_details: bool = False
    from_cache: bool = False
    pages: int | None = None


def create_app(db_path: pathlib.Path | None = None,
               static_dir: pathlib.Path | None = None,
               runner=None) -> FastAPI:
    app = FastAPI(title="buscapiso")
    ruta_db = db_path
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

    app.state.db = db
    return app
