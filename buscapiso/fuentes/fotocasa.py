"""Fuente Fotocasa, seccion "compartir pisos" (~8.000 habitaciones en Barcelona).

Fotocasa no pinta los anuncios en el HTML: los entrega en un JSON incrustado
en la pagina y los renderiza despues con JavaScript. Eso es una ventaja, no un
obstaculo: el JSON trae coordenadas, antiguedad del anuncio en dias y un campo
isTemporaryRental, datos que en idealista hay que geocodificar o adivinar con
expresiones regulares.

El JSON se localiza por su CLAVE ("realEstates"), no por el nombre de la
variable de JavaScript que lo contiene: el framework renombra la variable en
cada despliegue, la clave de datos no.

Ojo con accuracy=False: la posicion es del barrio, no del portal. Marcarla
como exacta haria que estos anuncios adelantasen a los que si tienen
direccion real.

Habitaclia, del mismo grupo, ya no tiene seccion de habitaciones: su pagina
/pisoscompartidos.htm y las cuatro variantes de URL probadas devuelven error.
"""
from __future__ import annotations

import json
import pathlib
import random
import re
import time

from buscapiso import navegador, paths
from buscapiso.events import emit
from buscapiso.fuentes.base import BloqueoAntiBot, Fuente, inferir_genero
from buscapiso.modelo import Anuncio

BASE = "https://www.fotocasa.es"
PERFIL = paths.browser_profile("fotocasa")

ORDENES = {
    "baratos": "?sortType=price&sortOrderDesc=false",
    "nuevos": "?sortType=publicationDate&sortOrderDesc=true",
    "relevancia": "",
}

_UNIDADES = {"DAYS": ("día", "días"), "HOURS": ("hora", "horas"),
             "MONTHS": ("mes", "meses"), "MINUTES": ("minuto", "minutos")}


def construir_url(zona: str, pagina: int = 1, orden: str = "relevancia") -> str:
    url = f"{BASE}/es/compartir/pisos/{zona}/l"
    if pagina > 1:
        url += f"/{pagina}"
    return url + ORDENES.get(orden, "")


def extraer_json(html: str, clave: str):
    """Devuelve el array JSON que sigue a "clave": [ ... ].

    Cuenta corchetes respetando cadenas y escapes, porque el blob mide cientos
    de miles de caracteres y una expresion regular no sabe donde termina.
    """
    marca = f'"{clave}":['
    inicio = html.find(marca)
    while inicio >= 0:
        j = inicio + len(marca) - 1
        prof, en_cadena, escapa = 0, False, False
        for k in range(j, len(html)):
            c = html[k]
            if escapa:
                escapa = False
                continue
            if c == "\\":
                escapa = True
                continue
            if c == '"':
                en_cadena = not en_cadena
                continue
            if en_cadena:
                continue
            if c == "[":
                prof += 1
            elif c == "]":
                prof -= 1
                if prof == 0:
                    try:
                        datos = json.loads(html[j:k + 1])
                    except json.JSONDecodeError:
                        break
                    if datos:
                        return datos
                    break
        inicio = html.find(marca, inicio + 1)
    return None


def _antiguedad(fecha: dict | None) -> str:
    if not fecha or fecha.get("diff") is None:
        return ""
    n = fecha["diff"]
    singular, plural = _UNIDADES.get(fecha.get("unit", "DAYS"), ("día", "días"))
    return f"hace {n} {singular if n == 1 else plural}"


_A_DIAS = {"DAYS": 1, "HOURS": 1 / 24, "MINUTES": 1 / 1440, "MONTHS": 30}


def _dias(fecha: dict | None) -> int | None:
    """Antiguedad en dias. Fotocasa la publica siempre, incluso 602."""
    if not fecha or fecha.get("diff") is None:
        return None
    factor = _A_DIAS.get(fecha.get("unit", "DAYS"))
    return None if factor is None else int(fecha["diff"] * factor)


def _feature(bruto: dict, clave: str):
    for f in bruto.get("features") or []:
        if f.get("key") == clave:
            return f.get("value")
    return None


def _a_anuncio(bruto: dict) -> Anuncio | None:
    id_portal = bruto.get("id")
    if not id_portal:
        return None
    detalle = bruto.get("detail") or {}
    ruta = detalle.get("es-ES") or next(iter(detalle.values()), "")
    if not ruta:
        return None

    dir_ = bruto.get("address") or {}
    coords = bruto.get("coordinates") or {}
    foto = ""
    for m in bruto.get("multimedia") or []:
        if m.get("type") == "image" and m.get("src"):
            foto = m["src"]
            break

    descripcion = (bruto.get("description") or "").strip()
    genero, confirmado = inferir_genero(descripcion)

    return Anuncio(
        portal="fotocasa",
        id_portal=str(id_portal),
        url=BASE + ruta if ruta.startswith("/") else ruta,
        titulo=dir_.get("upperLevel") or dir_.get("neighborhood") or "Habitación",
        precio=bruto.get("rawPrice") or None,
        direccion=dir_.get("upperLevel", "") or "",
        barrio=dir_.get("neighborhood") or dir_.get("district") or "",
        municipio=dir_.get("municipality", "") or "",
        lat=coords.get("latitude"),
        lon=coords.get("longitude"),
        # accuracy=False significa posicion del barrio, no del portal.
        coords_aproximadas=not bruto.get("accuracy", False),
        genero_piso=genero,
        genero_confirmado=confirmado,
        habitaciones=_feature(bruto, "rooms"),
        descripcion=descripcion,
        descripcion_extra=("Alquiler temporal según el portal"
                           if bruto.get("isTemporaryRental") else ""),
        foto=foto,
        publicado_texto=_antiguedad(bruto.get("date")),
        antiguedad_dias=_dias(bruto.get("date")),
    )


def parsear_listado(html: str) -> list[Anuncio]:
    brutos = extraer_json(html, "realEstates")
    if not brutos:
        return []
    return [a for a in (_a_anuncio(b) for b in brutos) if a]


class Fotocasa(Fuente):
    nombre = "fotocasa"

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
        time.sleep(3)
        for sel in ["#didomi-notice-agree-button", "button:has-text('Aceptar')"]:
            try:
                pg.click(sel, timeout=2000)
                break
            except Exception:
                pass
        html = pg.content()
        if len(html) < 20000:
            raise BloqueoAntiBot(f"respuesta corta en {url}")
        if self.cache_dir:
            import hashlib
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            nombre = re.sub(r"\W+", "_", url.replace(BASE, ""))[:70]
            firma = hashlib.sha1(url.encode()).hexdigest()[:8]
            (self.cache_dir / f"fotocasa_{nombre}_{firma}.html").write_text(
                html, encoding="utf-8")
        return html

    def buscar(self, cfg: dict, max_paginas: int = 3) -> list[Anuncio]:
        zonas = cfg.get("zonas_fotocasa") or ["barcelona-capital/todas-las-zonas"]
        # Con 8.000 anuncios, ordenar de mas barato a mas caro concentra en
        # las primeras paginas todo lo que cabe en el presupuesto.
        orden = cfg.get("busqueda", {}).get("orden_fotocasa", "baratos")
        techo = cfg.get("presupuesto", {}).get("coste_total_maximo", 650)

        resultados, vistos = [], set()
        for zona in zonas:
            for pagina in range(1, max_paginas + 1):
                try:
                    html = self.abrir(construir_url(zona, pagina, orden))
                except BloqueoAntiBot as e:
                    emit("warning", f"  fotocasa: {e}")
                    break
                except Exception as e:
                    if navegador.esta_muerto(e):
                        emit("warning", f"  se ha cerrado el navegador; me quedo con "
                              f"{len(resultados)} anuncios de fotocasa")
                        return resultados
                    emit("warning", f"  fotocasa {zona} p{pagina} ha fallado "
                          f"({str(e)[:55]}); sigo")
                    break
                lote = [a for a in parsear_listado(html) if a.id_portal not in vistos]
                vistos.update(a.id_portal for a in lote)
                resultados.extend(lote)
                emit("info", f"  fotocasa {zona.split('/')[0]} p{pagina}: {len(lote)} anuncios")
                if not lote:
                    break
                # Ordenado de barato a caro: en cuanto la pagina entera supera
                # el techo, las siguientes solo traen cosas mas caras.
                if orden == "baratos":
                    precios = [a.precio for a in lote if a.precio]
                    if precios and min(precios) > techo:
                        emit("info", f"     ya por encima de {techo} €, paso de zona")
                        break
                time.sleep(random.uniform(*self.pausa))
        return resultados

    def cerrar(self) -> None:
        navegador.cerrar_contexto(self._ctx)
        self._ctx = self._pagina = None
