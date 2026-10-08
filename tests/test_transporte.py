"""Tests del motor de rutas. Sin red: todo sale de datos/red.json."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pytest

from transporte import Red, haversine_m, minutos_andando

FIRA = "Fira"
COLLBLANC = "Collblanc"


@pytest.fixture(scope="module")
def red():
    return Red.cargar()


def test_haversine_distancia_conocida():
    # Collblanc -> Torrassa: ~800 m en linea recta.
    d = haversine_m(41.37587, 2.11840, 41.37085, 2.12290)
    assert 500 < d < 1000


def test_andar_aplica_factor_de_rodeo():
    # 600 m en linea recta no son 8 min a 4,5 km/h: la calle no es recta.
    assert 9 < minutos_andando(600) < 14


def test_collblanc_a_fira_son_cuatro_paradas_de_l9(red):
    r = red.ruta_desde(41.37587, 2.11840, FIRA)
    assert r is not None
    assert r.estacion_origen == COLLBLANC
    assert r.transbordos == 0
    assert "L9S" in r.lineas
    # 4 saltos a 1,7 min + espera ~2 min, practicamente sin andar.
    assert 7 <= r.minutos <= 12, r.detalle


def test_bellvitge_a_fira_requiere_un_transbordo(red):
    # Bellvitge (L1) -> Torrassa -> L9S -> Fira.
    r = red.ruta_desde(41.34965, 2.11122, FIRA)
    assert r is not None
    assert r.transbordos >= 1
    assert 15 <= r.minutos <= 40, r.detalle


def test_sants_estacio_entra_en_treinta_minutos(red):
    r = red.ruta_desde(41.37918, 2.14017, FIRA)
    assert r is not None
    assert r.minutos <= 30, r.detalle


def test_piso_lejos_de_toda_estacion_no_tiene_ruta(red):
    # En medio del mar: ninguna estacion a distancia andable.
    assert red.ruta_desde(41.20, 2.40, FIRA) is None


def test_collblanc_es_destino_alcanzable_tambien(red):
    r = red.ruta_desde(41.37918, 2.14017, COLLBLANC)
    assert r is not None
    assert r.minutos <= 30, r.detalle


def test_andar_directo_gana_si_el_piso_pega_al_destino(red):
    # A 300 m de Fira no se coge el metro.
    r = red.ruta_desde(41.3555, 2.1290, FIRA)
    assert r is not None
    assert r.minutos <= 10, r.detalle
    assert r.lineas == [] or r.minutos_andando > 0


def test_toda_estacion_de_la_red_tiene_coordenadas(red):
    for nombre, est in red.estaciones.items():
        assert est["lat"] and est["lon"], nombre
