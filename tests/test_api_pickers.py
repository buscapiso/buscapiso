import json
import urllib.error

import pytest
from fastapi.testclient import TestClient

from buscapiso import almacen
from buscapiso.api.app import create_app
from buscapiso.modelo import Anuncio


@pytest.fixture
def ctx(tmp_path):
    con = almacen.abrir(tmp_path / "p.db")
    almacen.registrar(con, [
        Anuncio(portal="idealista", id_portal="1", url="u1", barrio="Sants - Badal", municipio="Barcelona"),
        Anuncio(portal="fotocasa", id_portal="2", url="u2", barrio="Collblanc",
                municipio="L'Hospitalet de Llobregat"),
    ])
    con.close()
    pedidas = []
    llavero = {"openai_compat": "STORED"}

    def get_json(url, headers):
        pedidas.append((url, headers))
        if "broken" in url:
            raise urllib.error.HTTPError(url, 401, "nope", {}, None)
        return {"data": [{"id": "model-b"}, {"id": "model-a"}]}

    app = create_app(db_path=tmp_path / "p.db", static_dir=tmp_path / "x",
                     get_key=lambda name: llavero.get(name), models_fetch=get_json)
    return TestClient(app), pedidas


def test_models_come_from_the_provider(ctx):
    c, pedidas = ctx
    r = c.post("/api/ai/models", json={"base_url": "https://api.openai.com/v1", "key": "NEW"})
    assert r.json() == {"models": ["model-a", "model-b"]}
    assert pedidas[0] == ("https://api.openai.com/v1/models", {"Authorization": "Bearer NEW"})


def test_the_stored_key_is_used_when_none_is_sent(ctx):
    c, pedidas = ctx
    c.post("/api/ai/models", json={"base_url": "http://localhost:11434/v1/"})
    assert pedidas[0] == ("http://localhost:11434/v1/models", {"Authorization": "Bearer STORED"})


def test_a_failing_provider_explains_without_the_key(ctx):
    c, _ = ctx
    r = c.post("/api/ai/models", json={"base_url": "https://broken.example/v1", "key": "SECRET"})
    assert r.status_code == 502 and "401" in r.text and "SECRET" not in r.text


def test_neighbourhoods_mix_listings_and_catalog(ctx):
    c, _ = ctx
    names = c.get("/api/neighbourhoods").json()["names"]
    assert "Collblanc" in names and "Sants - Badal" in names
    assert "L'Hospitalet de Llobregat" in names
    assert any("Eixample" in n for n in names)            # del catalogo de zonas
    assert names == sorted(set(names), key=str.casefold)


def test_gemini_style_model_ids_lose_their_prefix(tmp_path):
    app = create_app(db_path=tmp_path / "p.db", static_dir=tmp_path / "x",
                     get_key=lambda name: "K",
                     models_fetch=lambda url, h: {"data": [{"id": "models/gemini-flash"},
                                                           {"id": "openai/gpt-x"}]})
    r = TestClient(app).post("/api/ai/models", json={"base_url": "https://g.example/openai/"})
    assert r.json() == {"models": ["gemini-flash", "openai/gpt-x"]}


def test_only_chat_models_are_offered(tmp_path):
    ids = ["models/gemini-2.5-flash", "models/text-embedding-004", "models/imagen-4.0-generate",
           "models/veo-3.0-generate", "models/gemini-2.5-flash-preview-tts", "models/aqa",
           "gpt-4o-mini", "whisper-1", "dall-e-3", "omni-moderation-latest", "gemini-embedding-001"]
    app = create_app(db_path=tmp_path / "p.db", static_dir=tmp_path / "x", get_key=lambda n: "K",
                     models_fetch=lambda url, h: {"data": [{"id": i} for i in ids]})
    r = TestClient(app).post("/api/ai/models", json={"base_url": "https://x/v1"})
    assert r.json() == {"models": ["gemini-2.5-flash", "gpt-4o-mini"]}
