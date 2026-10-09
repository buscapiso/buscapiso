import pytest
from fastapi.testclient import TestClient

from buscapiso import access, almacen
from buscapiso.api.app import create_app

REMOTO = ("192.168.1.50", 5000)


@pytest.fixture
def app(tmp_path, monkeypatch):
    monkeypatch.setenv("BUSCAPISO_HOME", str(tmp_path))
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html><title>buscapiso</title>")
    return create_app(db_path=tmp_path / "p.db", static_dir=dist, require_token=True)


def token(app):
    con = almacen.abrir(app.state.db_path)
    try:
        return access.get_token(con)
    finally:
        con.close()


def test_a_phone_without_token_is_turned_away(app):
    c = TestClient(app, client=REMOTO)
    assert c.get("/api/listings").status_code == 401
    assert c.get("/").status_code == 401


def test_the_qr_link_lets_the_phone_in_and_remembers_it(app):
    c = TestClient(app, client=REMOTO)
    r = c.get(f"/?t={token(app)}", follow_redirects=False)
    assert r.status_code in (302, 303, 307)
    assert "bp_token" in r.headers["set-cookie"] and "HttpOnly" in r.headers["set-cookie"]
    assert c.get("/api/listings").status_code == 200        # la cookie queda
    assert "<title>buscapiso</title>" in c.get("/").text


def test_a_wrong_token_is_rejected(app):
    c = TestClient(app, client=REMOTO)
    assert c.get("/?t=nope", follow_redirects=False).status_code == 401
    assert c.get("/api/listings", headers={"X-Buscapiso-Token": "nope"}).status_code == 401


def test_rotating_the_token_locks_out_old_phones(app):
    viejo = token(app)
    TestClient(app).post("/api/access/rotate")               # desde la propia maquina
    c = TestClient(app, client=REMOTO)
    assert c.get("/api/listings", headers={"X-Buscapiso-Token": viejo}).status_code == 401
    assert c.get("/api/listings", headers={"X-Buscapiso-Token": token(app)}).status_code == 200


def test_the_computer_itself_needs_no_token(app):
    assert TestClient(app).get("/api/listings").status_code == 200


def test_only_the_computer_can_rotate(app):
    c = TestClient(app, client=REMOTO)
    assert c.post("/api/access/rotate", headers={"X-Buscapiso-Token": token(app)}).status_code == 403


def test_access_info_has_a_qr_with_the_link(app):
    info = TestClient(app).get("/api/access").json()
    assert info["lan"] is True
    assert info["url"].endswith(f"/?t={token(app)}")
    assert info["qr_svg"].lstrip().startswith("<?xml") or "<svg" in info["qr_svg"]


def test_without_lan_nothing_is_required(tmp_path, monkeypatch):
    monkeypatch.setenv("BUSCAPISO_HOME", str(tmp_path))
    c = TestClient(create_app(db_path=tmp_path / "p.db", static_dir=tmp_path / "x"), client=REMOTO)
    assert c.get("/api/listings").status_code == 200
    assert c.get("/api/access").json()["lan"] is False


def test_phone_access_can_be_turned_on_from_the_app(tmp_path, monkeypatch):
    monkeypatch.setenv("BUSCAPISO_HOME", str(tmp_path))
    app = create_app(db_path=tmp_path / "p.db", static_dir=tmp_path / "x")
    c = TestClient(app)
    assert c.get("/api/access").json()["remember_lan"] is False
    assert c.put("/api/access", json={"lan": True}).json()["remember_lan"] is True
    con = almacen.abrir(tmp_path / "p.db")
    assert almacen.leer_ajustes(con)["lan_access"] == "1"
    remoto = TestClient(app, client=REMOTO)
    assert remoto.put("/api/access", json={"lan": False}).status_code == 403


def test_serve_opens_to_the_network_when_remembered(monkeypatch, tmp_path):
    import uvicorn
    from buscapiso import cli
    monkeypatch.setenv("BUSCAPISO_HOME", str(tmp_path))
    con = almacen.abrir(tmp_path / "pisos.db")
    almacen.guardar_ajuste(con, "lan_access", "1")
    con.close()
    llamadas = []
    monkeypatch.setattr(uvicorn, "run", lambda app, **kw: llamadas.append((app, kw)))
    assert cli.main(["serve", "--no-open", "--port", "8798"]) == 0
    app, kw = llamadas[0]
    assert kw["host"] == "0.0.0.0" and app.state.lan is True
