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


def test_changing_status_without_a_note_keeps_the_note(con):
    x = a("1"); almacen.registrar(con, [x])
    almacen.marcar(con, x.id, "liked", "balcony!")
    almacen.marcar(con, x.id, "contacted")
    assert almacen.leer_anuncio(con, x.id)["nota"] == "balcony!"


def test_a_note_can_change_alone(con):
    x = a("1"); almacen.registrar(con, [x])
    almacen.marcar(con, x.id, "liked")
    assert almacen.anotar(con, x.id, "call after 18h")
    fila = almacen.leer_anuncio(con, x.id)
    assert (fila["estado"], fila["nota"]) == ("liked", "call after 18h")
    assert len(fila["historial"]) == 1
    assert almacen.anotar(con, "noexiste", "x") is False


def test_listings_come_sorted_by_score_and_filtered(con):
    bajo, alto, posible = a("1"), a("2"), a("3")
    bajo.puntuacion, alto.puntuacion, posible.puntuacion = 40, 90, 70
    almacen.registrar(con, [bajo, alto])
    almacen.registrar(con, [posible], grupo="possible")
    almacen.marcar(con, bajo.id, "liked")
    todos = almacen.listar_anuncios(con)
    assert [f["datos"]["id_portal"] for f in todos] == ["2", "3", "1"]
    assert [f["datos"]["id_portal"] for f in almacen.listar_anuncios(con, grupo="possible")] == ["3"]
    assert [f["datos"]["id_portal"] for f in almacen.listar_anuncios(con, estados=["liked"])] == ["1"]


def test_reading_an_unknown_listing_gives_none(con):
    assert almacen.leer_anuncio(con, "noexiste") is None
