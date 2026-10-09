import pathlib
import sys


from buscapiso.deduplicar import deduplicar
from buscapiso.modelo import GENERO_CHICAS, Anuncio


def a(portal="idealista", id_portal="1", precio=500, lat=41.3758, lon=2.1184, **kw):
    return Anuncio(portal=portal, id_portal=id_portal, url=f"https://{portal}/{id_portal}",
                   precio=precio, lat=lat, lon=lon, **kw)


def test_el_mismo_piso_en_dos_portales_sale_una_vez():
    unicos, fusionados = deduplicar([
        a("idealista", "1", 500, descripcion="piso bonito"),
        a("roomgo", "9", 505),
    ])
    assert len(unicos) == 1
    assert fusionados == 1
    assert "roomgo" in unicos[0].tambien_en


def test_dos_pisos_distintos_no_se_fusionan_por_estar_cerca():
    unicos, _ = deduplicar([a("idealista", "1", 400), a("roomgo", "9", 700)])
    assert len(unicos) == 2


def test_dos_pisos_al_mismo_precio_pero_lejos_no_se_fusionan():
    unicos, _ = deduplicar([
        a("idealista", "1", 500, lat=41.3758, lon=2.1184),
        a("roomgo", "9", 500, lat=41.4030, lon=2.1560),
    ])
    assert len(unicos) == 2


def test_sin_coordenadas_no_se_afirma_que_sean_el_mismo():
    """Precio igual no basta: en Barcelona hay cientos de habitaciones a 500 €."""
    unicos, _ = deduplicar([
        a("idealista", "1", 500, lat=None, lon=None),
        a("roomgo", "9", 500, lat=None, lon=None),
    ])
    assert len(unicos) == 2


def test_gana_el_anuncio_con_mas_datos():
    pobre = a("roomgo", "9", 500)
    rico = a("idealista", "1", 500, descripcion="x", foto="f", companeros=3,
             habitaciones=4, gastos_extra=50)
    unicos, _ = deduplicar([pobre, rico])
    assert unicos[0].portal == "idealista"


def test_el_perdedor_aporta_lo_que_al_ganador_le_falta():
    rico = a("roomgo", "9", 500, descripcion="x", foto="f", companeros=3,
             habitaciones=2, gastos_extra=40, barrio="Collblanc")
    con_genero = a("idealista", "1", 500, genero_piso=GENERO_CHICAS,
                   genero_confirmado=True, edad_companeros="25-30")
    unicos, _ = deduplicar([rico, con_genero])
    assert len(unicos) == 1
    # El genero confirmado de idealista se impone aunque gane la otra ficha.
    assert unicos[0].genero_piso == GENERO_CHICAS
    assert unicos[0].genero_confirmado is True
    assert unicos[0].edad_companeros == "25-30"


def test_no_deduplica_dentro_del_mismo_portal():
    """Dentro de un portal el id ya es unico; fusionar ahi seria un error."""
    unicos, _ = deduplicar([a("roomgo", "1", 500), a("roomgo", "2", 500)])
    assert len(unicos) == 2


def test_lista_vacia():
    assert deduplicar([]) == ([], 0)
