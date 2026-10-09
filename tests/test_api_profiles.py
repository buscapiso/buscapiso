import pytest
from fastapi.testclient import TestClient

from buscapiso.api.app import create_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("BUSCAPISO_HOME", str(tmp_path))   # sin config.yaml
    return TestClient(create_app(db_path=tmp_path / "pisos.db",
                                 static_dir=tmp_path / "no-dist"))


def test_first_visit_creates_the_default_profile(client):
    assert client.get("/api/profiles").json() == [{"name": "default", "active": True}]
    assert client.get("/api/profiles/active").json()["name"] == "default"


def test_a_profile_can_be_saved_and_read_back(client):
    p = client.get("/api/profiles/active").json()
    p["budget"]["max_total"] = 700
    assert client.put("/api/profiles/default", json=p).status_code == 200
    assert client.get("/api/profiles/default").json()["budget"]["max_total"] == 700


def test_an_invalid_profile_is_rejected_and_the_saved_one_survives(client):
    p = client.get("/api/profiles/active").json()
    p["budget"]["ideal_total"] = 900
    r = client.put("/api/profiles/default", json=p)
    assert r.status_code == 422
    assert "ideal_total" in r.text
    assert client.get("/api/profiles/default").json()["budget"]["ideal_total"] == 500


def test_the_url_name_must_match_the_body(client):
    p = client.get("/api/profiles/active").json()
    assert client.put("/api/profiles/other", json=p).status_code == 400


def test_new_profiles_can_be_activated_and_deleted(client):
    p = client.get("/api/profiles/active").json()
    p["name"] = "friend"
    client.put("/api/profiles/friend", json=p)
    assert client.post("/api/profiles/friend/activate").json() == [
        {"name": "default", "active": False}, {"name": "friend", "active": True}]
    assert client.delete("/api/profiles/friend").status_code == 409
    client.post("/api/profiles/default/activate")
    assert client.delete("/api/profiles/friend").status_code == 204
    assert client.get("/api/profiles/friend").status_code == 404


def test_unknown_profiles_are_404(client):
    client.get("/api/profiles")
    assert client.post("/api/profiles/nope/activate").status_code == 404
    assert client.delete("/api/profiles/nope").status_code == 404
