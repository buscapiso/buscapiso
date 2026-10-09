"""Instancia unica de Playwright, compartida por todas las fuentes.

La API sincrona de Playwright solo admite UNA instancia viva por hilo: monta
su propio bucle asyncio por dentro, y arrancar una segunda revienta con
"Sync API inside the asyncio loop". Cuando cada fuente llamaba a
sync_playwright().start() por su cuenta, la primera funcionaba y las demas
fallaban.

Cada fuente sigue teniendo su propio perfil de navegador (cookies separadas,
para que un bloqueo en un portal no contamine a los demas); lo que comparten
es el proceso de Playwright.
"""
from __future__ import annotations

import atexit
import pathlib
import threading

_PW = None
_DUENO: threading.Thread | None = None   # hilo en el que arranco _PW
_CONTEXTOS: list = []


def playwright():
    """Arranca Playwright la primera vez y reutiliza la instancia despues.

    La instancia solo vale en el hilo que la arranco: la web lanza cada
    busqueda en un hilo nuevo, y reutilizar la de un hilo ya terminado
    revienta con "cannot switch to a different thread". En ese caso se
    abandona (no se puede parar desde otro hilo) y se arranca otra.
    """
    global _PW, _DUENO
    if _PW is not None and _DUENO is not threading.current_thread():
        _PW = None
        _CONTEXTOS.clear()
    if _PW is None:
        from playwright.sync_api import sync_playwright
        _PW = sync_playwright().start()
        _DUENO = threading.current_thread()
    return _PW


def contexto(perfil: pathlib.Path, **opciones):
    """Contexto persistente con los ajustes que evitan el bloqueo anti-bot."""
    ajustes = dict(
        headless=False,            # con headless, DataDome devuelve captcha
        locale="es-ES",
        timezone_id="Europe/Madrid",
        viewport={"width": 1400, "height": 950},
        args=["--disable-blink-features=AutomationControlled"],
    )
    ajustes.update(opciones)
    ctx = playwright().chromium.launch_persistent_context(str(perfil), **ajustes)
    _CONTEXTOS.append(ctx)
    return ctx


# Errores de playwright que significan "ya no hay navegador al otro lado".
# La ventana es visible por obligacion (con headless salta el anti-bot), asi
# que cerrarla a mano o que Chromium se caiga son fallos esperables, no raros.
_MUERTO = ("target page, context or browser has been closed",
           "browser has been closed", "target closed",
           "browser closed", "connection closed")


def esta_muerto(error: BaseException) -> bool:
    mensaje = str(error).lower()
    return any(p in mensaje for p in _MUERTO)


def cerrar_contexto(ctx) -> None:
    if ctx is None:
        return
    try:
        ctx.close()
    except Exception:
        pass
    if ctx in _CONTEXTOS:
        _CONTEXTOS.remove(ctx)


def cerrar_todo() -> None:
    """Cierra contextos y para Playwright. Se llama al terminar la busqueda.
    Desde otro hilo solo se sueltan las referencias: pararlo ahi revienta."""
    global _PW, _DUENO
    if _PW is not None and _DUENO is threading.current_thread():
        for ctx in list(_CONTEXTOS):
            cerrar_contexto(ctx)
        try:
            _PW.stop()
        except Exception:
            pass
    _CONTEXTOS.clear()
    _PW, _DUENO = None, None


atexit.register(cerrar_todo)
