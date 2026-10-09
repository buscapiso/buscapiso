import pytest

from buscapiso import almacen, events
from buscapiso.modelo import Anuncio
from buscapiso.pipeline import refine_routes
from buscapiso.travel import Trip, TravelError, provider_from_settings

D1 = {"nombre": "Fira", "lat": 41.3519, "lon": 2.1307, "max_minutos": 30, "peso_minuto": 2.0,
      "modo": "transporte", "salida": "08:30"}
D2 = {**D1, "nombre": "Gym", "max_minutos": None}


def anuncio(n, minutos=25.0):
    a = Anuncio(portal="x", id_portal=str(n), url="u", lat=41.37 + n / 1000, lon=2.14)
    a.trayectos = {"Fira": minutos, "Gym": minutos}
    a.rutas = {"Fira": "L5", "Gym": "L5"}
    return a


class Fijo:
    name = "fake"

    def __init__(self, minutos=None, falla=False, solo=None):
        self.minutos, self.falla, self.solo = minutos, falla, solo

    def trips(self, origins, destino):
        if self.falla:
            raise TravelError("down")
        if self.solo and destino["nombre"] != self.solo:
            return [None] * len(origins)
        return [Trip(self.minutos, "L9S", "fake") for _ in origins]


def test_the_first_n_get_real_times_and_their_source():
    lista = [anuncio(i) for i in range(5)]
    assert refine_routes(lista, [D1, D2], Fijo(19.0), limit=3) == 3
    assert [a.trayectos["Fira"] for a in lista] == [19.0, 19.0, 19.0, 25.0, 25.0]
    assert [a.trayectos_fuente for a in lista] == ["fake"] * 3 + ["graph"] * 2
    assert lista[0].rutas["Fira"] == "L9S"


def test_a_listing_with_mixed_sources_says_graph():
    lista = [anuncio(0)]
    refine_routes(lista, [D1, D2], Fijo(19.0, solo="Fira"), limit=5)
    assert lista[0].trayectos == {"Fira": 19.0, "Gym": 25.0}
    assert lista[0].trayectos_fuente == "graph"


def test_listings_without_coordinates_are_skipped():
    sin = Anuncio(portal="x", id_portal="9", url="u")
    assert refine_routes([sin], [D1], Fijo(19.0), limit=5) == 0


def test_a_provider_failure_propagates_as_travel_error():
    with pytest.raises(TravelError):
        refine_routes([anuncio(0)], [D1], Fijo(falla=True), limit=5)


def test_settings_choose_the_provider(tmp_path):
    con = almacen.abrir(tmp_path / "t.db")
    assert provider_from_settings(con) == (None, None)
    almacen.guardar_ajuste(con, "travel_provider", "transitous")
    p, aviso = provider_from_settings(con)
    assert p is None and "contact" in aviso
    almacen.guardar_ajuste(con, "transitous_contact", "ana@example.org")
    p, aviso = provider_from_settings(con)
    assert p.name == "transitous" and aviso is None
    almacen.guardar_ajuste(con, "travel_provider", "google")
    p, aviso = provider_from_settings(con, get_key=lambda: None)
    assert p is None and "key" in aviso
    p, _ = provider_from_settings(con, get_key=lambda: "K")
    assert p.name == "google"
