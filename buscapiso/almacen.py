"""Historico en SQLite: que anuncios ya habiamos visto y en que estado estan.

Sin esto, cada ejecucion te devuelve las mismas 200 habitaciones y no sabes
cuales son nuevas. La deteccion de novedades es la mitad del valor de la
herramienta cuando buscas con prisa.
"""
from __future__ import annotations

import datetime as dt
import json
import pathlib
import sqlite3

ESTADOS = ("nuevo", "interesa", "contactado", "visita", "descartado")


def abrir(ruta: pathlib.Path) -> sqlite3.Connection:
    con = sqlite3.connect(ruta)
    con.execute("""
        CREATE TABLE IF NOT EXISTS anuncios (
            id TEXT PRIMARY KEY,
            portal TEXT, id_portal TEXT, url TEXT,
            primera_vez TEXT, ultima_vez TEXT,
            estado TEXT DEFAULT 'nuevo',
            nota TEXT DEFAULT '',
            datos TEXT)""")
    con.commit()
    return con


def hoy() -> str:
    return dt.date.today().isoformat()


def registrar(con: sqlite3.Connection, anuncios: list) -> list:
    """Guarda los anuncios y devuelve solo los que no habiamos visto nunca."""
    nuevos = []
    for a in anuncios:
        fila = con.execute("SELECT primera_vez FROM anuncios WHERE id = ?",
                           (a.id,)).fetchone()
        if fila is None:
            a.visto_por_primera_vez = hoy()
            con.execute(
                "INSERT INTO anuncios (id, portal, id_portal, url, primera_vez,"
                " ultima_vez, estado, datos) VALUES (?,?,?,?,?,?,?,?)",
                (a.id, a.portal, a.id_portal, a.url, hoy(), hoy(), "nuevo",
                 json.dumps(a.como_dict(), ensure_ascii=False)))
            nuevos.append(a)
        else:
            a.visto_por_primera_vez = fila[0]
            con.execute(
                "UPDATE anuncios SET ultima_vez = ?, datos = ? WHERE id = ?",
                (hoy(), json.dumps(a.como_dict(), ensure_ascii=False), a.id))
    con.commit()
    return nuevos


def estado_de(con: sqlite3.Connection, id_anuncio: str) -> str:
    fila = con.execute("SELECT estado FROM anuncios WHERE id = ?",
                       (id_anuncio,)).fetchone()
    return fila[0] if fila else "nuevo"


def marcar(con: sqlite3.Connection, id_anuncio: str, estado: str,
           nota: str = "") -> bool:
    if estado not in ESTADOS:
        raise ValueError(f"estado invalido: {estado}. Validos: {', '.join(ESTADOS)}")
    cur = con.execute("UPDATE anuncios SET estado = ?, nota = ? WHERE id = ?",
                      (estado, nota, id_anuncio))
    con.commit()
    return cur.rowcount > 0


def descartados(con: sqlite3.Connection) -> set[str]:
    return {f[0] for f in con.execute(
        "SELECT id FROM anuncios WHERE estado = 'descartado'")}
