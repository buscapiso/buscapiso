"""La lista de zonas a rastrear se deriva del limite de tiempo.

Antes estaba escrita a mano: --max-minutos 60 relajaba el filtro pero no
visitaba ninguna zona nueva, asi que el flag prometia una amplitud que la
busqueda no tenia.
"""
import pathlib
import sys


import pytest

from buscapiso.cobertura import Catalogo
from buscapiso.transporte import Red


def fira(max_minutos):
    return [{"nombre": "Fira", "lat": 41.3519228, "lon": 2.130679,
             "max_minutos": max_minutos, "peso_minuto": 2.0,
             "modo": "transporte", "salida": "08:30"}]


@pytest.fixture(scope="module")
def red():
    return Red.cargar()


@pytest.fixture(scope="module")
def cat():
    return Catalogo.cargar()


def test_el_catalogo_tiene_zonas_con_coordenadas(cat):
    assert len(cat.zonas) >= 15
    for z in cat.zonas:
        assert 41.25 < z["lat"] < 41.47, z["nombre"]
        assert 1.95 < z["lon"] < 2.30, z["nombre"]


def test_un_limite_corto_deja_solo_lo_cercano(cat, red):
    sel = cat.seleccionar(fira(20), red)
    nombres = {z["nombre"] for z in sel}
    assert any("Hospitalet" in n for n in nombres)
    assert not any("Badalona" in n for n in nombres)


def test_un_limite_largo_incluye_el_centro(cat, red):
    """Eixample y Gracia entran a 60 min y antes no se rastreaban nunca."""
    nombres = {z["nombre"] for z in cat.seleccionar(fira(60), red)}
    assert any("Eixample" in n for n in nombres)
    assert any("Gràcia" in n for n in nombres)


def test_ampliar_el_limite_nunca_quita_zonas(cat, red):
    corto = {z["nombre"] for z in cat.seleccionar(fira(30), red)}
    largo = {z["nombre"] for z in cat.seleccionar(fira(60), red)}
    assert corto <= largo
    assert len(largo) > len(corto)


def test_el_margen_cubre_el_tamano_del_distrito(cat, red):
    """Se compara el centroide, pero un distrito mide kilometros: su parte
    mas cercana puede entrar aunque el centro se pase por poco."""
    sin_margen = cat.seleccionar(fira(30), red, margen_minutos=0)
    con_margen = cat.seleccionar(fira(30), red, margen_minutos=10)
    assert len(con_margen) >= len(sin_margen)


def test_siempre_devuelve_algo_aunque_el_limite_sea_absurdo(cat, red):
    """Con 5 minutos no entra ninguna zona, pero devolver una lista vacia
    dejaria la busqueda sin hacer nada y sin explicar por que."""
    sel = cat.seleccionar(fira(5), red)
    assert len(sel) >= 1


def test_slugs_por_portal(cat, red):
    sel = cat.seleccionar(fira(60), red)
    idea = cat.slugs(sel, "idealista")
    foto = cat.slugs(sel, "fotocasa")
    assert all(s for s in idea)
    assert len(idea) > 5
    # Fotocasa cubre todos los distritos de Barcelona de una vez: no debe
    # aparecer diez veces la misma busqueda.
    assert foto.count("barcelona-capital/todas-las-zonas") == 1


def test_una_zona_sin_pagina_en_un_portal_no_lo_rompe(cat, red):
    """El Prat no tiene seccion de habitaciones en idealista, pero si en
    fotocasa: debe salir en una lista y no en la otra."""
    sel = cat.seleccionar(fira(60), red)
    prat = [z for z in sel if "Prat" in z["nombre"]]
    if prat:
        assert prat[0]["idealista"] is None
        assert prat[0]["fotocasa"]
    idea = cat.slugs(sel, "idealista")
    assert None not in idea


def test_las_zonas_salen_ordenadas_de_mas_cerca_a_mas_lejos(cat, red):
    sel = cat.seleccionar(fira(60), red)
    tiempos = [z["minutos"] for z in sel]
    assert tiempos == sorted(tiempos)


def test_without_limited_destinations_every_zone_is_crawled(cat, red):
    assert len(cat.seleccionar([], red)) == len(cat.zonas)


def test_a_second_limit_can_only_narrow_the_selection(cat, red):
    collblanc = {"nombre": "Collblanc", "lat": 41.3758735, "lon": 2.1184045,
                 "max_minutos": 15, "peso_minuto": 0.6}
    solo_fira = {z["nombre"] for z in cat.seleccionar(fira(40), red)}
    ambos = {z["nombre"] for z in cat.seleccionar(fira(40) + [collblanc], red)}
    assert ambos and ambos <= solo_fira


def test_a_walking_destination_selects_only_nearby_zones(cat, red):
    andando = [{"nombre": "Fira", "lat": 41.3519228, "lon": 2.130679, "max_minutos": 25,
                "peso_minuto": 1.0, "modo": "a_pie", "salida": "08:30"}]
    en_metro = {z["nombre"] for z in cat.seleccionar(fira(25), red)}
    a_pie = {z["nombre"] for z in cat.seleccionar(andando, red)}
    assert a_pie and a_pie <= en_metro
