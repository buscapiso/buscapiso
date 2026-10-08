import pytest

from buscapiso.transporte import Red
from buscapiso.travel import graph_trip

SANTS = (41.3792, 2.1404)


def destino(modo, lat=41.3519, lon=2.1307):
    return {"nombre": "Fira", "lat": lat, "lon": lon, "max_minutos": None,
            "peso_minuto": 1.0, "modo": modo, "salida": "08:30"}


@pytest.fixture(scope="module")
def red():
    return Red.cargar()


def test_transit_uses_the_network(red):
    t = graph_trip(red, *SANTS, destino("transporte"))
    assert t.source == "graph"
    assert "L5" in t.detail
    assert 15 < t.minutes < 30


def test_walking_ignores_the_network(red):
    t = graph_trip(red, *SANTS, destino("a_pie"))
    assert t.detail == "walk"
    assert 50 < t.minutes < 65          # Transitous dio 57 min a pie


def test_cycling_is_faster_than_walking(red):
    a_pie = graph_trip(red, *SANTS, destino("a_pie"))
    bici = graph_trip(red, *SANTS, destino("bici"))
    assert bici.detail == "bike"
    assert bici.minutes < a_pie.minutes / 2


def test_walk_and_bike_are_always_reachable(red):
    lejos = destino("a_pie", lat=41.5931, lon=1.8378)     # Montserrat
    assert graph_trip(red, *SANTS, lejos) is not None
    assert graph_trip(red, *SANTS, {**lejos, "modo": "transporte"}) is None
