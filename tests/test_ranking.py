import pathlib
import sys


import pytest
import yaml

from buscapiso.modelo import DESCONOCIDO, GENERO_CHICAS, GENERO_CHICOS, GENERO_MIXTO, Anuncio
from buscapiso.ranking import filtrar, ordenar, puntuar


@pytest.fixture
def cfg():
    return yaml.safe_load((pathlib.Path(__file__).resolve().parents[1] / "config.yaml").read_text())


@pytest.fixture
def zonas():
    return {"excluir": [], "penalizar": [], "preferir": []}


def anuncio(**kw) -> Anuncio:
    fira = kw.pop("minutos_fira", 12.0)
    trayectos = {"Fira": fira} if fira is not None else {}
    trayectos["Collblanc"] = 10.0
    base = dict(portal="idealista", id_portal="1", url="https://x/1",
                precio=450, gastos_extra=50, genero_piso=GENERO_CHICAS,
                trayectos=trayectos, barrio="Sants",
                municipio="Barcelona", coords_aproximadas=False, companeros=3)
    base.update(kw)
    return Anuncio(**base)


# --- filtros duros -----------------------------------------------------
def test_descarta_piso_mixto_aunque_idealista_lo_devuelva(cfg, zonas):
    ok, _posibles, fuera = filtrar([anuncio(genero_piso=GENERO_MIXTO)], cfg, zonas)
    assert ok == []
    assert "no solo chicas" in fuera[0][1]


def test_descarta_por_coste_total_no_por_precio(cfg, zonas):
    # 550 de habitacion parece caro pero con gastos incluidos entra;
    # 490 + 200 de gastos no.
    barato_en_apariencia = anuncio(precio=490, gastos_extra=200)
    caro_en_apariencia = anuncio(precio=550, gastos_extra=0)
    ok, _posibles, fuera = filtrar([barato_en_apariencia, caro_en_apariencia], cfg, zonas)
    assert [a.precio for a in ok] == [550]
    assert "por encima del maximo" in fuera[0][1]


def test_descarta_por_tiempo_al_trabajo(cfg, zonas):
    ok, _posibles, fuera = filtrar([anuncio(minutos_fira=45.0)], cfg, zonas)
    assert ok == []
    assert "45 min a Fira" in fuera[0][1]


def test_descarta_zona_excluida_por_el_usuario(cfg):
    zonas = {"excluir": ["La Mina"], "penalizar": [], "preferir": []}
    ok, _posibles, fuera = filtrar([anuncio(barrio="La Mina")], cfg, zonas)
    assert ok == []
    assert "zona excluida" in fuera[0][1]


def test_descarta_lo_que_ya_habias_descartado(cfg, zonas):
    a = anuncio()
    ok, _posibles, fuera = filtrar([a], cfg, zonas, descartados={a.id})
    assert ok == []
    assert "descartaste" in fuera[0][1]


def test_sin_ubicacion_no_pasa_el_filtro(cfg, zonas):
    ok, _posibles, fuera = filtrar([anuncio(minutos_fira=None)], cfg, zonas)
    assert ok == []
    assert "ubicacion" in fuera[0][1]


# --- puntuacion --------------------------------------------------------
def test_mas_cerca_del_trabajo_puntua_mas(cfg, zonas):
    cerca = puntuar(anuncio(minutos_fira=8.0), cfg, zonas)
    lejos = puntuar(anuncio(minutos_fira=28.0), cfg, zonas)
    assert cerca > lejos


def test_mas_barato_puntua_mas(cfg, zonas):
    barato = puntuar(anuncio(precio=400, gastos_extra=50), cfg, zonas)
    caro = puntuar(anuncio(precio=550, gastos_extra=80), cfg, zonas)
    assert barato > caro


def test_anuncio_recien_publicado_adelanta(cfg, zonas):
    viejo = anuncio()
    nuevo = anuncio(publicado_texto="16 sep")
    assert puntuar(nuevo, cfg, zonas) > puntuar(viejo, cfg, zonas)
    assert any("publicado" in m for m in nuevo.motivos)


def test_ubicacion_estimada_penaliza(cfg, zonas):
    exacta = puntuar(anuncio(coords_aproximadas=False), cfg, zonas)
    estimada = puntuar(anuncio(coords_aproximadas=True), cfg, zonas)
    assert exacta > estimada


def test_zona_preferida_suma_y_penalizada_resta(cfg):
    z = {"excluir": [], "penalizar": ["Bellvitge"], "preferir": ["Collblanc"]}
    buena = puntuar(anuncio(barrio="Collblanc"), cfg, z)
    neutra = puntuar(anuncio(barrio="Sants"), cfg, z)
    mala = puntuar(anuncio(barrio="Bellvitge"), cfg, z)
    assert buena > neutra > mala


def test_toda_puntuacion_viene_con_motivos(cfg, zonas):
    a = anuncio(publicado_texto="16 sep", descripcion="piso de estudiantes")
    puntuar(a, cfg, zonas)
    assert len(a.motivos) >= 4
    assert any("min a Fira" in m for m in a.motivos)
    assert any("€/mes" in m for m in a.motivos)


def test_ordenar_devuelve_de_mejor_a_peor(cfg, zonas):
    lista = [anuncio(id_portal="a", minutos_fira=28.0),
             anuncio(id_portal="b", minutos_fira=8.0),
             anuncio(id_portal="c", minutos_fira=18.0)]
    assert [a.id_portal for a in ordenar(lista, cfg, zonas)] == ["b", "c", "a"]


# --- gastos no declarados ----------------------------------------------
def test_ocultar_los_gastos_no_da_ventaja(cfg, zonas):
    """El que calla sus gastos no debe adelantar al que los declara."""
    calla = anuncio(id_portal="a", precio=500, gastos_extra=None)
    declara = anuncio(id_portal="b", precio=450, gastos_extra=60)
    # 450+60=510 real frente a 500+55=555 supuesto: gana el que declara.
    assert puntuar(declara, cfg, zonas) > puntuar(calla, cfg, zonas)
    assert any("sin declarar" in m for m in calla.motivos)


def test_el_coste_total_sigue_siendo_el_dato_factual(cfg):
    a = anuncio(precio=500, gastos_extra=None)
    assert a.coste_total == 500                       # lo que dice el anuncio
    assert a.coste_estimado(55) == 555                # lo que uso para puntuar


def test_el_filtro_duro_usa_el_coste_estimado(cfg, zonas):
    # 620 sin declarar gastos -> 675 estimados -> por encima del maximo de 650.
    ok, _posibles, fuera = filtrar([anuncio(precio=620, gastos_extra=None)], cfg, zonas)
    assert ok == []
    assert "675 € totales" in fuera[0][1]


def test_gastos_incluidos_explicitos_se_dicen_asi(cfg, zonas):
    a = anuncio(precio=520, gastos_extra=0)
    puntuar(a, cfg, zonas)
    assert any("todo incluido" in m for m in a.motivos)


# --- alquileres temporales ---------------------------------------------
@pytest.mark.parametrize("texto", [
    "Buscamos compañera de piso de octubre a diciembre",
    "Habitación solo temporada de verano",
    "Se alquila únicamente por 2 meses",
    "Alquiler turístico por días sueltos",
])
def test_detecta_alquileres_temporales(cfg, zonas, texto):
    temporal = anuncio(id_portal="t", descripcion=texto)
    normal = anuncio(id_portal="n", descripcion="Habitación amplia y luminosa")
    assert puntuar(temporal, cfg, zonas) < puntuar(normal, cfg, zonas)
    assert any("temporal" in m for m in temporal.motivos)


def test_no_confunde_una_fecha_de_entrada_con_temporalidad(cfg, zonas):
    a = anuncio(descripcion="Disponible a partir de octubre, contrato de un año")
    puntuar(a, cfg, zonas)
    assert not any("temporal" in m for m in a.motivos)


def test_el_descarte_distingue_mixto_de_genero_desconocido(cfg, zonas):
    """No es lo mismo saber que es mixto que no saberlo: lo primero se
    descarta, lo segundo se puede resolver preguntando."""
    from buscapiso.modelo import DESCONOCIDO
    cfg["requisitos"]["preguntar_si_genero_desconocido"] = False
    _, _posibles, fuera = filtrar([anuncio(id_portal="a", genero_piso=GENERO_MIXTO),
                                   anuncio(id_portal="b", genero_piso=DESCONOCIDO)],
                                  cfg, zonas)
    motivos = {a.id_portal: m for a, m in fuera}
    assert "no solo chicas" in motivos["a"]
    assert "no dice el genero" in motivos["b"]


# --- posibles: genero sin confirmar ------------------------------------
def test_genero_desconocido_va_a_posibles_no_a_la_basura(cfg, zonas):
    from buscapiso.modelo import DESCONOCIDO
    cfg["requisitos"]["preguntar_si_genero_desconocido"] = True
    ok, posibles, fuera = filtrar([anuncio(genero_piso=DESCONOCIDO)], cfg, zonas)
    assert ok == [] and fuera == []
    assert len(posibles) == 1


def test_un_piso_mixto_nunca_es_un_posible(cfg, zonas):
    """Saber que es mixto es un no definitivo: preguntar no lo cambia."""
    cfg["requisitos"]["preguntar_si_genero_desconocido"] = True
    ok, posibles, fuera = filtrar([anuncio(genero_piso=GENERO_MIXTO)], cfg, zonas)
    assert posibles == [] and len(fuera) == 1


def test_un_posible_sigue_pasando_los_demas_filtros(cfg, zonas):
    """Sin género confirmado pero demasiado lejos o demasiado caro sigue
    siendo un descarte: lo dudoso es el género, no el resto."""
    from buscapiso.modelo import DESCONOCIDO
    cfg["requisitos"]["preguntar_si_genero_desconocido"] = True
    lejos = anuncio(id_portal="a", genero_piso=DESCONOCIDO, minutos_fira=90.0)
    caro = anuncio(id_portal="b", genero_piso=DESCONOCIDO, precio=900, gastos_extra=0)
    ok, posibles, fuera = filtrar([lejos, caro], cfg, zonas)
    assert posibles == []
    assert len(fuera) == 2


def test_every_limited_destination_is_a_hard_filter(cfg, zonas):
    cfg["destinos"][1]["max_minutos"] = 15
    a = anuncio()
    a.trayectos["Collblanc"] = 25.0
    ok, _posibles, fuera = filtrar([a], cfg, zonas)
    assert ok == []
    assert fuera[0][1] == "25 min a Collblanc"


def test_without_destinations_nothing_is_dropped_for_distance(cfg, zonas):
    cfg["destinos"] = []
    ok, _posibles, _fuera = filtrar([anuncio(minutos_fira=None, trayectos={})],
                                    cfg, zonas)
    assert len(ok) == 1


def test_each_destination_scores_with_its_own_weight(cfg, zonas):
    cerca = anuncio()
    puntuar(cerca, cfg, zonas)
    assert any("min a Fira" in m for m in cerca.motivos)
    assert any("min a Collblanc" in m for m in cerca.motivos)


@pytest.mark.parametrize("genero, piso, pasa", [
    ("cualquiera", GENERO_MIXTO, True),
    ("cualquiera", DESCONOCIDO, True),
    ("chicos", GENERO_CHICOS, True),
    ("chicos", GENERO_CHICAS, False),
    ("mixto", GENERO_MIXTO, True),
    ("mixto", GENERO_CHICAS, False),
])
def test_household_gender_filter(cfg, zonas, genero, piso, pasa):
    cfg["requisitos"]["genero"] = genero
    cfg["requisitos"]["preguntar_si_genero_desconocido"] = False
    ok, _posibles, _fuera = filtrar([anuncio(genero_piso=piso)], cfg, zonas)
    assert (len(ok) == 1) is pasa


def test_any_gender_never_sends_unknowns_to_the_ask_list(cfg, zonas):
    cfg["requisitos"]["genero"] = "cualquiera"
    cfg["requisitos"]["preguntar_si_genero_desconocido"] = True
    ok, posibles, _fuera = filtrar([anuncio(genero_piso=DESCONOCIDO)], cfg, zonas)
    assert len(ok) == 1
    assert posibles == []
