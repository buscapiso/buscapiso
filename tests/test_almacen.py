import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pytest

import almacen
from modelo import Anuncio


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
    assert almacen.estado_de(con, x.id) == "contactado"


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
