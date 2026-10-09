"""Donde vive cada fichero que el motor lee o escribe.

Por defecto, en la raiz del repositorio, que es donde han estado siempre
pisos.db, cache/ y los perfiles de navegador. BUSCAPISO_HOME lo cambia; la
app instalable (fase 6) lo apuntara al directorio de datos del usuario.
"""
from __future__ import annotations

import os
import pathlib

_RAIZ = pathlib.Path(__file__).resolve().parents[1]


def data_dir() -> pathlib.Path:
    return pathlib.Path(os.environ.get("BUSCAPISO_HOME") or _RAIZ)


def db_path() -> pathlib.Path:
    return data_dir() / "pisos.db"


def cache_dir() -> pathlib.Path:
    return data_dir() / "cache"


def report_path() -> pathlib.Path:
    return data_dir() / "informe.html"


def browser_profile(name: str) -> pathlib.Path:
    """Perfil persistente de Chromium para un portal (cookies propias)."""
    return data_dir() / f".perfil-{name}"
