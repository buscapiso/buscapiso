"""Interfaz que cumple toda fuente de anuncios.

Anadir un portal nuevo (Fotocasa, Habitaclia) es escribir una clase aqui al
lado. Ni el ranking ni el transporte ni el informe se enteran.
"""
from __future__ import annotations

from abc import ABC, abstractmethod

import re

from buscapiso.modelo import DESCONOCIDO, GENERO_CHICAS, GENERO_CHICOS, GENERO_MIXTO, Anuncio

# Solo idealista y roomgo publican el genero del piso como dato. En el resto
# hay que leerlo del texto libre, con dos reglas: exigir senales explicitas, y
# marcar el resultado como no confirmado para que el informe lo diga.
_SOLO_CHICAS = re.compile(
    # Castellano y catalan, y con numeros por medio: el texto real dice
    # "Busquem nomes 3 Noies estudiants", no "nomes noies".
    r"(?:piso|pis)\s+(?:de|solo|s[oó]lo|nom[eé]s|only)\s+(?:\d+\s+)?"
    r"(?:chicas|noi[ae]s?|dones|mujeres|girls)|"
    r"(?:solo|s[oó]lo|nom[eé]s|only|unicament|[uú]nicamente)\s+(?:\d+\s+)?"
    r"(?:chicas|noi[ae]s?|dones|mujeres|girls)|"
    r"(?:busco|buscamos|busquem|se\s+busca|es\s+busca)\s+"
    r"(?:nom[eé]s\s+|solo\s+|s[oó]lo\s+)?(?:\d+\s+)?"
    r"(?:una\s+)?(?:chicas?|compa[nñ]eras?|noi[ae]s?|companyes?)\b|"
    r"som\s+\d*\s*noi[ae]s?|somos\s+\d*\s*chicas|"
    r"piso\s+femenino|convivencia\s+femenina|pis\s+de\s+noi[ae]s?", re.I)
_SOLO_CHICOS = re.compile(r"solo\s+chicos|s[oó]lo\s+chicos|only\s+boys|"
                          r"nom[eé]s\s+(?:\d+\s+)?nois\b|"
                          r"piso\s+de\s+chicos|somos\s+\d*\s*chicos", re.I)
# Se comprueba ANTES que los patrones de "solo chicas", y por eso importa que
# sea generoso: "Somos 2 chicas" es cierto dentro de "Somos 2 chicas y 1
# chico", asi que un patron positivo acierta en la subcadena y falla en la
# frase. Si el texto nombra los dos generos, el piso es mixto.
_MIXTO = re.compile(
    r"\bmixto\b|\bmixte\b|chicos?/as|"
    r"chic[ao]s?\s+y\s+(?:\d+\s+|un[ao]?\s+)?chic[ao]s?|"
    r"noi[aes]*\s+i\s+(?:\d+\s+|un[ae]?\s+)?noi[aes]*|"
    # "compañero/a", "noi/a": aceptan cualquier genero.
    r"compa[nñ]er[oa]\s*/\s*a\b|noi\s*/\s*a\b|chic[oa]\s*/\s*a\b",
    re.I)


def inferir_genero(texto: str) -> tuple[str, bool]:
    """Deduce el genero del piso del texto libre.

    Devuelve (genero, confirmado). confirmado es siempre False: esto es una
    inferencia, y el informe debe poder distinguirla de un dato publicado.
    """
    if _MIXTO.search(texto):
        return GENERO_MIXTO, False
    if _SOLO_CHICAS.search(texto):
        return GENERO_CHICAS, False
    if _SOLO_CHICOS.search(texto):
        return GENERO_CHICOS, False
    return DESCONOCIDO, False


class Fuente(ABC):
    nombre: str = "base"

    @abstractmethod
    def buscar(self, cfg: dict, max_paginas: int = 3) -> list[Anuncio]:
        """Devuelve anuncios crudos, sin puntuar ni geocodificar."""

    def cerrar(self) -> None:
        """Libera recursos (navegador, sesion). Opcional."""


class BloqueoAntiBot(RuntimeError):
    """El portal ha respondido con un captcha o un 403."""
