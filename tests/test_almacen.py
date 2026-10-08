import pathlib
import sys


import pytest

from buscapiso import almacen
from buscapiso.modelo import Anuncio


@pytest.fixture
def con(tmp_path):
    return almacen.abrir(tmp_path / "t.db")


def a(n="1"):
    return Anuncio(portal="idealista", id_portal=n, url=f"https://x/{n}", precio=500)


def test_la_primera_vez_todo_es_nuevo(con):
    assert len(almacen.registrar(con, [a("1"), a("2")])) == 2


def test_la_segunda_vez_ya_no_son_nuevos(con):
    almacen.registrar(con, [a("1"), a("2")])
    nuevos = almacen.registrar(con, [a("1"), a("2"), a("3")])
    assert [x.id_portal for x in nuevos] == ["3"]


def test_conserva_la_fecha_en_que_lo_vimos_por_primera_vez(con):
    almacen.registrar(con, [a("1")])
    otro = a("1")
    almacen.registrar(con, [otro])
    assert otro.visto_por_primera_vez == almacen.hoy()


def test_marcar_y_leer_estado(con):
    x = a("1"); almacen.registrar(con, [x])
    assert almacen.marcar(con, x.id, "contactado", "escrito el lunes")
    assert almacen.estado_de(con, x.id) == "contacted"


def test_marcar_id_inexistente_devuelve_falso(con):
    assert almacen.marcar(con, "noexiste", "visita") is False


def test_estado_invalido_es_un_error(con):
    with pytest.raises(ValueError):
        almacen.marcar(con, "x", "me-encanta")


def test_los_descartados_se_recuerdan(con):
    x, y = a("1"), a("2")
    almacen.registrar(con, [x, y])
    almacen.marcar(con, x.id, "descartado")
    assert almacen.descartados(con) == {x.id}


def test_every_change_is_kept_in_the_history(con):
    x = a("1"); almacen.registrar(con, [x])
    almacen.marcar(con, x.id, "liked")
    almacen.marcar(con, x.id, "contacted", "por whatsapp")
    assert [(e, n) for e, n, _ in almacen.historial(con, x.id)] == [
        ("liked", ""), ("contacted", "por whatsapp")]


def test_hidden_listings_are_also_left_out(con):
    x, y = a("1"), a("2")
    almacen.registrar(con, [x, y])
    almacen.marcar(con, y.id, "hidden")
    assert almacen.descartados(con) == {y.id}
