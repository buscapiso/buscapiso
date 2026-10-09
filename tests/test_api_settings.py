import pytest
from fastapi.testclient import TestClient

from buscapiso.api.app import create_app
from buscapiso.travel import Trip


class Fijo:
    name = "transitous"

    def trips(self, origins, destino):
        return [Trip(19.0, "L5 > L9S", "transitous") for _ in origins]


@pytest.fixture
def ctx(tmp_path, monkeypatch):
    monkeypatch.setenv("BUSCAPISO_HOME", str(tmp_path))
    llavero = {}
    app = create_app(
        db_path=tmp_path / "p.db", static_dir=tmp_path / "x",
        get_key=lambda: llavero.get("k"),
        set_key=lambda k: llavero.update(k=k) if k else llavero.pop("k", None),
        geocode=lambda q: [{"name": f"{q}, Barcelona", "lat": 41.38, "lon": 2.17}],
        provider_factory=lambda con: (Fijo(), None))
    return TestClient(app), llavero


def test_defaults_use_the_graph(ctx):
    c, _ = ctx
    assert c.get("/api/settings").json() == {
        "travel_provider": "graph", "transitous_contact": "", "has_google_key": False,
        "motis_url": "https://api.transitous.org"}


def test_transitous_needs_a_contact(ctx):
    c, _ = ctx
    assert c.put("/api/settings", json={"travel_provider": "transitous"}).status_code == 422
    r = c.put("/api/settings", json={"travel_provider": "transitous",
                                     "transitous_contact": "ana@example.org"})
    assert r.json()["travel_provider"] == "transitous"


def test_the_google_key_is_stored_but_never_returned(ctx):
    c, llavero = ctx
    r = c.put("/api/settings", json={"travel_provider": "google", "google_key": "SECRET"})
    assert r.status_code == 200
    assert llavero["k"] == "SECRET"
    assert "SECRET" not in r.text and "SECRET" not in c.get("/api/settings").text
    assert r.json()["has_google_key"] is True
    c.put("/api/settings", json={"travel_provider": "graph", "google_key": ""})
    assert "k" not in llavero


def test_google_without_a_key_is_rejected(ctx):
    c, _ = ctx
    assert c.put("/api/settings", json={"travel_provider": "google"}).status_code == 422


def test_route_test_compares_graph_and_provider(ctx):
    c, _ = ctx
    r = c.post("/api/settings/test-route").json()
    assert r["provider"] == {"name": "transitous", "minutes": 19.0, "detail": "L5 > L9S"}
    assert 10 < r["graph"]["minutes"] < 40
    assert r["error"] is None


def test_geocode_returns_places(ctx):
    c, _ = ctx
    assert c.get("/api/geocode?q=Fira").json() == [
        {"name": "Fira, Barcelona", "lat": 41.38, "lon": 2.17}]
    assert c.get("/api/geocode?q=").status_code == 422


def test_a_local_motis_server_is_saved_without_contact(ctx):
    c, _ = ctx
    r = c.put("/api/settings", json={"travel_provider": "transitous",
                                     "motis_url": "http://localhost:8080"})
    assert r.status_code == 200
    assert r.json()["motis_url"] == "http://localhost:8080"
    assert c.get("/api/settings").json()["motis_url"] == "http://localhost:8080"


def test_the_default_server_is_the_public_one(ctx):
    c, _ = ctx
    assert c.get("/api/settings").json()["motis_url"] == "https://api.transitous.org"
