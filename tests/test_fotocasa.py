"""Tests del parser de Fotocasa contra HTML real guardado.

Fotocasa no pinta los anuncios en el HTML: los manda en un JSON incrustado.
Estos tests fijan la extraccion de ese JSON, que es la parte fragil.
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pytest

from fuentes.fotocasa import construir_url, extraer_json, parsear_listado

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "fotocasa_listado.html"


@pytest.fixture(scope="module")
def html():
    return FIXTURE.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def anuncios(html):
    return parsear_listado(html)


# --- extraccion del JSON ------------------------------------------------
def test_encuentra_el_array_por_su_clave(html):
    """Se busca la clave 'realEstates', no el nombre de la variable de
    JavaScript: el framework la renombra, la clave de datos no."""
    datos = extraer_json(html, "realEstates")
    assert isinstance(datos, list)
    assert len(datos) == 30


def test_html_sin_json_no_revienta():
    assert extraer_json("<html><body>nada</body></html>", "realEstates") is None
    assert parsear_listado("<html></html>") == []


def test_json_truncado_no_revienta():
    assert extraer_json('{"realEstates":[{"id":1,', "realEstates") is None


# --- mapeo a Anuncio ----------------------------------------------------
def test_encuentra_los_anuncios(anuncios):
    assert len(anuncios) == 30


def test_campos_de_un_anuncio(anuncios):
    a = anuncios[0]
    assert a.portal == "fotocasa"
    assert a.id_portal
    assert a.url.startswith("https://www.fotocasa.es/es/compartir/")
    assert a.precio and a.precio > 0
    assert a.municipio == "Barcelona"
    assert a.barrio


def test_todos_traen_coordenadas_del_portal(anuncios):
    """Fotocasa da la posicion en el JSON: no hay que geocodificar."""
    assert all(a.lat is not None and a.lon is not None for a in anuncios)
    for a in anuncios:
        assert 41.2 < a.lat < 41.6
        assert 1.9 < a.lon < 2.4


def test_la_posicion_es_aproximada_y_se_dice(anuncios):
    """El JSON trae accuracy=False: es el barrio, no el portal. Marcarlo
    como exacto haria que adelantase a anuncios con direccion real."""
    assert all(a.coords_aproximadas for a in anuncios)


def test_antiguedad_del_anuncio(anuncios):
    """date.diff viene en dias y alimenta el bonus por novedad."""
    con_fecha = [a for a in anuncios if a.publicado_texto]
    assert len(con_fecha) == 30
    assert any("día" in a.publicado_texto for a in con_fecha)


def test_detecta_el_alquiler_temporal_sin_adivinarlo(anuncios):
    """Fotocasa lo publica como isTemporaryRental. Mejor que buscar
    'de octubre a diciembre' en el texto."""
    temporales = [a for a in anuncios if "temporal" in a.descripcion_extra.lower()]
    assert len(temporales) == 1


def test_numero_de_habitaciones_sale_de_features(anuncios):
    con_habs = [a for a in anuncios if a.habitaciones]
    assert len(con_habs) >= 25


def test_foto_del_cdn(anuncios):
    con_foto = [a for a in anuncios if a.foto]
    assert con_foto
    assert all("fotocasa.es" in a.foto for a in con_foto)


def test_el_genero_se_infiere_y_no_se_da_por_confirmado(anuncios):
    """Fotocasa no publica el genero del piso."""
    assert not any(a.genero_confirmado for a in anuncios)


# --- urls ---------------------------------------------------------------
def test_url_basica():
    assert construir_url("barcelona-capital/todas-las-zonas") == (
        "https://www.fotocasa.es/es/compartir/pisos/"
        "barcelona-capital/todas-las-zonas/l")


def test_url_con_pagina():
    u = construir_url("barcelona-capital/todas-las-zonas", pagina=3)
    assert u.endswith("/l/3")


def test_url_ordenada_por_precio():
    """Con 8.000 anuncios, ordenar de mas barato a mas caro hace que las
    primeras paginas ya contengan todo lo que cabe en el presupuesto."""
    u = construir_url("barcelona-capital/todas-las-zonas", orden="baratos")
    assert u.endswith("?sortType=price&sortOrderDesc=false")


def test_url_ordenada_por_fecha():
    u = construir_url("barcelona-capital/todas-las-zonas", orden="nuevos")
    assert "sortType=publicationDate" in u and "sortOrderDesc=true" in u


def test_la_antiguedad_sale_como_numero_de_dias(anuncios):
    """El ranking necesita el numero, no la cadena: 'hace 602 días' llego a
    cobrar bonus de novedad por el simple hecho de traer fecha."""
    con_dias = [a for a in anuncios if a.antiguedad_dias is not None]
    assert len(con_dias) == 30
    assert all(isinstance(a.antiguedad_dias, int) for a in con_dias)
    assert all(a.antiguedad_dias >= 0 for a in con_dias)


def test_texto_y_numero_de_antiguedad_concuerdan(anuncios):
    a = next(x for x in anuncios if x.antiguedad_dias and x.antiguedad_dias > 1)
    assert str(a.antiguedad_dias) in a.publicado_texto
