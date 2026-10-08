import pytest
from fastapi.testclient import TestClient

from buscapiso import almacen
from buscapiso.ai.providers import AIError, Usage
from buscapiso.api.app import create_app
from buscapiso.modelo import Anuncio


class FakeAI:
    name, model = "anthropic", "claude-opus-5-5"

    def __init__(self, falla=False):
        self.falla, self.usage, self.prompts = falla, Usage(), []

    def text(self, system, user, max_tokens=1024):
        if self.falla:
            raise AIError("Claude answered HTTP 401")
        self.prompts.append((system, user))
        return "Hola, soy Ana. ¿Sigue disponible la habitación?"

    def json(self, system, user, schema):
        self.prompts.append((system, user))
        return schema(budget_ideal=500, budget_max=650, household_gender="female_only",
                      places=[{"name": "Work", "address": "Fira Gran Via, Barcelona",
                               "max_minutes": 30, "mode": "transit"}])


@pytest.fixture
def ctx(tmp_path, monkeypatch):
    monkeypatch.setenv("BUSCAPISO_HOME", str(tmp_path))
    con = almacen.abrir(tmp_path / "p.db")
    a = Anuncio(portal="idealista", id_portal="1", url="https://x/1", titulo="Habitación en Sants",
                descripcion="Habitación en piso compartido. Gastos aparte.", precio=450)
    almacen.registrar(con, [a])
    con.close()
    llavero, estado = {}, {"ai": FakeAI()}
    app = create_app(db_path=tmp_path / "p.db", static_dir=tmp_path / "x",
                     get_key=lambda name: llavero.get(name),
                     set_key=lambda name, v=None: llavero.update({name: v}) if v else llavero.pop(name, None),
                     ai_factory=lambda con: (estado["ai"], None))
    return TestClient(app), llavero, a.id, estado


def test_ai_settings_round_trip_without_exposing_the_key(ctx):
    c, llavero, _, _ = ctx
    assert c.get("/api/ai").json() == {"provider": "none", "model": "", "base_url": "",
                                       "has_key": False, "about_me": ""}
    r = c.put("/api/ai", json={"provider": "anthropic", "model": "claude-haiku-5-5",
                               "key": "SECRET", "about_me": "Ana, 27, nurse"})
    assert r.status_code == 200 and "SECRET" not in r.text
    assert llavero["anthropic"] == "SECRET"
    assert r.json() == {"provider": "anthropic", "model": "claude-haiku-5-5", "base_url": "",
                        "has_key": True, "about_me": "Ana, 27, nurse"}


def test_draft_uses_about_me_and_the_listing(ctx):
    c, _, id_, estado = ctx
    c.put("/api/ai", json={"about_me": "Ana, 27, nurse"})
    r = c.post(f"/api/listings/{id_}/draft")
    assert r.json() == {"text": "Hola, soy Ana. ¿Sigue disponible la habitación?"}
    system, user = estado["ai"].prompts[0]
    assert "Ana, 27, nurse" in user and "Gastos aparte" in user
    assert "same language as the listing" in system


def test_draft_errors(ctx):
    c, _, id_, estado = ctx
    assert c.post("/api/listings/nope/draft").status_code == 404
    estado["ai"] = FakeAI(falla=True)
    r = c.post(f"/api/listings/{id_}/draft")
    assert r.status_code == 502 and "401" in r.json()["detail"]


def test_without_ai_the_endpoints_say_so(ctx):
    c, _, id_, estado = ctx
    estado["ai"] = None
    assert c.post(f"/api/listings/{id_}/draft").status_code == 422
    assert c.post("/api/ai/test").status_code == 422


def test_ai_test_reports_the_model(ctx):
    c, _, _, _ = ctx
    assert c.post("/api/ai/test").json()["ok"] is True


def test_profile_suggestion_from_free_text(ctx):
    c, _, _, _ = ctx
    r = c.post("/api/profiles/suggest", json={"text": "Busco habitación en piso de chicas, "
                                                      "máximo 650, trabajo en Fira"})
    s = r.json()
    assert s["budget_max"] == 650 and s["household_gender"] == "female_only"
    assert s["places"][0]["address"] == "Fira Gran Via, Barcelona"
