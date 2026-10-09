import pytest
from fastapi.testclient import TestClient

from buscapiso import almacen
from buscapiso.api.app import create_app
from buscapiso.modelo import Anuncio


@pytest.fixture
def db(tmp_path):
    ruta = tmp_path / "pisos.db"
    con = almacen.abrir(ruta)
    sants = Anuncio(portal="idealista", id_portal="1", url="https://x/1",
                    titulo="Room in Sants", precio=450, gastos_extra=50,
                    barrio="Sants", municipio="Barcelona",
                    trayectos={"Fira": 12.4}, rutas={"Fira": "L5 > L9S"})
    sants.puntuacion, sants.motivos = 88, ["12 min to Fira (-5)"]
    corts = Anuncio(portal="fotocasa", id_portal="2", url="https://x/2",
                    titulo="Room in Les Corts", precio=500)
    corts.puntuacion = 70
    almacen.registrar(con, [sants])
    almacen.registrar(con, [corts], grupo="possible")
    con.close()
    return ruta, sants.id, corts.id


@pytest.fixture
def client(db, tmp_path):
    return TestClient(create_app(db_path=db[0], static_dir=tmp_path / "no-dist"))


def test_listings_are_returned_in_english_and_sorted(client, db):
    r = client.get("/api/listings")
    assert r.status_code == 200
    primero = r.json()[0]
    assert primero["id"] == db[1]
    assert primero["total_cost"] == 500
    assert primero["travel"] == {"Fira": 12.4}
    assert primero["status"] == "new"
    assert primero["group"] == "accepted"
    assert primero["reasons"] == ["12 min to Fira (-5)"]


def test_listings_can_be_filtered(client, db):
    ids = [x["id"] for x in client.get("/api/listings?group=possible").json()]
    assert ids == [db[2]]
    assert client.get("/api/listings?status=liked").json() == []


def test_detail_includes_history(client, db):
    client.post(f"/api/listings/{db[1]}/status", json={"status": "liked", "note": "nice"})
    d = client.get(f"/api/listings/{db[1]}").json()
    assert d["status"] == "liked"
    assert d["history"][0]["status"] == "liked"
    assert d["history"][0]["note"] == "nice"


def test_status_without_note_keeps_the_note(client, db):
    client.post(f"/api/listings/{db[1]}/status", json={"status": "liked", "note": "nice"})
    d = client.post(f"/api/listings/{db[1]}/status", json={"status": "contacted"}).json()
    assert (d["status"], d["note"]) == ("contacted", "nice")


def test_invalid_status_is_rejected(client, db):
    assert client.post(f"/api/listings/{db[1]}/status",
                       json={"status": "contactado"}).status_code == 422


def test_note_changes_alone(client, db):
    d = client.put(f"/api/listings/{db[1]}/note", json={"note": "ask about deposit"}).json()
    assert (d["status"], d["note"]) == ("new", "ask about deposit")


def test_unknown_listing_is_404(client):
    assert client.get("/api/listings/nope").status_code == 404
    assert client.post("/api/listings/nope/status", json={"status": "liked"}).status_code == 404
    assert client.put("/api/listings/nope/note", json={"note": "x"}).status_code == 404


def test_meta_lists_the_vocabularies(client):
    m = client.get("/api/meta").json()
    assert "visit_scheduled" in m["statuses"]
    assert m["genders"] == ["female_only", "male_only", "mixed", "any"]
    assert "idealista" in m["sources"]


def test_an_empty_database_gives_an_empty_list(tmp_path):
    c = TestClient(create_app(db_path=tmp_path / "vacia.db", static_dir=tmp_path / "x"))
    assert c.get("/api/listings").json() == []


@pytest.mark.parametrize("url, sale", [
    ("https://www.idealista.com/inmueble/1/", "https://www.idealista.com/inmueble/1/"),
    ("javascript:alert(document.cookie)", ""),
    ("  JavaScript:alert(1)", ""),
    ("data:text/html,<script>", ""),
])
def test_only_web_links_reach_the_page(url, sale):
    """Las URLs salen del HTML de terceros: un javascript: se ejecutaria
    dentro de la app, con acceso a toda su API."""
    from buscapiso.api.schemas import listing_from_row
    fila = {"datos": {"id": "x", "portal": "p", "url": url}, "estado": "new", "nota": "",
            "grupo": "accepted", "primera_vez": "", "ultima_vez": ""}
    assert listing_from_row(fila).url == sale


def test_listings_saved_before_phase_0_still_show_their_travel_times(tmp_path):
    """Hasta la fase 0 los minutos se guardaban como minutos_fira y
    minutos_collblanc; la pisos.db real tiene 211 anuncios asi."""
    import json
    from buscapiso.api.schemas import listing_from_row
    datos = {"id": "old1", "portal": "idealista", "url": "u", "precio": 420,
             "coste_total": 420, "minutos_fira": 19.2, "minutos_collblanc": 7.6,
             "ruta_fira": "4 min a Sants + L5 > L9S", "puntuacion": 110}
    fila = {"datos": json.loads(json.dumps(datos)), "estado": "new", "nota": "",
            "grupo": "accepted", "primera_vez": "2026-09-21", "ultima_vez": "2026-09-21"}
    l = listing_from_row(fila)
    assert l.travel == {"Fira": 19.2, "Collblanc": 7.6}
    assert l.routes == {"Fira": "4 min a Sants + L5 > L9S"}


def test_flats_come_with_their_type_and_details(tmp_path):
    ruta = tmp_path / "f.db"
    con = almacen.abrir(ruta)
    piso = Anuncio(portal="habitaclia", id_portal="9", url="https://x/9", tipo="piso",
                   precio=1200, habitaciones=3, superficie_m2=85, banos=2, planta="4",
                   ascensor=True, amueblado=False)
    almacen.registrar(con, [piso])
    # Un anuncio guardado antes de la fase 5, sin campo "tipo".
    con.execute("INSERT INTO anuncios (id, portal, id_portal, url, primera_vez, ultima_vez,"
                " estado, datos, grupo) VALUES ('old', 'idealista', '1', 'u', '2026-01-01',"
                " '2026-01-01', 'new', '{\"id\": \"old\", \"portal\": \"idealista\"}', 'accepted')")
    con.commit()
    con.close()
    c = TestClient(create_app(db_path=ruta, static_dir=tmp_path / "no-dist"))
    por_id = {x["id"]: x for x in c.get("/api/listings").json()}
    f = por_id[piso.id]
    assert (f["type"], f["bedrooms"], f["surface_m2"], f["bathrooms"], f["floor"],
            f["elevator"], f["furnished"]) == ("flat", 3, 85, 2, "4", True, False)
    assert por_id["old"]["type"] == "room"
    assert c.get("/api/meta").json()["flat_sources"] == ["fotocasa", "habitaclia"]
