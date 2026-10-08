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


import datetime as dt

from buscapiso import almacen
from buscapiso.travel import CachedProvider, GraphProvider, Trip, next_departure


def test_next_departure_is_the_next_weekday_in_madrid_time():
    viernes_noche = dt.datetime(2026, 10, 9, 20, 0, tzinfo=dt.timezone.utc)
    salida = next_departure("08:30", viernes_noche)
    assert salida == dt.datetime(2026, 10, 12, 6, 30, tzinfo=dt.timezone.utc)   # lunes, CEST


def test_next_departure_after_the_clock_change():
    salida = next_departure("08:30", dt.datetime(2026, 10, 30, 12, 0, tzinfo=dt.timezone.utc))
    assert salida == dt.datetime(2026, 11, 2, 7, 30, tzinfo=dt.timezone.utc)    # lunes, CET


class Contador:
    name = "fake"

    def __init__(self):
        self.pedidos = []

    def trips(self, origins, destino):
        self.pedidos.append(list(origins))
        return [Trip(10.0 + i, "L5", "fake") for i, _ in enumerate(origins)]


def test_the_cache_answers_repeated_origins(tmp_path):
    con = almacen.abrir(tmp_path / "t.db")
    inner = Contador()
    p = CachedProvider(inner, con)
    d = destino("transporte")
    assert [t.minutes for t in p.trips([SANTS, (41.38, 2.15)], d)] == [10.0, 11.0]
    # El mismo origen movido 10 m cae en la misma celda: no se vuelve a pedir.
    assert [t.minutes for t in p.trips([(41.37925, 2.1404)], d)] == [10.0]
    assert inner.pedidos == [[SANTS, (41.38, 2.15)]]


def test_changing_mode_or_departure_misses_the_cache(tmp_path):
    con = almacen.abrir(tmp_path / "t.db")
    inner = Contador()
    p = CachedProvider(inner, con)
    p.trips([SANTS], destino("transporte"))
    p.trips([SANTS], {**destino("transporte"), "salida": "18:00"})
    p.trips([SANTS], destino("bici"))
    assert len(inner.pedidos) == 3


def test_old_entries_expire(tmp_path):
    con = almacen.abrir(tmp_path / "t.db")
    inner = Contador()
    ahora = [dt.datetime(2026, 10, 1, tzinfo=dt.timezone.utc)]
    p = CachedProvider(inner, con, ttl_days=7, now=lambda: ahora[0])
    p.trips([SANTS], destino("transporte"))
    ahora[0] += dt.timedelta(days=8)
    p.trips([SANTS], destino("transporte"))
    assert len(inner.pedidos) == 2


def test_graph_provider_handles_many_origins(red):
    viajes = GraphProvider(red).trips([SANTS, (41.5931, 1.8378)], destino("transporte"))
    assert viajes[0].source == "graph"
    assert viajes[1] is None
