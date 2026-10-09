"""Donde vive cada fichero que el motor lee o escribe.

Por defecto, en la raiz del repositorio, que es donde han estado siempre
pisos.db, cache/ y los perfiles de navegador. BUSCAPISO_HOME lo cambia; la
app instalable (fase 6) lo apuntara al directorio de datos del usuario.
"""
from __future__ import annotations

import os
import pathlib

_RAIZ = pathlib.Path(__file__).resolve().parents[1]


def _desde_codigo_fuente() -> bool:
    """Ejecutando desde el repositorio (hay pyproject.toml al lado del paquete),
    no desde la app empaquetada."""
    import sys
    return not getattr(sys, "frozen", False) and (_RAIZ / "pyproject.toml").exists()


def data_dir() -> pathlib.Path:
    """BUSCAPISO_HOME; si no, la raiz del repo al ejecutar desde el codigo (donde
    siempre han estado tus datos); si no, la carpeta de datos del usuario."""
    if os.environ.get("BUSCAPISO_HOME"):
        return pathlib.Path(os.environ["BUSCAPISO_HOME"])
    if _desde_codigo_fuente():
        return _RAIZ
    import platformdirs
    carpeta = pathlib.Path(platformdirs.user_data_dir("buscapiso", appauthor=False))
    carpeta.mkdir(parents=True, exist_ok=True)
    return carpeta


def db_path() -> pathlib.Path:
    return data_dir() / "pisos.db"


def cache_dir() -> pathlib.Path:
    return data_dir() / "cache"


def report_path() -> pathlib.Path:
    return data_dir() / "informe.html"


def browser_profile(name: str) -> pathlib.Path:
    """Perfil persistente de Chromium para un portal (cookies propias)."""
    return data_dir() / f".perfil-{name}"
