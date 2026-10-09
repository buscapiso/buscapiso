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
                barrio="Sants", municipio="Barcelona", trayectos={"Fira": 12.0},
                lat=41.3755, lon=2.1320)
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


def test_the_map_shows_listings_and_moves_a_destination_on_click(servidor):
    from playwright.sync_api import sync_playwright
    url, db, _ = servidor
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        # Sin red en los tests: las teselas no se piden a OpenStreetMap.
        page.route("https://tile.openstreetmap.org/**", lambda r: r.abort())
        page.goto(f"{url}/#/map")
        page.locator(".leaflet-interactive").first.wait_for()
        assert page.locator(".leaflet-interactive").count() >= 1
        assert page.get_by_text("OpenStreetMap").is_visible()

        page.goto(f"{url}/#/settings/places")
        page.get_by_role("button", name="Add a place").click()
        page.get_by_label("Name").last.fill("Gym")
        mapa = page.get_by_role("region", name="Your places on the map")
        mapa.click(position={"x": 200, "y": 150})
        page.get_by_role("button", name="Save", exact=True).click()
        page.get_by_text("Saved").first.wait_for()
        browser.close()
    con = almacen.abrir(db)
    gym = [d for d in almacen.cargar_perfil(con).destinations if d.name == "Gym"][0]
    assert (gym.lat, gym.lon) != (41.3874, 2.1686)     # se movio del punto por defecto


def test_a_phone_on_the_home_network_needs_the_qr_link(tmp_path):
    """El servidor escucha en todas las interfaces y la pagina se pide por la IP
    de la red local, que para el servidor no es loopback: como un movil."""
    from playwright.sync_api import sync_playwright
    from buscapiso import access
    ip = access.local_ip()
    if ip.startswith("127."):
        pytest.skip("sin red local")
    almacen.abrir(tmp_path / "pisos.db").close()
    puerto = _puerto_libre()
    app = create_app(db_path=tmp_path / "pisos.db", require_token=True, port=puerto)
    server = uvicorn.Server(uvicorn.Config(app, host="0.0.0.0", port=puerto, log_level="warning"))
    threading.Thread(target=server.run, daemon=True).start()
    while not server.started:
        time.sleep(0.05)
    try:
        con = almacen.abrir(tmp_path / "pisos.db")
        enlace = access.access_url(con, puerto)
        con.close()
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            page = browser.new_page()
            r = page.goto(f"http://{ip}:{puerto}/")
            assert r.status == 401
            page.goto(enlace)
            page.get_by_text("No listings yet").wait_for()
            browser.close()
    finally:
        server.should_exit = True
