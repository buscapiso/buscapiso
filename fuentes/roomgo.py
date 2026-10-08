"""Fuente Roomgo (antes EasyPiso). Especialista en habitaciones.

A diferencia de idealista, roomgo publica el genero del piso como dato
estructurado ("2 companeros de piso - mixto"), asi que aqui no hay que
inferirlo del texto salvo cuando el anunciante no lo rellena.

No usa sus filtros de URL: el formulario es un POST de registro, no de
busqueda. Se pagina con ?page=N y se filtra en local, que es mas robusto que
depender de una UI que cambia.
"""
from __future__ import annotations

import pathlib
import random
import re
import time

from bs4 import BeautifulSoup

import navegador
from fuentes.base import BloqueoAntiBot, Fuente, inferir_genero
from modelo import (DESCONOCIDO, GENERO_CHICAS, GENERO_CHICOS, GENERO_MIXTO,
                    Anuncio)

BASE = "https://www.roomgo.es"
PERFIL = pathlib.Path(__file__).resolve().parents[1] / ".perfil-roomgo"

_PRECIO = re.compile(r"([\d.]+)\s*€")
_COMPAS = re.compile(r"(\d+)\s+compa[nñ]er")
_GENEROS = {
    "mixto": GENERO_MIXTO,
    "chicas": GENERO_CHICAS, "mujeres": GENERO_CHICAS, "femenino": GENERO_CHICAS,
    "chicos": GENERO_CHICOS, "hombres": GENERO_CHICOS, "masculino": GENERO_CHICOS,
}


def construir_url(ciudad: str = "barcelona", pagina: int = 1) -> str:
    url = f"{BASE}/{ciudad}/piso-compartido-{ciudad}"
    return f"{url}?page={pagina}" if pagina > 1 else url


def _genero_y_companeros(texto: str) -> tuple[str, bool, int | None]:
    """'2 companeros de piso - mixto' -> (mixto, confirmado, 2)."""
    companeros = None
    if (m := _COMPAS.search(texto)):
        companeros = int(m.group(1))
    bajo = texto.lower()
    for palabra, genero in _GENEROS.items():
        if palabra in bajo:
            return genero, True, companeros
    return DESCONOCIDO, False, companeros


def parsear_listado(html: str) -> list[Anuncio]:
    sopa = BeautifulSoup(html, "lxml")
    anuncios: list[Anuncio] = []

    for tarjeta in sopa.select(".listing_item"):
        ruta = tarjeta.get("data-url") or ""
        if not ruta:
            enlace = tarjeta.select_one("a[href]")
            ruta = enlace.get("href", "") if enlace else ""
        if not ruta:
            continue
        id_portal = ruta.rstrip("/").split("/")[-1]

        precio = None
        if (el := tarjeta.select_one(".listing_item_price")):
            # "1.050 € por mes": el punto es separador de miles, no decimal.
            if (m := _PRECIO.search(el.get_text(" ", strip=True))):
                precio = int(m.group(1).replace(".", ""))

        titulo = ""
        if (el := tarjeta.select_one(".listing_item_details .heading")):
            titulo = el.get_text(" ", strip=True)

        descripcion = ""
        for div in tarjeta.select(".listing_item_details > div"):
            txt = div.get_text(" ", strip=True)
            if txt and txt != titulo and "Disponible" not in txt and len(txt) > 40:
                descripcion = txt
                break

        direccion = barrio = ""
        if (el := tarjeta.select_one(".listing_item_address")):
            partes = [p.strip() for p in el.get_text(" ", strip=True).split(",")]
            direccion = partes[0] if partes else ""
            barrio = partes[-1] if len(partes) > 1 else ""

        genero, confirmado, companeros = DESCONOCIDO, False, None
        if (el := tarjeta.select_one(".listing_item_nb_flatmates")):
            genero, confirmado, companeros = _genero_y_companeros(
                el.get_text(" ", strip=True))
        if genero == DESCONOCIDO:
            genero, confirmado = inferir_genero(f"{titulo} {descripcion}")

        disponible = ""
        if (el := tarjeta.select_one(".listing_item_when_available")):
            txt = el.get_text(" ", strip=True)
            disponible = "ahora" if "ahora" in txt.lower() else txt

        # El src es un pixel base64 de carga diferida; la foto va en data-src.
        foto = ""
        if (img := tarjeta.select_one("img")):
            foto = img.get("data-src") or ""
            if foto.startswith("data:"):
                foto = ""

        anuncios.append(Anuncio(
            portal="roomgo", id_portal=id_portal,
            url=BASE + ruta if ruta.startswith("/") else ruta,
            titulo=titulo, precio=precio, direccion=direccion, barrio=barrio,
            municipio="Barcelona", genero_piso=genero,
            genero_confirmado=confirmado, companeros=companeros,
            descripcion=descripcion, foto=foto, disponible_desde=disponible,
            publicado_texto=disponible))
    return anuncios


class Roomgo(Fuente):
    nombre = "roomgo"

    def __init__(self, cache_dir: pathlib.Path | None = None, pausa=(3.0, 7.0)):
        self.cache_dir = cache_dir
        self.pausa = pausa
        self._ctx = self._pagina = None

    def _navegador(self):
        if self._pagina is not None:
            return self._pagina
        self._ctx = navegador.contexto(PERFIL)
        self._pagina = self._ctx.pages[0] if self._ctx.pages else self._ctx.new_page()
        return self._pagina

    def abrir(self, url: str) -> str:
        pg = self._navegador()
        pg.goto(url, wait_until="domcontentloaded", timeout=60000)
        time.sleep(2.5)
        for sel in ["#onetrust-accept-btn-handler", "button:has-text('Aceptar')"]:
            try:
                pg.click(sel, timeout=2000)
                break
            except Exception:
                pass
        html = pg.content()
        if len(html) < 5000:
            raise BloqueoAntiBot(f"respuesta vacia en {url}")
        if self.cache_dir:
            import hashlib
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            nombre = re.sub(r"\W+", "_", url.replace(BASE, ""))[:70]
            firma = hashlib.sha1(url.encode()).hexdigest()[:8]
            (self.cache_dir / f"roomgo_{nombre}_{firma}.html").write_text(
                html, encoding="utf-8")
        return html

    def buscar(self, cfg: dict, max_paginas: int = 3) -> list[Anuncio]:
        resultados, vistos = [], set()
        for pagina in range(1, max_paginas + 1):
            try:
                html = self.abrir(construir_url("barcelona", pagina))
            except BloqueoAntiBot as e:
                print(f"  roomgo: {e}")
                break
            except Exception as e:
                # Lo ya rastreado se devuelve igual: un fallo en la pagina N
                # no invalida las anteriores.
                if navegador.esta_muerto(e):
                    print(f"  se ha cerrado el navegador; me quedo con "
                          f"{len(resultados)} anuncios de roomgo")
                else:
                    print(f"  roomgo p{pagina} ha fallado ({str(e)[:55]})")
                break
            lote = [a for a in parsear_listado(html) if a.id_portal not in vistos]
            vistos.update(a.id_portal for a in lote)
            resultados.extend(lote)
            print(f"  roomgo p{pagina}: {len(lote)} anuncios")
            if not lote:
                break
            time.sleep(random.uniform(*self.pausa))
        return resultados

    def cerrar(self) -> None:
        # Solo cierra SU contexto: Playwright es compartido y lo para
        # navegador.cerrar_todo() al terminar la busqueda.
        navegador.cerrar_contexto(self._ctx)
        self._ctx = self._pagina = None
