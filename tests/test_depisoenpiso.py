"""Tests del parser de De Piso en Piso contra HTML real guardado."""
import pathlib
import sys


import pytest

from buscapiso.fuentes.depisoenpiso import construir_url, parsear_listado

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "depisoenpiso_listado.html"


@pytest.fixture(scope="module")
def anuncios():
    return parsear_listado(FIXTURE.read_text(encoding="utf-8"))


def test_encuentra_las_tarjetas(anuncios):
    assert len(anuncios) == 10


def test_campos_de_una_tarjeta(anuncios):
    a = next(x for x in anuncios if x.id_portal == "688143e9ddaa0")
    assert a.portal == "depisoenpiso"
    assert a.precio == 350
    assert a.url.endswith("prop=688143e9ddaa0")
    assert "Pujades" in a.direccion
    assert a.admite_parejas is False
    assert a.habitaciones == 4


def test_las_coordenadas_caen_en_cataluna(anuncios):
    """El onclick del mapa trae [lon, lat], al reves de lo habitual.
    Invertirlos pondria los pisos en Somalia, y el test lo detecta."""
    situados = [a for a in anuncios if a.lat is not None]
    assert len(situados) >= 8
    for a in situados:
        assert 41.2 < a.lat < 41.6, f"latitud fuera de Barcelona: {a.lat}"
        assert 1.9 < a.lon < 2.4, f"longitud fuera de Barcelona: {a.lon}"


def test_las_coordenadas_son_exactas_no_estimadas(anuncios):
    """Este portal da la posicion real: no hay que geocodificar ni penalizar."""
    situados = [a for a in anuncios if a.lat is not None]
    assert not any(a.coords_aproximadas for a in situados)


def test_sin_senales_en_el_texto_el_genero_queda_desconocido(anuncios):
    """Las tarjetas dicen 'Private room' y poco mas: sin senales, no se
    adivina. El filtro estricto los descartara, y es lo correcto."""
    from buscapiso.modelo import DESCONOCIDO
    assert all(not a.genero_confirmado for a in anuncios)
    assert any(a.genero_piso == DESCONOCIDO for a in anuncios)


def test_url_de_ciudad():
    assert construir_url("Barcelona").endswith("find-places.html?ciudad=Barcelona")


# --- ficha de detalle ---------------------------------------------------
def test_la_ficha_da_la_descripcion_que_la_tarjeta_no_tiene():
    """Sin esto el portal no aporta nada: la tarjeta solo dice 'Private room'."""
    from buscapiso.fuentes.depisoenpiso import parsear_ficha
    ficha = pathlib.Path(__file__).parent / "fixtures" / "depisoenpiso_ficha.html"
    d = parsear_ficha(ficha.read_text(encoding="utf-8"))
    assert d["ficha_leida"] is True
    assert "Noies" in d["descripcion"]


def test_la_descripcion_de_la_ficha_revela_el_genero():
    """'Busquem només 3 Noies estudiants' -> piso de chicas."""
    from buscapiso.fuentes.base import inferir_genero
    from buscapiso.fuentes.depisoenpiso import parsear_ficha
    from buscapiso.modelo import GENERO_CHICAS
    ficha = pathlib.Path(__file__).parent / "fixtures" / "depisoenpiso_ficha.html"
    d = parsear_ficha(ficha.read_text(encoding="utf-8"))
    assert inferir_genero(d["descripcion"])[0] == GENERO_CHICAS
