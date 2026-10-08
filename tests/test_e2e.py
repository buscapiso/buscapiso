"""De punta a punta: servidor real, web compilada y Chromium headless.

Solo contra 127.0.0.1. Se salta si la web no esta compilada."""
import pathlib
import socket
import threading
import time

import pytest
import uvicorn

from buscapiso import almacen
from buscapiso.api.app import WEB_DIST, create_app
from buscapiso.modelo import Anuncio

pytestmark = [
    pytest.mark.e2e,
    pytest.mark.skipif(not (WEB_DIST / "index.html").exists(),
                       reason="web no compilada: npm --prefix web run build"),
]


def _puerto_libre() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
def servidor(tmp_path, monkeypatch):
    monkeypatch.setenv("BUSCAPISO_HOME", str(tmp_path))
    con = almacen.abrir(tmp_path / "pisos.db")
    a = Anuncio(portal="idealista", id_portal="1", url="https://example.org/1",
                titulo="Bright room in Sants", precio=450, gastos_extra=50,
                barrio="Sants", municipio="Barcelona", trayectos={"Fira": 12.0})
    a.puntuacion = 90
    almacen.registrar(con, [a])
    con.close()
    puerto = _puerto_libre()
    config = uvicorn.Config(create_app(db_path=tmp_path / "pisos.db"),
                            host="127.0.0.1", port=puerto, log_level="warning")
    server = uvicorn.Server(config)
    hilo = threading.Thread(target=server.run, daemon=True)
    hilo.start()
    while not server.started:
        time.sleep(0.05)
    yield f"http://127.0.0.1:{puerto}", tmp_path / "pisos.db", a.id
    server.should_exit = True
    hilo.join(5)


def test_like_a_listing_from_the_inbox(servidor):
    from playwright.sync_api import sync_playwright
    url, db, id_ = servidor
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(url)
        page.get_by_text("Bright room in Sants").wait_for()
        assert page.get_by_text("500 €").is_visible()
        assert page.get_by_text("12 min to Fira").is_visible()
        page.get_by_role("button", name="Like").click()
        page.get_by_text("Nothing new to review.").wait_for()
        page.goto(f"{url}/#/liked")
        page.get_by_text("Bright room in Sants").click()
        page.get_by_placeholder("Anything to remember").fill("Visit Thursday 18h")
        page.get_by_role("button", name="Save note").click()
        page.get_by_text("Saved").wait_for()
        browser.close()
    con = almacen.abrir(db)
    fila = almacen.leer_anuncio(con, id_)
    assert (fila["estado"], fila["nota"]) == ("liked", "Visit Thursday 18h")
