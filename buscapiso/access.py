"""Acceso desde el movil: un token aleatorio que el QR lleva dentro.

Desde la propia maquina nunca se pide. Desde la red local (`serve --lan`),
cualquier peticion sin el token recibe 401: cualquiera en tu Wi-Fi veria si no
tus pisos, tus notas y tus ajustes.
"""
from __future__ import annotations

import io
import secrets
import socket
import sqlite3

from buscapiso import almacen

LOOPBACK = {"127.0.0.1", "::1", "localhost", "testclient"}   # testclient: el de Starlette


def get_token(con: sqlite3.Connection) -> str:
    token = almacen.leer_ajustes(con).get("access_token")
    if not token:
        token = rotate_token(con)
    return token


def rotate_token(con: sqlite3.Connection) -> str:
    token = secrets.token_urlsafe(24)
    almacen.guardar_ajuste(con, "access_token", token)
    return token


def local_ip() -> str:
    """La IP de este ordenador en la red de casa. Conectar un socket UDP no
    envia nada; solo hace que el sistema elija la interfaz de salida."""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        try:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
        except OSError:
            return "127.0.0.1"


def access_url(con: sqlite3.Connection, port: int) -> str:
    return f"http://{local_ip()}:{port}/?t={get_token(con)}"


def qr_svg(url: str) -> str:
    import segno
    out = io.BytesIO()
    segno.make(url, error="m").save(out, kind="svg", scale=6, border=2, dark="#1c1e22",
                                     light="#ffffff", xmldecl=False)
    return out.getvalue().decode()
