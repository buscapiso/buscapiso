import pathlib
import shutil

import pytest
import yaml

from buscapiso import almacen, events
from buscapiso.fuentes.idealista import parsear_listado
from buscapiso.pipeline import SearchOptions, run_search

RAIZ = pathlib.Path(__file__).resolve().parents[1]
FIXTURE = RAIZ / "tests" / "fixtures" / "idealista_listado.html"


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("BUSCAPISO_HOME", str(tmp_path))
    (tmp_path / "cache").mkdir()
    shutil.copy(FIXTURE, tmp_path / "cache" / "idealista_listado.html")
    return tmp_path


@pytest.fixture
def cfg():
    return yaml.safe_load((RAIZ / "config.yaml").read_text(encoding="utf-8"))


def test_from_cache_runs_every_stage_without_network(home, cfg):
    seen = []
    previous = events.set_sink(seen.append)
    try:
        result = run_search(cfg, {}, SearchOptions(from_cache=True, offline=True),
                            almacen.abrir(home / "t.db"))
    finally:
        events.set_sink(previous)
    esperados = len(parsear_listado(FIXTURE.read_text(encoding="utf-8")))
    assert result.crawled == esperados > 0
    assert [e.data["step"] for e in seen if e.kind == "stage"] == [1, 2, 3, 4, 5]


def test_run_search_leaves_the_callers_cfg_alone(home, cfg):
    antes = yaml.safe_dump(cfg)
    run_search(cfg, {}, SearchOptions(from_cache=True, offline=True),
               almacen.abrir(home / "t.db"))
    assert yaml.safe_dump(cfg) == antes


def test_an_off_network_destination_is_reported_before_crawling(home, cfg):
    """Con un destino sin estacion andable, ninguna zona tiene ruta: la
    seleccion quedaba vacia y el aviso que lo explica nunca llegaba."""
    from buscapiso.cobertura import Catalogo
    cfg["destinos"] = [{"nombre": "Montserrat", "lat": 41.5931, "lon": 1.8378,
                        "max_minutos": 30, "peso_minuto": 1.0}]
    seen = []
    previous = events.set_sink(seen.append)
    try:
        run_search(cfg, {}, SearchOptions(from_cache=True, offline=True),
                   almacen.abrir(home / "t.db"))
    finally:
        events.set_sink(previous)
    primero = next(i for i, e in enumerate(seen) if e.kind == "stage")
    avisos = [i for i, e in enumerate(seen)
              if e.kind == "warning" and "Montserrat" in e.message]
    assert len(avisos) == 1 and avisos[0] < primero
    zonas = next(e for e in seen if e.message.startswith("Zonas a rastrear"))
    assert len(zonas.data["zones"]) == len(Catalogo.cargar().zonas)


@pytest.mark.parametrize("genero, url_chicas", [
    ("chicas", True), ("chicos", False), ("mixto", False), ("cualquiera", False)])
def test_idealista_url_filter_follows_the_gender(cfg, genero, url_chicas):
    from buscapiso.pipeline import idealista_filters
    cfg["requisitos"]["genero"] = genero
    assert idealista_filters(cfg)["solo_chicas"] is url_chicas


def test_a_failing_provider_falls_back_to_graph_times_with_a_warning(home, cfg):
    from buscapiso.travel import TravelError

    class Caido:
        name = "transitous"

        def trips(self, origins, destino):
            raise TravelError("no network")

    # Fotocasa trae coordenadas en el propio listado: sin ellas (offline, sin
    # geocodificar) ningun anuncio llegaria a pedir tiempos al proveedor.
    shutil.copy(RAIZ / "tests" / "fixtures" / "fotocasa_listado.html",
                home / "cache" / "fotocasa_listado.html")
    cfg["requisitos"]["genero"] = "cualquiera"
    seen = []
    previous = events.set_sink(seen.append)
    try:
        r = run_search(cfg, {}, SearchOptions(from_cache=True, offline=True),
                       almacen.abrir(home / "t.db"), provider=Caido())
    finally:
        events.set_sink(previous)
    assert any(e.kind == "warning" and "transitous" in e.message for e in seen)
    assert [e.data["step"] for e in seen if e.kind == "stage"] == [1, 2, 3, 4, 5]
    assert r.crawled > 0


class FakeAI:
    name, model = "fake", "fake-1"

    def __init__(self, falla=False):
        from buscapiso.ai.providers import Usage
        self.falla, self.usage, self.vistos = falla, Usage(), 0

    def json(self, system, user, schema):
        from buscapiso.ai.providers import AIError
        if self.falla:
            raise AIError("bad key")
        self.vistos += 1
        self.usage.calls += 1
        return schema(household_gender="female_only", bills_included=None,
                      bills_amount_eur=None, owner_lives_in=None, couples_allowed=None,
                      visitors_allowed=None, seasonal_or_short_let=None, min_stay_months=None,
                      roommates=None, roommates_age_range=None, roommates_occupation=None,
                      available_from=None, summary="A room.")


def _con_fotocasa(home):
    shutil.copy(RAIZ / "tests" / "fixtures" / "fotocasa_listado.html",
                home / "cache" / "fotocasa_listado.html")


def test_ai_confirms_gender_and_moves_possibles_to_the_main_list(home, cfg):
    _con_fotocasa(home)
    cfg["requisitos"]["puntos_minimos_para_preguntar"] = -1000
    sin = run_search(cfg, {}, SearchOptions(from_cache=True, offline=True),
                     almacen.abrir(home / "a.db"))
    ia = FakeAI()
    con = run_search(cfg, {}, SearchOptions(from_cache=True, offline=True),
                     almacen.abrir(home / "b.db"), ai=ia)
    assert ia.vistos > 0
    assert len(con.accepted) > len(sin.accepted)
    assert all(a.ia_resumen == "A room." for a in con.accepted if a.portal == "fotocasa")


def test_a_failing_ai_leaves_the_search_complete_with_a_warning(home, cfg):
    _con_fotocasa(home)
    seen = []
    previous = events.set_sink(seen.append)
    try:
        r = run_search(cfg, {}, SearchOptions(from_cache=True, offline=True),
                       almacen.abrir(home / "t.db"), ai=FakeAI(falla=True))
    finally:
        events.set_sink(previous)
    assert any(e.kind == "warning" and "IA" in e.message for e in seen)
    assert [e.data["step"] for e in seen if e.kind == "stage"] == [1, 2, 3, 4, 5]
    assert r.crawled > 0
