"""Tests del parser de Idealista contra HTML real guardado.

Sin red: si Idealista cambia su HTML, se actualiza el fixture y estos tests
dicen exactamente que se rompio.
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pytest

from fuentes.idealista import construir_url, parsear_listado
from modelo import GENERO_CHICAS, GENERO_MIXTO

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "idealista_listado.html"


@pytest.fixture(scope="module")
def anuncios():
    return parsear_listado(FIXTURE.read_text(encoding="utf-8"))


def test_encuentra_los_treinta_anuncios(anuncios):
    assert len(anuncios) == 30


def test_campos_basicos_del_primer_anuncio(anuncios):
    a = next(x for x in anuncios if x.id_portal == "109613770")
    assert a.portal == "idealista"
    assert a.url == "https://www.idealista.com/inmueble/109613770/"
    assert a.precio == 550
    assert a.gastos_extra == 150
    assert a.coste_total == 700
    assert a.habitaciones == 5
    assert a.companeros == 5
    assert a.genero_piso == GENERO_CHICAS
    assert a.fumar_permitido is False
    assert "Casp" in a.direccion
    assert a.barrio == "El Fort Pienc"
    assert a.municipio == "Barcelona"
    assert "habitaci" in a.descripcion.lower()


def test_distingue_piso_de_chicas_de_piso_mixto(anuncios):
    chicas = [a for a in anuncios if a.genero_piso == GENERO_CHICAS]
    mixtos = [a for a in anuncios if a.genero_piso == GENERO_MIXTO]
    # El filtro "sexo_chica" de idealista significa "admite chicas", no
    # "solo chicas": la mayoria de resultados son pisos mixtos.
    assert len(chicas) == 3
    assert len(mixtos) == 27


def test_gastos_no_declarados_quedan_como_none(anuncios):
    a = next(x for x in anuncios if x.id_portal == "101226824")
    assert a.gastos_extra is None
    assert a.coste_total == 980       # sin datos, no inventamos gastos
    assert a.gastos_incluidos is False


def test_todos_tienen_id_url_y_precio(anuncios):
    for a in anuncios:
        assert a.id_portal and a.url.startswith("https://")
        assert a.precio and a.precio > 0
        assert len(a.id) == 12


def test_ids_son_unicos_y_estables(anuncios):
    ids = [a.id for a in anuncios]
    assert len(set(ids)) == len(ids)
    otra_vez = parsear_listado(FIXTURE.read_text(encoding="utf-8"))
    assert [a.id for a in otra_vez] == ids


def test_fecha_de_publicacion_cuando_la_hay(anuncios):
    con_fecha = [a for a in anuncios if a.publicado_texto]
    assert con_fecha, "el fixture tiene anuncios con fecha"
    assert all("sep" in a.publicado_texto for a in con_fecha)


# --- construccion de URL ------------------------------------------------
def test_url_lleva_los_filtros_en_orden_estable():
    u = construir_url("barcelona-barcelona", precio_max=550, solo_chicas=True,
                      sin_propietario=True)
    assert u == ("https://www.idealista.com/alquiler-habitacion/barcelona-barcelona/"
                 "con-precio-hasta_550,sexo_chica,pisos-compartido-sin-propietario/")


def test_url_sin_filtros_es_la_busqueda_desnuda():
    assert construir_url("barcelona-barcelona") == (
        "https://www.idealista.com/alquiler-habitacion/barcelona-barcelona/")


def test_url_admite_paginacion():
    u = construir_url("barcelona-barcelona", precio_max=550, pagina=2)
    assert u.endswith("pagina-2.htm")


def test_url_con_filtros_de_ambiente():
    u = construir_url("barcelona-barcelona", con_estudiantes=True, exterior=True,
                      publicado_48h=True)
    assert "compartidos_con-estudiantes" in u
    assert "exterior" in u
    assert "publicado_ultimas-48-horas" in u


def test_url_puede_pedir_lo_mas_nuevo_primero():
    u = construir_url("barcelona-barcelona", precio_max=550, orden="nuevos")
    assert u.endswith("?ordenado-por=fecha-publicacion-desc")


def test_url_admite_distritos_de_barcelona():
    u = construir_url("barcelona/sants-montjuic", solo_chicas=True)
    assert u == ("https://www.idealista.com/alquiler-habitacion/"
                 "barcelona/sants-montjuic/con-sexo_chica/")


def test_orden_por_relevancia_no_ensucia_la_url():
    assert "?" not in construir_url("barcelona-barcelona", orden="relevancia")


def test_casi_todos_traen_foto_del_cdn(anuncios):
    """Los iconos de interfaz viven en st3.idealista.com; las fotos reales en
    img*.idealista.com. Coger el primer <img> a secas traeria iconos."""
    con_foto = [a for a in anuncios if a.foto]
    assert len(con_foto) >= 25
    assert all("//img" in a.foto for a in con_foto)
    assert not any("st3.idealista.com" in a.foto for a in con_foto)


def test_el_genero_de_idealista_es_dato_no_inferencia(anuncios):
    """Idealista lo marca con una clase en el icono de la tarjeta. Tratarlo
    como inferido haria que el informe desconfiase de un dato fiable."""
    con_genero = [a for a in anuncios if a.genero_piso != "desconocido"]
    assert len(con_genero) == 30
    assert all(a.genero_confirmado for a in con_genero)
