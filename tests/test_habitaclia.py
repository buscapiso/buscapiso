import pathlib

import pytest

from buscapiso.fuentes import habitaclia
from buscapiso.modelo import TIPO_PISO

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "habitaclia_pisos.html"


@pytest.fixture(scope="module")
def anuncios():
    return habitaclia.parsear_listado(FIXTURE.read_text(encoding="utf-8"))


def test_reads_every_flat_on_the_page(anuncios):
    assert len(anuncios) == 29
    assert all(a.portal == "habitaclia" and a.tipo == TIPO_PISO for a in anuncios)
    assert len({a.id_portal for a in anuncios}) == 29


def test_first_flat_has_its_details(anuncios):
    a = anuncios[0]
    assert a.precio == 4469
    assert a.habitaciones == 3
    assert a.banos == 2
    assert a.superficie_m2 == 195
    assert a.planta == "4"
    assert a.ascensor is True
    assert a.barrio == "Dreta de l'Eixample"
    assert a.municipio == "Barcelona"
    assert a.direccion == "Rambla Catalunya 129"
    assert a.lat == pytest.approx(41.3955, abs=1e-3)
    # visibility ZONE: la posicion es de la zona, no del portal.
    assert a.coords_aproximadas is True
    assert a.url == ("https://www.habitaclia.com/alquiler/planta-intermedia/eixample/"
                     "barcelona-capital/03118011-96e2-45f7-bed5-f58f05f7232a/d")
    assert a.foto.startswith("https://")
    assert a.descripcion.startswith("Fantástico piso")
    assert a.antiguedad_dias is not None


def test_furnished_and_temporary_come_from_the_features(anuncios):
    assert sum(1 for a in anuncios if a.amueblado) == 27
    assert any("temporal" in a.descripcion_extra.lower() for a in anuncios)


def test_exact_positions_are_not_approximate(anuncios):
    assert any(not a.coords_aproximadas for a in anuncios)


def test_pagination_is_read():
    html = FIXTURE.read_text(encoding="utf-8")
    assert habitaclia.paginas_totales(html) == 106


def test_a_page_without_data_gives_nothing():
    assert habitaclia.parsear_listado("<html>captcha</html>") == []
    assert habitaclia.paginas_totales("<html></html>") == 0


def test_urls():
    assert habitaclia.construir_url("barcelona-capital") == (
        "https://www.habitaclia.com/alquiler/viviendas/barcelona-provincia/"
        "barcelona-capital/s")
    assert habitaclia.construir_url("barcelona-capital/eixample", 3).endswith(
        "/barcelona-capital/eixample/s/3")


def test_search_walks_pages_and_stops_when_they_run_out():
    html = FIXTURE.read_text(encoding="utf-8")
    pedidas = []

    def get(url):
        pedidas.append(url)
        return html if len(pedidas) == 1 else "<html></html>"

    fuente = habitaclia.Habitaclia(get=get, pausa=(0, 0))
    res = fuente.buscar({"zonas_habitaclia": ["barcelona-capital"],
                         "presupuesto": {"coste_total_maximo": 99999}}, max_paginas=3)
    assert len(res) == 29
    assert len(pedidas) == 2


def test_search_skips_an_area_that_fails_and_keeps_going():
    html = FIXTURE.read_text(encoding="utf-8")

    def get(url):
        if "badalona" in url:
            raise habitaclia.HTTPError("403")
        return html

    fuente = habitaclia.Habitaclia(get=get, pausa=(0, 0))
    res = fuente.buscar({"zonas_habitaclia": ["badalona", "barcelona-capital"],
                         "presupuesto": {"coste_total_maximo": 99999}}, max_paginas=1)
    assert len(res) == 29


def test_budget_bedrooms_and_surface_go_in_the_url():
    pedidas = []

    def get(url):
        pedidas.append(url)
        return "<html></html>"

    habitaclia.Habitaclia(get=get, pausa=(0, 0)).buscar({
        "zonas_habitaclia": ["barcelona-capital"],
        "presupuesto": {"coste_total_maximo": 1400},
        "piso": {"habitaciones_min": 2, "superficie_min": 60},
        "busqueda": {"orden_fotocasa": "baratos"}}, max_paginas=1)
    assert pedidas == [habitaclia.BASE + "/alquiler/viviendas/barcelona-provincia/"
                       "barcelona-capital/s?maxPrice=1400&minRooms=2&minSurface=60"
                       "&sortBy=PRICE_ASC"]


def test_pages_are_saved_for_rescoring(tmp_path):
    html = FIXTURE.read_text(encoding="utf-8")
    fuente = habitaclia.Habitaclia(cache_dir=tmp_path, get=lambda u: html, pausa=(0, 0))
    fuente.buscar({"zonas_habitaclia": ["barcelona-capital"], "presupuesto": {}},
                  max_paginas=1)
    assert [f.name.startswith("habitaclia_") for f in tmp_path.iterdir()] == [True]


def test_a_placeholder_surface_of_1_m2_means_unknown():
    from buscapiso.fuentes.base import superficie
    assert [superficie(v) for v in (1, 0, None, "x", 2, 85)] == [None, None, None, None, 2, 85]
