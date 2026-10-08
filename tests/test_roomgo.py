"""Tests del parser de Roomgo contra HTML real guardado."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pytest

from fuentes.roomgo import construir_url, parsear_listado
from modelo import DESCONOCIDO, GENERO_MIXTO

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "roomgo_listado.html"


@pytest.fixture(scope="module")
def anuncios():
    return parsear_listado(FIXTURE.read_text(encoding="utf-8"))


def test_encuentra_las_tarjetas(anuncios):
    assert len(anuncios) == 15


def test_campos_de_una_tarjeta(anuncios):
    a = anuncios[1]
    assert a.portal == "roomgo"
    assert a.id_portal == "H2609169723201"
    assert a.url.startswith("https://www.roomgo.es/piso-compartido-")
    assert a.precio == 900
    assert "Habitaciones en Apartment" in a.titulo
    assert "Carrer D'aragó" in a.direccion
    assert a.barrio == "Sant Martí"


def test_lee_el_genero_publicado_no_lo_infiere(anuncios):
    """Roomgo publica 'N compañeros de piso - mixto': eso es dato, no
    inferencia, y debe quedar marcado como confirmado."""
    mixtos = [a for a in anuncios if a.genero_piso == GENERO_MIXTO]
    assert len(mixtos) >= 10
    assert all(a.genero_confirmado for a in mixtos)
    assert mixtos[0].companeros == 2


def test_companeros_desconocidos_no_se_inventan(anuncios):
    desconocidos = [a for a in anuncios if a.genero_piso == DESCONOCIDO]
    assert desconocidos, "el fixture tiene anuncios sin genero declarado"
    assert not any(a.genero_confirmado for a in desconocidos)


def test_precio_con_separador_de_miles(anuncios):
    """'1.050 € por mes' son 1050, no 1."""
    caros = [a for a in anuncios if a.precio and a.precio > 1000]
    assert caros and all(a.precio == 1050 for a in caros)


def test_la_foto_sale_del_data_src_no_del_placeholder(anuncios):
    """El src es un pixel base64 de carga diferida; la foto va en data-src."""
    con_foto = [a for a in anuncios if a.foto]
    assert con_foto
    assert all(f.startswith("https://") for f in (a.foto for a in con_foto))
    assert not any("base64" in a.foto for a in con_foto)


def test_disponibilidad_inmediata(anuncios):
    assert any("ahora" in a.publicado_texto.lower() or a.disponible_desde == "ahora"
               for a in anuncios)


def test_url_con_paginacion():
    assert construir_url("barcelona", 1).endswith("/piso-compartido-barcelona")
    assert construir_url("barcelona", 3).endswith("?page=3")
