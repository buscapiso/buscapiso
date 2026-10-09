"""Fuente Idealista: construccion de URL, parser de listado y navegador.

Tres decisiones tomadas tras probarlo contra el sitio real:

1. El navegador va SIEMPRE con ventana visible. Con headless=True, DataDome
   devuelve geo.captcha-delivery.com en lugar de los anuncios. Verificado:
   mismo perfil, misma IP, mismas cookies; la unica variable era headless.
2. El filtro "sexo_chica" significa "admite chicas", no "solo chicas". El
   filtro estricto se aplica en local sobre genero_piso.
3. Las paginas de listado NO traen coordenadas. La posicion sale de
   geocodificar la direccion del titulo.
"""
from __future__ import annotations

import hashlib
import pathlib
import random
import shutil
import re
import time

from bs4 import BeautifulSoup

from buscapiso import navegador, paths
from buscapiso.events import emit
from buscapiso.fuentes.base import BloqueoAntiBot, Fuente
from buscapiso.modelo import (DESCONOCIDO, GENERO_CHICAS, GENERO_CHICOS, GENERO_MIXTO,
                    Anuncio)

BASE = "https://www.idealista.com"
PERFIL = paths.browser_profile("chrome")

# Vocabulario real de filtros, extraido del propio HTML de idealista.
# El orden importa: idealista lo normaliza asi y cambiarlo provoca redirecciones.
FILTROS = [
    ("precio_max", lambda v: f"precio-hasta_{v}"),
    ("solo_chicas", lambda v: "sexo_chica" if v else None),
    ("sin_propietario", lambda v: "pisos-compartido-sin-propietario" if v else None),
    ("con_estudiantes", lambda v: "compartidos_con-estudiantes" if v else None),
    ("con_trabajadores", lambda v: "compartidos_con-trabajadores" if v else None),
    ("exterior", lambda v: "exterior" if v else None),
    ("sin_fumadores", lambda v: "fumadores_no" if v else None),
    ("publicado_48h", lambda v: "publicado_ultimas-48-horas" if v else None),
]

_PRECIO = re.compile(r"(\d[\d.]*)")
_GASTOS = re.compile(r"\+\s*(\d+)\s*€")
_HABS = re.compile(r"(\d+)\s*hab")
_COMPAS = re.compile(r"^(\d+)\s")


# Ordenaciones que acepta idealista. "lo mas nuevo primero" es la que
# importa cuando necesitas entrar ya: los anuncios buenos duran horas.
ORDENES = {
    "nuevos": "fecha-publicacion-desc",
    "baratos": "precios-asc",
    "relevancia": None,
}


def construir_url(municipio_slug: str, pagina: int = 1, orden: str = "relevancia",
                  **filtros) -> str:
    """URL de busqueda de habitaciones con los filtros nativos de idealista."""
    trozos = []
    for clave, fn in FILTROS:
        valor = filtros.get(clave)
        if valor:
            slug = fn(valor)
            if slug:
                trozos.append(slug)
    url = f"{BASE}/alquiler-habitacion/{municipio_slug}/"
    if trozos:
        url += "con-" + ",".join(trozos) + "/"
    if pagina > 1:
        url += f"pagina-{pagina}.htm"
    clave_orden = ORDENES.get(orden)
    if clave_orden:
        url += f"?ordenado-por={clave_orden}"
    return url


def _genero(articulo) -> tuple[str, bool]:
    """Genero del piso y si es dato publicado o no.

    Idealista lo marca con una clase en el icono de la tarjeta, asi que aqui
    es dato estructurado, no una inferencia sobre el texto: debe quedar como
    confirmado para que el informe no lo ponga en duda.
    """
    icono = articulo.select_one(".icon-sex-circle")
    if not icono:
        return DESCONOCIDO, False
    clases = icono.get("class", [])
    for clase, genero in (("girl", GENERO_CHICAS), ("boy", GENERO_CHICOS),
                          ("both", GENERO_MIXTO)):
        if clase in clases:
            return genero, True
    return DESCONOCIDO, False


def _partes_direccion(titulo: str) -> tuple[str, str, str]:
    """'Habitacion en Calle de Casp, 110, El Fort Pienc, Barcelona'
    -> ('Calle de Casp, 110', 'El Fort Pienc', 'Barcelona')"""
    cuerpo = re.sub(r"^\s*Habitaci[oó]n\s+en\s+", "", titulo).strip()
    partes = [p.strip() for p in cuerpo.split(",") if p.strip()]
    if len(partes) >= 3:
        return ", ".join(partes[:-2]), partes[-2], partes[-1]
    if len(partes) == 2:
        return "", partes[0], partes[1]
    return "", "", partes[0] if partes else ""


def parsear_listado(html: str) -> list[Anuncio]:
    """Extrae los anuncios de una pagina de resultados."""
    sopa = BeautifulSoup(html, "lxml")
    anuncios: list[Anuncio] = []

    for art in sopa.select("article.item"):
        id_portal = art.get("data-element-id")
        enlace = art.select_one("a.item-link")
        if not id_portal or not enlace:
            continue

        titulo = (enlace.get("title") or enlace.get_text(" ", strip=True)).strip()
        direccion, barrio, municipio = _partes_direccion(titulo)

        precio = None
        el_precio = art.select_one(".item-price")
        if el_precio:
            m = _PRECIO.search(el_precio.get_text(" ", strip=True).replace(".", ""))
            if m:
                precio = int(m.group(1))

        # Ausencia del texto de gastos = el anuncio no lo declara (None),
        # que no es lo mismo que "gastos incluidos" (0).
        gastos = None
        el_gastos = art.select_one(".item-price-extra-charges")
        if el_gastos:
            m = _GASTOS.search(el_gastos.get_text(" ", strip=True))
            if m:
                gastos = int(m.group(1))

        habitaciones = companeros = None
        fumar = None
        publicado = ""
        for det in art.select(".item-detail-char .item-detail"):
            txt = det.get_text(" ", strip=True).replace("\xa0", " ")
            if (m := _HABS.search(txt)):
                habitaciones = int(m.group(1))
            elif "chic" in txt:
                if (m := _COMPAS.search(txt)):
                    companeros = int(m.group(1))
            elif "fumar" in txt.lower():
                fumar = "no se puede" not in txt.lower()
            elif re.match(r"^\d{1,2}\s+\w{3}$", txt):
                publicado = txt

        genero, genero_confirmado = _genero(art)
        desc = art.select_one(".item-description")
        # No vale "figure.item-gallery img": segun el anuncio tenga video,
        # plano o galeria normal, la foto cuelga de sitios distintos. Lo
        # estable es que la imagen real vive en el CDN de fotos de idealista
        # (img*.idealista.com), y los iconos de interfaz en st3.idealista.com.
        img = next((i for i in art.select("img")
                    if "//img" in (i.get("src") or "")), None)

        anuncios.append(Anuncio(
            portal="idealista",
            id_portal=str(id_portal),
            url=BASE + enlace.get("href", ""),
            titulo=titulo,
            precio=precio,
            gastos_extra=gastos,
            direccion=direccion,
            barrio=barrio,
            municipio=municipio,
            genero_piso=genero,
            genero_confirmado=genero_confirmado,
            habitaciones=habitaciones,
            companeros=companeros,
            fumar_permitido=fumar,
            publicado_texto=publicado,
            descripcion=desc.get_text(" ", strip=True) if desc else "",
            foto=img.get("src", "") if img else "",
        ))
    return anuncios


# --- ficha de detalle ---------------------------------------------------
# Escrito contra el HTML real de una ficha, no contra lo que uno imagina que
# dira. Dos cosas que solo se descubren mirando:
#
#  1. Idealista NO tiene un campo "se permiten visitas". Sus "Normas de la
#     casa" son fumar, parejas, mascotas y menores. Lo mas cercano son
#     "No se admiten parejas" y la frase libre de "Ambiente de la casa".
#  2. El castellano inclusivo de idealista ("propietario/a", "companeros/as")
#     rompe cualquier regex con \w+, porque la barra corta la palabra.

_DUENO_NO_VIVE = re.compile(r"propietari\w*(?:/\w+)?\s+no\s+vive", re.I)
_DUENO_SI_VIVE = re.compile(r"propietari\w*(?:/\w+)?\s+(?:si\s+)?vive\s+en", re.I)
# Norma explicita, no costumbre: "no suelen tener visitas" describe un habito
# de la casa y va a `ambiente`, donde solo resta puntos. Confundir habito con
# norma haria que un filtro estricto tirase pisos que no prohiben nada.
_SIN_VISITAS = re.compile(r"no\s+se\s+(?:admiten|permiten)\s+visitas|"
                          r"prohibid\w+\s+(?:las\s+)?visitas", re.I)
# Solo normas explicitas, y nunca precedidas de "no": sin el lookbehind,
# "no suelen tener visitas" casaba como si las permitiera.
_CON_VISITAS = re.compile(r"(?<!no\s)se\s+(?:admiten|permiten)\s+visitas", re.I)
_EDAD = re.compile(r"[Ee]ntre\s+(\d{2})\s+y\s+(\d{2})\s+a[nñ]os")
_ESTANCIA = re.compile(r"[Ee]stancia\s+m[ií]nima\s+de\s+(\d+)\s+mes", re.I)
_DISPONIBLE = re.compile(r"[Dd]isponible\s+a\s+partir\s+de\s+(\d{2}-\d{2}-\d{4})")


def _seccion(sopa, titulo: str) -> list[str]:
    """Items de una seccion de la ficha ('Normas de la casa', etc.)."""
    for h in sopa.select("h2, h3"):
        if h.get_text(strip=True).lower().startswith(titulo.lower()):
            sig = h.find_next_sibling()
            if sig:
                return [x.strip() for x in sig.get_text("|", strip=True).split("|")
                        if x.strip()]
    return []


def parsear_ficha(html: str) -> dict:
    """Campos que solo estan en la ficha.

    Devuelve solo lo que encuentra: lo que no aparezca se queda sin tocar en
    el anuncio, en vez de sobrescribirse con un valor inventado.
    """
    sopa = BeautifulSoup(html, "lxml")
    texto = sopa.get_text(" ", strip=True)
    datos: dict = {"ficha_leida": True}

    companeros = _seccion(sopa, "Tus compa")
    normas = _seccion(sopa, "Normas de la casa")
    habitacion = _seccion(sopa, "Caracter") + _seccion(sopa, "Est")
    todo = " ".join(companeros + normas + habitacion) + " " + texto

    if _DUENO_NO_VIVE.search(todo):
        datos["propietario_vive"] = False
    elif _DUENO_SI_VIVE.search(todo):
        datos["propietario_vive"] = True

    # "Visitas" no es un campo de idealista: esto es la mejor senal disponible.
    if _SIN_VISITAS.search(todo):
        datos["visitas_permitidas"] = False
    elif _CON_VISITAS.search(todo):
        datos["visitas_permitidas"] = True

    if normas:
        datos["admite_parejas"] = not any("no se admiten parejas" in n.lower()
                                          for n in normas)
        if any("no se puede fumar" in n.lower() for n in normas):
            datos["fumar_permitido"] = False

    for item in companeros:
        if (m := _EDAD.search(item)):
            datos["edad_companeros"] = f"{m.group(1)}-{m.group(2)}"
        elif "estudian" in item.lower() or "trabajan" in item.lower():
            datos["ocupacion_companeros"] = item
        elif item.lower().startswith("ambiente"):
            datos["ambiente"] = item

    if any("ventana a la calle" in x.lower() or "exterior" in x.lower()
           for x in habitacion):
        datos["exterior"] = True

    if (m := _ESTANCIA.search(todo)):
        datos["estancia_minima_meses"] = int(m.group(1))
    if (m := _DISPONIBLE.search(todo)):
        datos["disponible_desde"] = m.group(1)

    # En orden de preferencia, no como un selector combinado: ".comment,
    # .detail-info" devuelve el primero que aparece en el documento, y
    # .detail-info es la cabecera de navegacion ("6 fotos Mapa Alquiler...").
    for sel in (".adCommentsLanguage", ".comment"):
        cuerpo = sopa.select_one(sel)
        if cuerpo:
            texto = cuerpo.get_text(" ", strip=True)
            if len(texto) > 40:
                datos["descripcion"] = texto
                break
    return datos


# --- navegador ----------------------------------------------------------
class Idealista(Fuente):
    nombre = "idealista"

    def __init__(self, cache_dir: pathlib.Path | None = None, pausa=(3.0, 8.0)):
        self.cache_dir = cache_dir
        self.pausa = pausa
        self._pw = None
        self._ctx = None
        self._pagina = None

    def _navegador(self):
        if self._pagina is not None:
            return self._pagina
        # headless=False no es negociable: ver docstring del modulo. Lo fija
        # navegador.contexto() igual para las tres fuentes.
        self._ctx = navegador.contexto(PERFIL)
        self._pagina = self._ctx.pages[0] if self._ctx.pages else self._ctx.new_page()
        return self._pagina

    def _dormir(self) -> None:
        time.sleep(random.uniform(*self.pausa))

    def _aceptar_cookies(self) -> None:
        for sel in ["#didomi-notice-agree-button", "button:has-text('Aceptar')"]:
            try:
                self._pagina.click(sel, timeout=2500)
                return
            except Exception:
                pass

    def _bloqueado(self, html: str) -> bool:
        return "geo.captcha-delivery.com" in html or len(html) < 5000

    def _tirar_perfil(self) -> None:
        """Descarta la identidad quemada.

        Probado contra el sitio real: cuando DataDome te marca, la cookie del
        perfil lleva esa marca en cada peticion posterior, asi que esperar no
        sirve de nada y borrar el perfil sirve al instante.
        """
        self.cerrar()
        if PERFIL.exists():
            shutil.rmtree(PERFIL, ignore_errors=True)

    def abrir(self, url: str, reintentos: int = 1) -> str:
        """Carga una URL y devuelve su HTML. Lanza BloqueoAntiBot si hay captcha.

        Recuperacion en tres escalones, de mas barato a mas caro:
        reintentar -> tirar el perfil quemado -> pedir ayuda humana.
        """
        pg = self._navegador()
        try:
            pg.goto(url, wait_until="domcontentloaded", timeout=60000)
        except Exception as e:
            if not navegador.esta_muerto(e) or reintentos <= 0:
                raise
            # La ventana es visible por obligacion, asi que cerrarla a mano o
            # una caida de Chromium son accidentes esperables: se levanta otra.
            emit("warning", "\n  !! The browser window was closed. Opening another one...\n")
            navegador.cerrar_contexto(self._ctx)
            self._ctx = self._pagina = None
            pg = self._navegador()
            pg.goto(url, wait_until="domcontentloaded", timeout=60000)
        time.sleep(2.5)
        self._aceptar_cookies()
        html = pg.content()

        if self._bloqueado(html) and reintentos > 0:
            emit("warning", "\n  !! Blocked by the anti-bot check. Starting again with a clean profile...")
            self._tirar_perfil()
            pg = self._navegador()
            time.sleep(4)
            pg.goto(url, wait_until="domcontentloaded", timeout=60000)
            time.sleep(3)
            self._aceptar_cookies()
            html = pg.content()

        if self._bloqueado(html):
            # Ni reintento en bucle ni me rindo: aviso y doy tiempo a que
            # la persona resuelva el captcha en la ventana que ya esta abierta.
            emit("captcha", "\n  !! Still blocked. Solve the captcha in the open browser\n"
                            "     window; waiting 90 seconds.\n",
                 portal="idealista", wait_seconds=90)
            time.sleep(90)
            pg.goto(url, wait_until="domcontentloaded", timeout=60000)
            time.sleep(2.5)
            html = pg.content()
            if self._bloqueado(html):
                raise BloqueoAntiBot(f"captcha en {url}")
        if self.cache_dir:
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            # Recortar por el final perdia el municipio: "cornella-de-llobregat"
            # y "esplugues-de-llobregat" acababan en el mismo fichero. El hash
            # de la URL completa garantiza que cada pagina tiene el suyo.
            legible = re.sub(r"\W+", "_", url.replace(BASE, ""))[:80]
            firma = hashlib.sha1(url.encode()).hexdigest()[:8]
            (self.cache_dir / f"{legible}_{firma}.html").write_text(
                html, encoding="utf-8")
        return html

    def buscar(self, cfg: dict, max_paginas: int = 3) -> list[Anuncio]:
        """Rastrea las zonas de cfg["municipios"].

        Devuelve SIEMPRE lo recogido hasta el momento. Un fallo en la zona N
        no invalida las zonas 1..N-1: cuando la ventana murio a mitad, la
        excepcion se llevaba por delante 79 anuncios ya rastreados y el
        informe salia sin un solo anuncio de idealista.
        """
        filtros = cfg.get("filtros_idealista", {})
        orden = cfg.get("busqueda", {}).get("orden", "relevancia")
        resultados: list[Anuncio] = []
        vistos: set[str] = set()
        for slug in cfg["municipios"]:
            for pagina in range(1, max_paginas + 1):
                url = construir_url(slug, pagina=pagina, orden=orden, **filtros)
                try:
                    html = self.abrir(url)
                except BloqueoAntiBot as e:
                    emit("warning", f"  blocked, stopping idealista: {e}")
                    return resultados
                except Exception as e:
                    if navegador.esta_muerto(e):
                        # Sin navegador no hay nada que reintentar.
                        emit("warning", f"  the browser was closed; keeping "
                              f"{len(resultados)} idealista listings")
                        return resultados
                    emit("warning", f"  {slug} page {pagina} failed ({str(e)[:60]}); going on")
                    break
                lote = parsear_listado(html)
                nuevos = [a for a in lote if a.id_portal not in vistos]
                vistos.update(a.id_portal for a in nuevos)
                resultados.extend(nuevos)
                emit("info", f"  {slug} page {pagina}: {len(nuevos)} listings")
                if len(lote) < 25:      # ultima pagina
                    break
                self._dormir()
            self._dormir()
        return resultados

    def enriquecer(self, anuncios: list[Anuncio], maximo: int = 15) -> None:
        """Abre la ficha de los mejores candidatos. Caro: solo el top N."""
        for a in anuncios[:maximo]:
            try:
                html = self.abrir(a.url, reintentos=1)
            except BloqueoAntiBot:
                emit("warning", "  blocked while reading full listings; keeping what we have")
                return
            for k, v in parsear_ficha(html).items():
                setattr(a, k, v)
            self._dormir()

    def cerrar(self) -> None:
        # Solo cierra SU contexto: Playwright es compartido y lo para
        # navegador.cerrar_todo() al terminar la busqueda.
        navegador.cerrar_contexto(self._ctx)
        self._ctx = self._pagina = None
