"""Tests del geocodificador. Nunca tocan la red: usan la cache o modo offline."""
import pathlib
import sqlite3
import sys


import pytest

from buscapiso.geocodificador import Geocodificador
from buscapiso.modelo import Anuncio


@pytest.fixture
def geo():
    return Geocodificador(sqlite3.connect(":memory:"), offline=True)


def anuncio(**kw):
    base = dict(portal="idealista", id_portal="1", url="https://x/1",
                direccion="Calle de Casp, 110", barrio="El Fort Pienc",
                municipio="Barcelona")
    base.update(kw)
    return Anuncio(**base)


def test_en_modo_offline_no_inventa_coordenadas(geo):
    a = anuncio()
    geo.situar(a)
    assert a.lat is None and a.lon is None


def test_usa_la_cache_y_no_sale_a_la_red(geo):
    geo._a_cache("Calle de Casp, 110, Barcelona, España", 41.3950, 2.1780)
    a = anuncio()
    geo.situar(a)
    assert a.lat == pytest.approx(41.3950)
    assert a.coords_aproximadas is False   # acierto a nivel de calle


def test_cae_al_barrio_si_la_calle_no_se_encuentra(geo):
    geo._a_cache("Calle de Casp, 110, Barcelona, España", None, None)
    geo._a_cache("El Fort Pienc, Barcelona, España", 41.3940, 2.1810)
    a = anuncio()
    geo.situar(a)
    assert a.lat == pytest.approx(41.3940)
    assert a.coords_aproximadas is True    # solo sabemos el barrio


def test_cae_al_municipio_como_ultimo_recurso(geo):
    geo._a_cache("Calle de Casp, 110, Barcelona, España", None, None)
    geo._a_cache("El Fort Pienc, Barcelona, España", None, None)
    geo._a_cache("Barcelona, España", 41.3874, 2.1686)
    a = anuncio()
    geo.situar(a)
    assert a.lat == pytest.approx(41.3874)
    assert a.coords_aproximadas is True


def test_un_fallo_cacheado_no_se_reintenta(geo):
    geo._a_cache("X, España", None, None)
    assert geo.geocodificar("X, España") == (None, None)
    assert geo._de_cache("X, España") == (None, None)


def test_anuncio_sin_direccion_usa_lo_que_tenga(geo):
    geo._a_cache("Collblanc, L'Hospitalet de Llobregat, España", 41.3758, 2.1184)
    a = anuncio(direccion="", barrio="Collblanc",
                municipio="L'Hospitalet de Llobregat")
    geo.situar(a)
    assert a.lat == pytest.approx(41.3758)
    assert a.coords_aproximadas is True


def test_buscar_returns_several_places_bounded_to_barcelona(monkeypatch, tmp_path):
    import io
    import json
    import sqlite3
    import urllib.request
    pedidas = []

    class Resp(io.BytesIO):
        def __enter__(self): return self
        def __exit__(self, *a): return False

    def falso(req, timeout=20):
        pedidas.append(req.full_url)
        return Resp(json.dumps([{"display_name": "Fira Gran Via, L'Hospitalet",
                                 "lat": "41.354", "lon": "2.127"}]).encode())

    monkeypatch.setattr(urllib.request, "urlopen", falso)
    g = Geocodificador(sqlite3.connect(tmp_path / "g.db"))
    assert g.buscar("Fira Gran Via") == [
        {"name": "Fira Gran Via, L'Hospitalet", "lat": 41.354, "lon": 2.127}]
    assert "bounded=1" in pedidas[0] and "limit=5" in pedidas[0]
