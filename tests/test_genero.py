"""La inferencia de genero decide si un anuncio entra o no en tu lista:
si es laxa, te llena el informe de pisos mixtos."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pytest

from fuentes.base import inferir_genero
from modelo import DESCONOCIDO, GENERO_CHICAS, GENERO_CHICOS, GENERO_MIXTO


@pytest.mark.parametrize("texto", [
    "Habitación en piso de chicas, muy luminosa",
    "Solo chicas, no fumadoras",
    "Buscamos una compañera de piso para octubre",
    "Somos 3 chicas tranquilas y ordenadas",
    "Piso femenino en el centro",
    "Es un pis només noies",
])
def test_reconoce_senales_de_piso_de_chicas(texto):
    genero, confirmado = inferir_genero(texto)
    assert genero == GENERO_CHICAS
    assert confirmado is False, "inferir nunca equivale a confirmar"


@pytest.mark.parametrize("texto", [
    "Piso mixto de estudiantes",
    "Compartido con chicos/as",
    "Viven chicas y chicos",
])
def test_reconoce_piso_mixto(texto):
    assert inferir_genero(texto)[0] == GENERO_MIXTO


def test_reconoce_piso_de_chicos():
    assert inferir_genero("Solo chicos, ambiente tranquilo")[0] == GENERO_CHICOS


@pytest.mark.parametrize("texto", [
    "Habitación amplia con armario empotrado y buena luz",
    "Piso reformado cerca del metro",
    "",
    "Se alquila habitación a persona responsable",
])
def test_sin_senales_no_adivina(texto):
    """Ante la duda, desconocido: el filtro estricto lo descartara, que es
    mejor que colar un piso mixto en una lista de pisos de chicas."""
    assert inferir_genero(texto)[0] == DESCONOCIDO


def test_mixto_gana_a_chicas_cuando_aparecen_los_dos():
    """'somos 2 chicas y 1 chico' no es un piso de chicas."""
    assert inferir_genero("Somos 2 chicas y chicos, piso mixto")[0] == GENERO_MIXTO


# --- catalan: en Barcelona la mitad de los anuncios no estan en castellano ---
@pytest.mark.parametrize("texto", [
    "Busquem només 3 Noies estudiants mir master Pis reformat",
    "Es busca noia per compartir pis al Clot",
    "Pis de noies, ambient tranquil",
    "Som 2 noies i busquem companya",
    "Només noies, no fumadores",
])
def test_reconoce_senales_en_catalan(texto):
    assert inferir_genero(texto)[0] == GENERO_CHICAS


def test_un_numero_por_medio_no_rompe_la_deteccion():
    """'només 3 Noies' fallaba con la primera version del patron."""
    assert inferir_genero("Busquem només 3 Noies")[0] == GENERO_CHICAS
    assert inferir_genero("Buscamos solo 2 chicas")[0] == GENERO_CHICAS


def test_nois_en_catalan_es_chicos_no_chicas():
    """'noies' y 'nois' se diferencian en una letra y significan lo
    contrario: confundirlos llenaria la lista de pisos de chicos."""
    assert inferir_genero("Només nois, pis tranquil")[0] == GENERO_CHICOS


# --- falsos positivos: la subcadena acierta, la frase no ----------------
@pytest.mark.parametrize("texto", [
    "Somos 2 chicas y 1 chico entre 24 y 27 años",
    "Buscamos compañero/a de piso para entrar el 1 de octubre",
    "Som 2 noies i un noi",
    "En el piso viven 3 chicos y 2 chicas",
    "Se alquila a chico/a responsable",
])
def test_mencionar_los_dos_generos_es_mixto(texto):
    """'Somos 2 chicas' es cierto dentro de 'Somos 2 chicas y 1 chico'.
    Este anuncio real entro en el informe como piso de chicas."""
    assert inferir_genero(texto)[0] == GENERO_MIXTO


def test_el_caso_real_que_se_colo():
    texto = ("Hola a todos!! Buscamos compañero/a de piso para entrar a partir "
             "del 1 de octubre. Buscamos a alguien que esté trabajando, tenga "
             "entre 24 y 29 años, y que sea limpio/a y ordenado/a. Somos 2 "
             "chicas y 1 chico entre 24 y 27 años")
    assert inferir_genero(texto)[0] == GENERO_MIXTO


def test_el_mixto_se_comprueba_antes_que_el_resto():
    """Aunque el texto traiga senales de chicas despues, manda el mixto."""
    assert inferir_genero("Piso de chicas. Bueno, somos 2 chicas y 1 chico")[0] == GENERO_MIXTO


def test_pero_un_piso_de_chicas_de_verdad_sigue_detectandose():
    assert inferir_genero("Somos 3 chicas y buscamos compañera")[0] == GENERO_CHICAS
    assert inferir_genero("Busquem només 3 Noies estudiants")[0] == GENERO_CHICAS
