"""Fuente De Piso en Piso (depisoenpiso.com).

Portal pequeno pero con una ventaja que no tiene ninguno de los grandes: la
tarjeta trae las COORDENADAS EXACTAS del piso, escondidas en el onclick del
boton del mapa. Eso ahorra geocodificar y, sobre todo, da tiempos de trayecto
reales en vez de estimados por centroide de barrio.

Ojo al orden: showMap('id', [lon, lat]), al reves de lo habitual.

La pega: la tarjeta del listado no dice el genero del piso ni trae
descripcion, asi que por si sola este portal no aporta nada a una busqueda de
pisos de chicas. La senal esta en la ficha ("Busquem nomes 3 Noies
estudiants"), asi que buscar() abre la ficha de cada anuncio. Son pocas
decenas, y sin eso el portal no sirve para nada.

La web se sirve en ingles aunque los pisos y los anuncios sean de Barcelona:
las descripciones estan en castellano y en catalan por igual.
"""
from __future__ import annotations

import pathlib
import random
import re
import time

from bs4 import BeautifulSoup

from buscapiso import navegador, paths
from buscapiso.fuentes.base import BloqueoAntiBot, Fuente, inferir_genero
from buscapiso.modelo import Anuncio

BASE = "https://www.depisoenpiso.com"
PERFIL = paths.browser_profile("dpp")

_PRECIO = re.compile(r"([\d.,]+)\s*€")
_COORDS = re.compile(r"showMap\(\s*'([^']+)'\s*,\s*\[\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*\]")
_HABS = re.compile(r"(\d+)\s*Free\s*rooms?", re.I)
_FECHA = re.compile(r"Available\s+on\s+([\d/]+)", re.I)


def parsear_ficha(html: str) -> dict:
    """De la ficha solo interesa la descripcion: es donde el anunciante dice
    si el piso es de chicas, casi siempre en castellano o catalan."""
    sopa = BeautifulSoup(html, "lxml")
    datos: dict = {"ficha_leida": True}
    for h in sopa.select("h1, h2, h3, h4"):
        if h.get_text(strip=True).lower() in ("description", "descripcion", "descripció"):
            sig = h.find_next_sibling()
            if sig:
                texto = sig.get_text(" ", strip=True)
                if len(texto) > 20:
                    datos["descripcion"] = texto
            break
    return datos


def construir_url(ciudad: str = "Barcelona") -> str:
    return f"{BASE}/find-places.html?ciudad={ciudad}"


def parsear_listado(html: str) -> list[Anuncio]:
    sopa = BeautifulSoup(html, "lxml")
    anuncios: list[Anuncio] = []

    for tarjeta in sopa.select("div[id^='prop-']"):
        id_portal = (tarjeta.get("id") or "").replace("prop-", "")
        enlace = tarjeta.select_one("a[href]")
        if not id_portal or not enlace:
            continue

        precio = None
        if (el := tarjeta.select_one(".property__price")):
            if (m := _PRECIO.search(el.get_text(" ", strip=True))):
                precio = int(float(m.group(1).replace(".", "").replace(",", ".")))

        titulo = ""
        if (el := tarjeta.select_one(".card-title")):
            titulo = el.get_text(" ", strip=True)

        direccion = ""
        habitaciones = None
        admite_parejas = None
        disponible = ""
        for p in tarjeta.select(".property__summary p"):
            txt = p.get_text(" ", strip=True)
            if (m := _HABS.search(txt)):
                habitaciones = int(m.group(1))
            elif (m := _FECHA.search(txt)):
                disponible = m.group(1)
            elif "couples" in txt.lower():
                admite_parejas = "not allowed" not in txt.lower()
            elif txt and not direccion:
                direccion = txt

        # showMap('id', [lon, lat]) -- el orden es lon primero.
        lat = lon = None
        if (m := _COORDS.search(str(tarjeta))):
            lon, lat = float(m.group(2)), float(m.group(3))

        foto = ""
        if (el := tarjeta.select_one(".property__img")):
            if (m := re.search(r"url\('([^']+)'\)", el.get("style", "") or "")):
                foto = m.group(1)

        genero, confirmado = inferir_genero(f"{titulo} {direccion}")

        anuncios.append(Anuncio(
            portal="depisoenpiso", id_portal=id_portal,
            url=enlace.get("href", ""), titulo=titulo or "Habitación",
            precio=precio, direccion=direccion, municipio="Barcelona",
            lat=lat, lon=lon, coords_aproximadas=lat is None,
            genero_piso=genero, genero_confirmado=confirmado,
            habitaciones=habitaciones, admite_parejas=admite_parejas,
            disponible_desde=disponible, foto=foto))
    return anuncios


class DePisoEnPiso(Fuente):
    nombre = "depisoenpiso"

    def __init__(self, cache_dir: pathlib.Path | None = None, pausa=(3.0, 6.0)):
        self.cache_dir = cache_dir
        self.pausa = pausa
        self._ctx = self._pagina = None

    def _navegador(self):
        if self._pagina is not None:
            return self._pagina
        self._ctx = navegador.contexto(PERFIL)
        self._pagina = self._ctx.pages[0] if self._ctx.pages else self._ctx.new_page()
        return self._pagina

    def buscar(self, cfg: dict, max_paginas: int = 3) -> list[Anuncio]:
        pg = self._navegador()
        try:
            pg.goto(construir_url("Barcelona"), wait_until="domcontentloaded",
                    timeout=60000)
            time.sleep(3)
            for sel in ["button:has-text('Aceptar')", "button:has-text('Accept')",
                        ".cookie-accept"]:
                try:
                    pg.click(sel, timeout=1800)
                    break
                except Exception:
                    pass
            # Sin paginacion por URL: se cargan mas anuncios bajando.
            previos = 0
            for _ in range(max_paginas):
                pg.mouse.wheel(0, 4000)
                time.sleep(random.uniform(*self.pausa))
                ahora = len(pg.query_selector_all("div[id^='prop-']"))
                if ahora == previos:
                    break
                previos = ahora
            html = pg.content()
        except Exception as e:
            print(f"  depisoenpiso: {str(e)[:70]}")
            return []
        if len(html) < 5000:
            raise BloqueoAntiBot("respuesta vacia en depisoenpiso")
        if self.cache_dir:
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            (self.cache_dir / "dpp_barcelona.html").write_text(html, encoding="utf-8")
        anuncios = parsear_listado(html)
        print(f"  depisoenpiso: {len(anuncios)} anuncios, leyendo sus fichas...")

        # Sin la ficha, este portal no dice el genero y todo se descarta.
        for a in anuncios:
            try:
                pg.goto(a.url, wait_until="domcontentloaded", timeout=45000)
                time.sleep(random.uniform(*self.pausa))
                for clave, valor in parsear_ficha(pg.content()).items():
                    setattr(a, clave, valor)
                genero, confirmado = inferir_genero(f"{a.titulo} {a.descripcion}")
                if genero != a.genero_piso:
                    a.genero_piso, a.genero_confirmado = genero, confirmado
            except Exception as e:
                if navegador.esta_muerto(e):
                    print("  se ha cerrado el navegador; dejo de leer fichas")
                    break
                continue    # una ficha ilegible no tumba el resto
        con_genero = sum(1 for a in anuncios if a.genero_piso != "desconocido")
        print(f"  depisoenpiso: {con_genero} con genero identificado")
        return anuncios

    def cerrar(self) -> None:
        # Solo cierra SU contexto: Playwright es compartido y lo para
        # navegador.cerrar_todo() al terminar la busqueda.
        navegador.cerrar_contexto(self._ctx)
        self._ctx = self._pagina = None
