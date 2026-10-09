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
from buscapiso.modelo import GENERO_CHICAS, TIPO_HABITACION, TIPO_PISO
from buscapiso.ranking import filtrar, ordenar
from buscapiso.transporte import Red
from buscapiso.travel import TravelError, graph_trip
from buscapiso.ai.extract import apply_facts, extract_facts
from buscapiso.ai.providers import AIError, estimate_cost


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
               con: sqlite3.Connection, provider=None, ai=None) -> SearchResult:
    cfg = copy.deepcopy(cfg)
    cfg["filtros_idealista"] = idealista_filters(cfg)
    geo = Geocodificador(con, offline=options.offline)
    red = Red.cargar()
    paginas = options.pages or cfg["busqueda"]["max_paginas_por_municipio"]
    cfg["destinos"] = _avisar_inalcanzables(cfg.get("destinos", []), red)
    _elegir_zonas(cfg, red, options)

    from buscapiso.fuentes.idealista import Idealista
    idealista = Idealista(cache_dir=paths.cache_dir())

    if options.from_cache:
        _stage(1, "Re-reading the pages already downloaded (no browsing)...")
        tipo = cfg.get("tipo", TIPO_HABITACION)
        # La cache guarda paginas de habitaciones y de pisos: solo cuentan
        # las del tipo que se busca.
        anuncios = [a for a in _leer_cache(paths.cache_dir()) if a.tipo == tipo]
        brutos = len(anuncios)
        anuncios, fusionados = deduplicar(anuncios)
        emit("info", f"    {brutos} listings from the saved pages"
                     f"{f', {fusionados} duplicates merged' if fusionados else ''}\n")
    else:
        anuncios = _rastrear(cfg, idealista, paginas)
        if not anuncios:
            emit("warning", "Nothing could be read from the portals. Try again in a few "
                            "minutes: they block for a while after many requests "
                            "in a row.")
            idealista.cerrar()
            return SearchResult()
    return _procesar(anuncios, cfg, zonas, con, geo, red, options, idealista, provider, ai)


def idealista_filters(cfg: dict) -> dict:
    """Filtros de URL de idealista. El de genero sale de requisitos.genero:
    idealista solo tiene "admite chicas", asi que para otro genero no se
    filtra por URL y el filtro estricto lo hace ranking.filtrar."""
    filtros = dict(cfg.get("filtros_idealista", {}))
    filtros["solo_chicas"] = cfg["requisitos"].get("genero") == GENERO_CHICAS
    return filtros


def _avisar_inalcanzables(destinos: list[dict], red: Red) -> list[dict]:
    """Avisa de los destinos sin estacion andable, antes de rastrear nada.

    Desde ellos no hay ruta en tren, asi que su limite de tiempo no puede
    elegir zonas: con el, ninguna zona entraria y la busqueda se quedaria
    vacia sin decir por que. Se conservan para puntuar y para el filtro
    (solo pasan los pisos desde los que se llega andando), pero se marcan
    para que la cobertura no los use.
    """
    salida = []
    for d in destinos:
        # A pie y en bici siempre se llega; solo el tren necesita estacion.
        if d.get("modo", "transporte") != "transporte" or red.estaciones_cercanas(d["lat"], d["lon"]):
            salida.append(d)
            continue
        emit("warning", f"{d['nombre']} has no station within walking distance: only "
                        "rooms within walking distance will count, and it is not "
                        "used to choose areas", destination=d["nombre"])
        salida.append({**d, "fuera_de_red": True})
    return salida


def _elegir_zonas(cfg: dict, red: Red, options: SearchOptions) -> None:
    """Las zonas salen de los limites de tiempo, no de una lista fija."""
    if options.municipalities:
        cfg["municipios"] = list(options.municipalities)
        return
    catalogo = Catalogo.cargar()
    seleccion = catalogo.seleccionar(
        [d for d in cfg.get("destinos", []) if not d.get("fuera_de_red")], red)
    cfg["municipios"] = catalogo.slugs(seleccion, "idealista")
    cfg["zonas_fotocasa"] = catalogo.slugs(seleccion, "fotocasa")
    cfg["zonas_habitaclia"] = catalogo.slugs(seleccion, "habitaclia")
    emit("info", f"Areas to search: {len(seleccion)}",
         zones=[z["nombre"] for z in seleccion])
    emit("info", "   " + ", ".join(
        z["nombre"].split(",")[0]
        + (f" ({z['minutos']:.0f})" if z["minutos"] is not None else "")
        for z in seleccion) + "\n")


def compute_routes(anuncios: list, destinos: list[dict], red: Red) -> None:
    """Rellena anuncio.trayectos y anuncio.rutas para cada destino."""
    for a in anuncios:
        if a.lat is None:
            continue
        for d in destinos:
            t = graph_trip(red, a.lat, a.lon, d)
            if t is not None:
                a.trayectos[d["nombre"]] = t.minutes
                a.rutas[d["nombre"]] = t.detail


def refine_routes(anuncios: list, destinos: list[dict], provider, limit: int) -> int:
    """Sustituye los tiempos del grafo por los del proveedor en los `limit`
    primeros anuncios con coordenadas."""
    elegidos = [a for a in anuncios if a.lat is not None][:limit]
    if not elegidos or not destinos:
        return 0
    origenes = [(a.lat, a.lon) for a in elegidos]
    completos = {a.id: True for a in elegidos}
    for d in destinos:
        for a, t in zip(elegidos, provider.trips(origenes, d)):
            if t is None:
                completos[a.id] = False
                continue
            a.trayectos[d["nombre"]] = t.minutes
            a.rutas[d["nombre"]] = t.detail
    for a in elegidos:
        a.trayectos_fuente = provider.name if completos[a.id] else "graph"
    return len(elegidos)


def enrich_with_ai(anuncios: list, ai, con, limit: int) -> int:
    """La IA lee los `limit` primeros. Un fallo suelto se salta; si fallan todos,
    AIError, para que la busqueda avise y siga sin IA."""
    elegidos = anuncios[:limit]
    leidos, ultimo = 0, None
    for a in elegidos:
        try:
            apply_facts(a, extract_facts(ai, a, con))
            leidos += 1
        except AIError as e:
            ultimo = e
    if elegidos and not leidos:
        raise ultimo
    return leidos


def _clasificar(anuncios, cfg, zonas, con):
    ok, posibles, fuera = filtrar(anuncios, cfg, zonas, almacen.descartados(con))
    ok = ordenar(ok, cfg, zonas)
    posibles = ordenar(posibles, cfg, zonas)
    minimo = cfg["requisitos"].get("puntos_minimos_para_preguntar", 60)
    flojos = [p for p in posibles if p.puntuacion < minimo]
    posibles = [p for p in posibles if p.puntuacion >= minimo]
    fuera.extend((p, "genero sin confirmar y puntuacion baja") for p in flojos)
    return ok, posibles, fuera


def _leer_cache(carpeta: pathlib.Path) -> list:
    # Cada fichero se parsea con el parser de SU portal: usar el de
    # idealista con todos devolvia cero para roomgo y depisoenpiso.
    from buscapiso.fuentes.depisoenpiso import parsear_listado as parsear_dpp
    from buscapiso.fuentes.fotocasa import parsear_listado as parsear_fotocasa
    from buscapiso.fuentes.idealista import parsear_listado as parsear_idealista
    from buscapiso.fuentes.habitaclia import parsear_listado as parsear_habitaclia
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
        elif nombre.startswith("habitaclia_"):
            parser = parsear_habitaclia
        else:
            parser = parsear_idealista
        for a in parser(f.read_text(encoding="utf-8")):
            clave = (a.portal, a.id_portal)
            if clave not in vistos:
                vistos.add(clave)
                anuncios.append(a)
    return anuncios


# Portales que publican cada tipo. Idealista tiene pisos enteros, pero sin
# navegador responde con captcha: falta capturar una pagina real.
PORTALES = {TIPO_HABITACION: ("idealista", "fotocasa", "roomgo", "depisoenpiso"),
            TIPO_PISO: ("fotocasa", "habitaclia")}
# Los que necesitan la ventana de Chromium.
_CON_NAVEGADOR = {TIPO_HABITACION: {"idealista", "fotocasa", "roomgo", "depisoenpiso"},
                  TIPO_PISO: set()}


def _crear_fuente(nombre: str, tipo: str = TIPO_HABITACION):
    if nombre == "habitaclia":
        from buscapiso.fuentes.habitaclia import Habitaclia
        return Habitaclia(cache_dir=paths.cache_dir())
    if nombre == "roomgo":
        from buscapiso.fuentes.roomgo import Roomgo
        return Roomgo(cache_dir=paths.cache_dir())
    if nombre == "depisoenpiso":
        from buscapiso.fuentes.depisoenpiso import DePisoEnPiso
        return DePisoEnPiso(cache_dir=paths.cache_dir())
    if nombre == "fotocasa":
        from buscapiso.fuentes.fotocasa import Fotocasa
        return Fotocasa(cache_dir=paths.cache_dir(), tipo=tipo)
    return None


def _rastrear(cfg: dict, idealista, paginas: int) -> list:
    tipo = cfg.get("tipo", TIPO_HABITACION)
    activas = []
    for nombre in cfg.get("fuentes", ["idealista"]):
        if nombre in PORTALES[tipo]:
            activas.append(nombre)
        else:
            emit("warning", f"  {nombre} is not searched for "
                            f"{'whole flats' if tipo == TIPO_PISO else 'rooms'}; skipping it")
    que = "whole flats" if tipo == TIPO_PISO else "rooms"
    _stage(1, f"Searching {', '.join(activas) or 'nothing'} for {que}...")
    if _CON_NAVEGADOR[tipo] & set(activas):
        emit("info", "    A Chromium window will open: leave it visible, that is what\n"
                     "    keeps the portals from blocking. Solve any captcha it shows.\n")
    anuncios: list = []
    otras: list = []
    for nombre in activas:
        f = idealista if nombre == "idealista" else _crear_fuente(nombre, tipo)
        if f is None:
            emit("warning", f"  {nombre}: unknown portal, skipping it")
            continue
        if f is not idealista:
            otras.append(f)
        try:
            anuncios.extend(f.buscar(cfg, max_paginas=paginas))
        except KeyboardInterrupt:
            break
        except Exception as e:
            # Que un portal falle no debe tumbar la busqueda entera.
            emit("warning", f"  {nombre} failed ({str(e)[:70]}); going on with the rest",
                 source=nombre)
    for f in otras:
        f.cerrar()

    brutos = len(anuncios)
    anuncios, fusionados = deduplicar(anuncios)
    if fusionados:
        emit("info", f"    {brutos} listings, {fusionados} were the same {que[:-1]} on "
                     f"two portals -> {len(anuncios)}\n")
    else:
        emit("info", f"    {len(anuncios)} listings found\n")
    return anuncios


def _procesar(anuncios, cfg, zonas, con, geo, red, options, idealista,
              provider=None, ai=None) -> SearchResult:
    _stage(2, "Placing them on the map (Nominatim, 1 request a second)...")
    ya_situados = sum(1 for a in anuncios if a.lat is not None)
    if ya_situados:
        emit("info", f"    {ya_situados} already have coordinates from the portal")
    for i, a in enumerate(anuncios, 1):
        if a.lat is None:
            geo.situar(a)
        if i % 25 == 0:
            emit("progress", f"    {i}/{len(anuncios)}", done=i, total=len(anuncios))
    sin_sitio = sum(1 for a in anuncios if a.lat is None)
    emit("info", f"    {len(anuncios) - sin_sitio} placed, {sin_sitio} without a location\n")

    _stage(3, "Calculating travel times...")
    compute_routes(anuncios, cfg.get("destinos", []), red)

    ok, posibles, fuera = _clasificar(anuncios, cfg, zonas, con)
    limite = cfg["busqueda"].get("trayectos_reales", 40)
    if provider is not None and limite:
        candidatos = sorted(ok + posibles, key=lambda a: a.puntuacion, reverse=True)
        try:
            n = refine_routes(candidatos, cfg.get("destinos", []), provider, limite)
            emit("info", f"    Real timetables ({provider.name}) for {n} listings")
            ok, posibles, fuera2 = _clasificar(ok + posibles, cfg, zonas, con)
            fuera.extend(fuera2)
        except TravelError as e:
            emit("warning", f"    {provider.name} did not answer ({e}); "
                            "using the estimated times", provider=provider.name)
    limite_ia = cfg["busqueda"].get("anuncios_ia", 30)
    if ai is not None and limite_ia:
        candidatos = sorted(ok + posibles, key=lambda a: a.puntuacion, reverse=True)
        try:
            n = enrich_with_ai(candidatos, ai, con, limite_ia)
            coste = estimate_cost(ai.model, ai.usage)
            emit("info", f"    AI: read {n} listings, {ai.usage.input_tokens + ai.usage.output_tokens} "
                         f"tokens" + (f", ~${coste:.2f}" if coste is not None else ""),
                 calls=ai.usage.calls, cost=coste)
            ok, posibles, fuera2 = _clasificar(ok + posibles, cfg, zonas, con)
            fuera.extend(fuera2)
        except AIError as e:
            emit("warning", f"    The AI did not answer ({e}); going on without it")
    emit("info", f"    {len(ok)} fit all your criteria, "
                 f"{len(posibles)} to ask about, "
                 f"{len(fuera)} left out\n")

    fichas = 0
    de_idealista = [a for a in ok if a.portal == "idealista"]
    tope = min(cfg["busqueda"]["fichas_a_enriquecer"], len(de_idealista))
    if tope and not options.skip_details and not options.from_cache:
        _stage(4, f"Reading the {tope} best full listings (guests, owner)...")
        idealista.enriquecer(de_idealista, maximo=tope)
        fichas = sum(1 for a in ok if a.ficha_leida)
        ok, _, fuera2 = filtrar(ok, cfg, zonas, almacen.descartados(con))
        fuera.extend(fuera2)
        ok = ordenar(ok, cfg, zonas)
        emit("info", f"    {fichas} full listings read, {len(ok)} left\n")
    else:
        _stage(4, "Full listings skipped\n")
    idealista.cerrar()
    navegador.cerrar_todo()

    _stage(5, "Saving...")
    nuevos = almacen.registrar(con, ok) + almacen.registrar(con, posibles,
                                                            grupo="possible")
    return SearchResult(accepted=ok, possible=posibles, rejected=fuera,
                        new_ids={a.id for a in nuevos}, crawled=len(anuncios),
                        details_read=fichas,
                        portals=len({a.portal for a in anuncios}))
