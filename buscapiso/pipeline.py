"""La busqueda de principio a fin: rastrear, situar, calcular trayectos,
filtrar, puntuar y guardar.

Aqui no hay print ni argparse. El progreso sale por events.emit y el
resultado vuelve como SearchResult a quien llame: hoy el CLI, en la fase 1
la API web.
"""
from __future__ import annotations

import copy
import pathlib
import sqlite3
from dataclasses import dataclass, field

from buscapiso import almacen, navegador, paths
from buscapiso.cobertura import Catalogo
from buscapiso.deduplicar import deduplicar
from buscapiso.events import emit
from buscapiso.geocodificador import Geocodificador
from buscapiso.ranking import filtrar, ordenar
from buscapiso.transporte import Red


@dataclass
class SearchOptions:
    pages: int | None = None
    skip_details: bool = False
    from_cache: bool = False
    offline: bool = False
    municipalities: list[str] | None = None


@dataclass
class SearchResult:
    accepted: list = field(default_factory=list)
    possible: list = field(default_factory=list)
    rejected: list = field(default_factory=list)     # [(anuncio, motivo)]
    new_ids: set = field(default_factory=set)
    crawled: int = 0
    details_read: int = 0
    portals: int = 0


def _stage(step: int, message: str) -> None:
    emit("stage", f"{step}/5 {message}", step=step, total=5)


def run_search(cfg: dict, zonas: dict, options: SearchOptions,
               con: sqlite3.Connection) -> SearchResult:
    cfg = copy.deepcopy(cfg)
    geo = Geocodificador(con, offline=options.offline)
    red = Red.cargar()
    paginas = options.pages or cfg["busqueda"]["max_paginas_por_municipio"]
    _elegir_zonas(cfg, red, options)

    from buscapiso.fuentes.idealista import Idealista
    idealista = Idealista(cache_dir=paths.cache_dir())

    if options.from_cache:
        _stage(1, "Releyendo el HTML ya descargado (sin tocar los portales)...")
        anuncios = _leer_cache(paths.cache_dir())
        brutos = len(anuncios)
        anuncios, fusionados = deduplicar(anuncios)
        emit("info", f"    {brutos} anuncios recuperados de cache"
                     f"{f', {fusionados} duplicados fusionados' if fusionados else ''}\n")
    else:
        anuncios = _rastrear(cfg, idealista, paginas)
        if not anuncios:
            emit("warning", "No se ha podido rastrear nada. Prueba de nuevo en unos "
                            "minutos: los portales bloquean temporalmente tras varias "
                            "peticiones seguidas.")
            idealista.cerrar()
            return SearchResult()
    return _procesar(anuncios, cfg, zonas, con, geo, red, options, idealista)


def _elegir_zonas(cfg: dict, red: Red, options: SearchOptions) -> None:
    """Las zonas salen de los limites de tiempo, no de una lista fija."""
    if options.municipalities:
        cfg["municipios"] = list(options.municipalities)
        return
    catalogo = Catalogo.cargar()
    seleccion = catalogo.seleccionar(cfg.get("destinos", []), red)
    cfg["municipios"] = catalogo.slugs(seleccion, "idealista")
    cfg["zonas_fotocasa"] = catalogo.slugs(seleccion, "fotocasa")
    emit("info", f"Zonas a rastrear: {len(seleccion)}",
         zones=[z["nombre"] for z in seleccion])
    emit("info", "   " + ", ".join(
        z["nombre"].split(",")[0]
        + (f" ({z['minutos']:.0f})" if z["minutos"] is not None else "")
        for z in seleccion) + "\n")


def compute_routes(anuncios: list, destinos: list[dict], red: Red) -> None:
    """Rellena anuncio.trayectos y anuncio.rutas para cada destino."""
    for d in destinos:
        if not red.estaciones_cercanas(d["lat"], d["lon"]):
            emit("warning", f"    {d['nombre']} no tiene ninguna estacion a distancia "
                            "andable: solo contaran los pisos desde los que se "
                            "llega andando", destination=d["nombre"])
    for a in anuncios:
        if a.lat is None:
            continue
        for d in destinos:
            r = red.ruta_a_punto(a.lat, a.lon, d["lat"], d["lon"])
            if r is not None:
                a.trayectos[d["nombre"]] = r.minutos
                a.rutas[d["nombre"]] = r.detalle


def _leer_cache(carpeta: pathlib.Path) -> list:
    # Cada fichero se parsea con el parser de SU portal: usar el de
    # idealista con todos devolvia cero para roomgo y depisoenpiso.
    from buscapiso.fuentes.depisoenpiso import parsear_listado as parsear_dpp
    from buscapiso.fuentes.fotocasa import parsear_listado as parsear_fotocasa
    from buscapiso.fuentes.idealista import parsear_listado as parsear_idealista
    from buscapiso.fuentes.roomgo import parsear_listado as parsear_roomgo
    anuncios, vistos = [], set()
    for f in sorted(carpeta.glob("*.html")):
        nombre = f.name
        if nombre.startswith("roomgo_"):
            parser = parsear_roomgo
        elif nombre.startswith("dpp_"):
            parser = parsear_dpp
        elif nombre.startswith("fotocasa_"):
            parser = parsear_fotocasa
        else:
            parser = parsear_idealista
        for a in parser(f.read_text(encoding="utf-8")):
            clave = (a.portal, a.id_portal)
            if clave not in vistos:
                vistos.add(clave)
                anuncios.append(a)
    return anuncios


def _crear_fuente(nombre: str):
    if nombre == "roomgo":
        from buscapiso.fuentes.roomgo import Roomgo
        return Roomgo(cache_dir=paths.cache_dir())
    if nombre == "depisoenpiso":
        from buscapiso.fuentes.depisoenpiso import DePisoEnPiso
        return DePisoEnPiso(cache_dir=paths.cache_dir())
    if nombre == "fotocasa":
        from buscapiso.fuentes.fotocasa import Fotocasa
        return Fotocasa(cache_dir=paths.cache_dir())
    return None


def _rastrear(cfg: dict, idealista, paginas: int) -> list:
    activas = cfg.get("fuentes", ["idealista"])
    _stage(1, f"Rastreando {', '.join(activas)}...")
    emit("info", "    Se abrira una ventana de Chromium: dejala visible, es lo que\n"
                 "    evita el bloqueo anti-bot. Si sale un captcha, resuelvelo.\n")
    anuncios: list = []
    otras: list = []
    for nombre in activas:
        f = idealista if nombre == "idealista" else _crear_fuente(nombre)
        if f is None:
            emit("warning", f"  {nombre}: fuente desconocida, la salto")
            continue
        if f is not idealista:
            otras.append(f)
        try:
            anuncios.extend(f.buscar(cfg, max_paginas=paginas))
        except KeyboardInterrupt:
            break
        except Exception as e:
            # Que un portal falle no debe tumbar la busqueda entera.
            emit("warning", f"  {nombre} ha fallado ({str(e)[:70]}); sigo con el resto",
                 source=nombre)
    for f in otras:
        f.cerrar()

    brutos = len(anuncios)
    anuncios, fusionados = deduplicar(anuncios)
    if fusionados:
        emit("info", f"    {brutos} anuncios, {fusionados} eran el mismo piso en "
                     f"dos portales -> {len(anuncios)}\n")
    else:
        emit("info", f"    {len(anuncios)} anuncios rastreados\n")
    return anuncios


def _procesar(anuncios, cfg, zonas, con, geo, red, options, idealista) -> SearchResult:
    _stage(2, "Situando en el mapa (Nominatim, 1 consulta/segundo)...")
    ya_situados = sum(1 for a in anuncios if a.lat is not None)
    if ya_situados:
        emit("info", f"    {ya_situados} ya traen coordenadas del portal")
    for i, a in enumerate(anuncios, 1):
        if a.lat is None:
            geo.situar(a)
        if i % 25 == 0:
            emit("progress", f"    {i}/{len(anuncios)}", done=i, total=len(anuncios))
    sin_sitio = sum(1 for a in anuncios if a.lat is None)
    emit("info", f"    {len(anuncios) - sin_sitio} situados, {sin_sitio} sin ubicacion\n")

    _stage(3, "Calculando trayectos...")
    compute_routes(anuncios, cfg.get("destinos", []), red)

    ok, posibles, fuera = filtrar(anuncios, cfg, zonas, almacen.descartados(con))
    ok = ordenar(ok, cfg, zonas)
    posibles = ordenar(posibles, cfg, zonas)
    minimo = cfg["requisitos"].get("puntos_minimos_para_preguntar", 60)
    flojos = [p for p in posibles if p.puntuacion < minimo]
    posibles = [p for p in posibles if p.puntuacion >= minimo]
    fuera.extend((p, "genero sin confirmar y puntuacion baja") for p in flojos)
    emit("info", f"    {len(ok)} cumplen todos tus requisitos, "
                 f"{len(posibles)} posibles sin confirmar genero, "
                 f"{len(fuera)} descartados\n")

    fichas = 0
    if ok and not options.skip_details and not options.from_cache:
        de_idealista = [a for a in ok if a.portal == "idealista"]
        tope = min(cfg["busqueda"]["fichas_a_enriquecer"], len(de_idealista))
        _stage(4, f"Leyendo las {tope} mejores fichas (visitas, propietario)...")
        idealista.enriquecer(de_idealista, maximo=tope)
        fichas = sum(1 for a in ok if a.ficha_leida)
        ok, _, fuera2 = filtrar(ok, cfg, zonas, almacen.descartados(con))
        fuera.extend(fuera2)
        ok = ordenar(ok, cfg, zonas)
        emit("info", f"    {fichas} fichas leidas, quedan {len(ok)}\n")
    else:
        _stage(4, "Fichas omitidas\n")
    idealista.cerrar()
    navegador.cerrar_todo()

    _stage(5, "Guardando...")
    nuevos = almacen.registrar(con, ok + posibles)
    return SearchResult(accepted=ok, possible=posibles, rejected=fuera,
                        new_ids={a.id for a in nuevos}, crawled=len(anuncios),
                        details_read=fichas,
                        portals=len({a.portal for a in anuncios}))
