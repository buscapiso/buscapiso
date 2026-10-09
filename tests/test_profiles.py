import pathlib

import pytest
import yaml
from pydantic import ValidationError

from buscapiso.profiles import (DEFAULT_WEIGHTS, Budget, Destination, SearchProfile,
                                from_engine_cfg, to_engine_cfg)

RAIZ = pathlib.Path(__file__).resolve().parents[1]


@pytest.fixture
def cfg():
    return yaml.safe_load((RAIZ / "config.yaml").read_text(encoding="utf-8"))


ZONAS = {"excluir": ["La Mina"], "penalizar": [], "preferir": ["Sants"]}


def test_config_yaml_survives_the_round_trip(cfg):
    cfg2, zonas2 = to_engine_cfg(from_engine_cfg(cfg, ZONAS, name="default"))
    for clave, valor in cfg2.items():
        assert valor == cfg[clave], clave
    assert zonas2 == ZONAS


def test_legacy_yaml_becomes_an_english_profile(cfg):
    p = from_engine_cfg(cfg, ZONAS, name="default")
    assert p.household.gender == "female_only"
    assert p.destinations[0].name == "Fira"
    assert p.destinations[0].max_minutes == 30
    assert p.destinations[1].max_minutes is None
    assert p.crawl.sort == "newest"


def test_json_round_trip():
    p = SearchProfile(name="test", destinations=[
        Destination(name="UPC", lat=41.3893, lon=2.1134, max_minutes=35)])
    assert SearchProfile.model_validate_json(p.model_dump_json()) == p


def test_defaults_are_neutral():
    p = SearchProfile(name="nuevo")
    assert p.household.gender == "any"
    assert p.destinations == []
    assert p.weights == DEFAULT_WEIGHTS


def test_ideal_budget_above_max_is_rejected():
    with pytest.raises(ValidationError):
        Budget(ideal_total=700, max_total=600)


def test_unknown_weight_is_rejected():
    with pytest.raises(ValidationError):
        SearchProfile(name="x", weights={"no_existe": 1})


def test_partial_weights_are_filled_from_defaults():
    p = SearchProfile(name="x", weights={"novedad": 40})
    assert p.weights["novedad"] == 40
    assert p.weights["rancio"] == DEFAULT_WEIGHTS["rancio"]


def test_destination_names_must_be_unique():
    d = Destination(name="Casa", lat=41.38, lon=2.17)
    with pytest.raises(ValidationError):
        SearchProfile(name="x", destinations=[d, d])


def test_at_least_one_source():
    with pytest.raises(ValidationError):
        SearchProfile(name="x", sources=[])


def test_destinations_default_to_transit_at_8_30():
    d = Destination(name="Work", lat=41.35, lon=2.13)
    assert (d.mode, d.depart_at) == ("transit", "08:30")


def test_a_departure_time_must_be_hh_mm():
    with pytest.raises(ValidationError):
        Destination(name="Work", lat=41.35, lon=2.13, depart_at="8.30h")


def test_mode_and_time_reach_the_engine():
    p = SearchProfile(name="x", destinations=[
        Destination(name="Gym", lat=41.38, lon=2.17, mode="bike", depart_at="19:00")])
    cfg, _ = to_engine_cfg(p)
    assert (cfg["destinos"][0]["modo"], cfg["destinos"][0]["salida"]) == ("bici", "19:00")
    assert cfg["busqueda"]["trayectos_reales"] == 40
