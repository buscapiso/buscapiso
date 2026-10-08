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
