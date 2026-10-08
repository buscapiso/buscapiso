"""Tests de la ficha de detalle, contra HTML real de un anuncio."""
import pathlib
import sys


import pytest

from buscapiso.fuentes.idealista import parsear_ficha

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "idealista_ficha.html"


@pytest.fixture(scope="module")
def ficha():
    return parsear_ficha(FIXTURE.read_text(encoding="utf-8"))


def test_lee_que_el_propietario_no_vive(ficha):
    """'El propietario/a no vive': la barra del inclusivo rompe \\w+."""
    assert ficha["propietario_vive"] is False


def test_lee_las_normas_de_la_casa(ficha):
    assert ficha["admite_parejas"] is False
    assert ficha["fumar_permitido"] is False


def test_una_costumbre_no_es_una_norma(ficha):
    """La casa 'no suele tener visitas', pero no las prohibe: eso va a
    ambiente y resta puntos, no a visitas_permitidas, que descartaria."""
    assert "visitas_permitidas" not in ficha
    assert "no suelen tener visitas" in ficha["ambiente"]


def test_lee_la_edad_real_de_las_companeras(ficha):
    assert ficha["edad_companeros"] == "28-32"
    assert "Trabajan" in ficha["ocupacion_companeros"]


def test_lee_disponibilidad_y_estancia_minima(ficha):
    assert ficha["disponible_desde"] == "01-10-2026"
    assert ficha["estancia_minima_meses"] == 3


def test_detecta_habitacion_exterior(ficha):
    assert ficha["exterior"] is True


def test_una_ficha_vacia_no_inventa_nada():
    d = parsear_ficha("<html><body><p>nada</p></body></html>")
    assert d == {"ficha_leida": True}


def test_la_descripcion_es_el_anuncio_no_la_navegacion(ficha):
    """'.comment, .detail-info' como selector unico devolvia la cabecera
    ('6 fotos Mapa Alquiler de habitacion...') porque aparece antes."""
    d = ficha["descripcion"]
    assert not d.startswith("6 fotos")
    assert "Mapa Alquiler de habitación" not in d[:80]
    assert "compañera de piso" in d


def test_la_ficha_revela_alquileres_temporales(ficha):
    """Dato que el listado no da: este piso solo alquila de octubre a
    diciembre, algo que descartarias de entrada."""
    assert "octubre a diciembre" in ficha["descripcion"]
