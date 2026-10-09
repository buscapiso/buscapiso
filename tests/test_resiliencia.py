"""Un fallo a mitad del rastreo no debe tirar lo ya recogido.

Caso real: la ventana de Chromium murio despues de rastrear 79 anuncios de
idealista. La excepcion se propago fuera de buscar() y los 79 se perdieron,
asi que el informe salio sin un solo anuncio de idealista pese a que el log
mostraba tres paginas rastreadas con exito.
"""
import pathlib
import re
import sys


import pytest

from buscapiso.fuentes.idealista import Idealista

FIXTURE = (pathlib.Path(__file__).parent / "fixtures" /
           "idealista_listado.html").read_text(encoding="utf-8")

CFG = {
    "municipios": ["zona-a", "zona-b", "zona-c"],
    "filtros_idealista": {"precio_max": 550},
    "busqueda": {"orden": "nuevos"},
}


def _pagina_falsa(n: int) -> str:
    """El fixture con ids distintos: dos zonas reales no traen los mismos
    anuncios, y si no se varian, la deduplicacion por id los colapsa y el
    test mide otra cosa de la que cree medir."""
    return re.sub(r'data-element-id="(\d+)"',
                  lambda m: f'data-element-id="{n}{m.group(1)}"', FIXTURE)


class MuereEnLaLlamada(Idealista):
    """Simula la ventana cerrandose tras N paginas."""

    def __init__(self, morir_en: int, error: str):
        super().__init__()
        self.morir_en = morir_en
        self.error = error
        self.llamadas = 0
        self.pausa = (0, 0)

    def abrir(self, url: str, reintentos: int = 1) -> str:
        self.llamadas += 1
        if self.llamadas >= self.morir_en:
            raise Exception(self.error)
        return _pagina_falsa(self.llamadas)

    def cerrar(self) -> None:
        pass


def test_conserva_lo_rastreado_cuando_muere_el_navegador():
    f = MuereEnLaLlamada(3, "Page.goto: Target page, context or browser has been closed")
    resultados = f.buscar(CFG, max_paginas=1)
    assert len(resultados) == 60, "las dos primeras zonas deben sobrevivir"


def test_conserva_lo_rastreado_ante_cualquier_error():
    """No solo el del navegador: un fallo de red a mitad tampoco debe
    borrar lo anterior."""
    f = MuereEnLaLlamada(2, "net::ERR_NAME_NOT_RESOLVED")
    assert len(f.buscar(CFG, max_paginas=1)) == 30


def test_si_falla_la_primera_devuelve_vacio_sin_reventar():
    f = MuereEnLaLlamada(1, "lo que sea")
    assert f.buscar(CFG, max_paginas=1) == []


def test_no_se_queda_intentando_zonas_tras_morir_el_navegador():
    """Con el navegador muerto, seguir pidiendo zonas es tiempo tirado."""
    f = MuereEnLaLlamada(3, "Target page, context or browser has been closed")
    f.buscar(CFG, max_paginas=1)
    assert f.llamadas == 3, "debe parar en cuanto detecta que no hay navegador"


def test_un_error_puntual_no_impide_seguir_con_las_demas_zonas():
    """Un 404 en una zona no dice nada de las otras dos."""

    class FallaUnaVez(MuereEnLaLlamada):
        def abrir(self, url, reintentos=1):
            self.llamadas += 1
            if self.llamadas == 2:
                raise Exception("Timeout 60000ms exceeded")
            return _pagina_falsa(self.llamadas)

    f = FallaUnaVez(99, "")
    resultados = f.buscar(CFG, max_paginas=1)
    assert f.llamadas == 3, "debe intentar las tres zonas"
    assert len(resultados) == 60


def test_a_closed_browser_is_reported_as_a_warning():
    from buscapiso import events
    seen = []
    previous = events.set_sink(seen.append)
    try:
        MuereEnLaLlamada(morir_en=2,
                         error="Target page, context or browser has been closed"
                         ).buscar(CFG, max_paginas=1)
    finally:
        events.set_sink(previous)
    assert any(e.kind == "warning" and "browser" in e.message for e in seen)
