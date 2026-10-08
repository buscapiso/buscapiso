"""API JSON y servidor de la web app."""
from __future__ import annotations

import contextlib
import pathlib
import sqlite3

from fastapi import FastAPI, HTTPException, Query

from buscapiso import almacen, paths
from buscapiso.api.schemas import (ListingDetail, Listing, NoteChange, StatusChange,
                                   detail_from_row, listing_from_row)

WEB_DIST = pathlib.Path(__file__).resolve().parents[1] / "web_dist"
SOURCES = ["idealista", "fotocasa", "roomgo", "depisoenpiso"]
GENDERS = ["female_only", "male_only", "mixed", "any"]


def create_app(db_path: pathlib.Path | None = None,
               static_dir: pathlib.Path | None = None,
               runner=None) -> FastAPI:
    app = FastAPI(title="buscapiso")
    ruta_db = db_path

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

    app.state.db = db
    return app
