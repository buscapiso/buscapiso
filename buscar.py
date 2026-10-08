#!/usr/bin/env python3
"""Buscador de habitacion en Barcelona.

    python buscar.py                      busca, puntua y genera el informe
    python buscar.py --paginas 5          mas paginas por municipio
    python buscar.py --sin-fichas         no abre fichas (mas rapido, menos datos)
    python buscar.py --solo-nuevos        solo lo publicado en las ultimas 48 h
    python buscar.py marcar <id> visita   cambia el estado de un anuncio
    python buscar.py estados              lista lo que has marcado
"""
from __future__ import annotations

import argparse
import pathlib
import sys
import webbrowser

import yaml

import almacen
import informe
import navegador
from cobertura import Catalogo
from deduplicar import deduplicar
from geocodificador import Geocodificador
from ranking import filtrar, ordenar
from transporte import Red

AQUI = pathlib.Path(__file__).resolve().parent
BD = AQUI / "pisos.db"


def cargar_cfg():
    cfg = yaml.safe_load((AQUI / "config.yaml").read_text(encoding="utf-8"))
    zonas = yaml.safe_load((AQUI / "zonas.yaml").read_text(encoding="utf-8")) or {}
    return cfg, zonas


def cmd_buscar(args) -> int:
    cfg, zonas = cargar_cfg()
    if args.solo_nuevos:
        cfg["filtros_idealista"]["publicado_48h"] = True
    if args.max_minutos:
        cfg["transporte"]["max_minutos_principal"] = args.max_minutos
    if args.presupuesto:
        cfg["presupuesto"]["coste_total_maximo"] = args.presupuesto
    if args.fuentes:
        cfg["fuentes"] = args.fuentes
    paginas = args.paginas or cfg["busqueda"]["max_paginas_por_municipio"]

    con = almacen.abrir(BD)
    geo = Geocodificador(con, offline=args.offline)
    red = Red.cargar()

    # Las zonas salen del limite de tiempo, no de una lista fija.
    tope = cfg["transporte"]["max_minutos_principal"]
    destino = cfg["transporte"]["destino_principal"]
    if args.municipios:
        seleccion = None
        cfg["municipios"] = args.municipios
    else:
        catalogo = Catalogo.cargar()
        seleccion = catalogo.seleccionar(tope, red, destino)
        cfg["municipios"] = catalogo.slugs(seleccion, "idealista")
        cfg["zonas_fotocasa"] = catalogo.slugs(seleccion, "fotocasa")
        print(f"Zonas a menos de {tope} min de {destino}: {len(seleccion)}")
        print("   " + ", ".join(f"{z['nombre'].split(',')[0]} ({z['minutos']:.0f})"
                                for z in seleccion) + "\n")

    from fuentes.idealista import Idealista, parsear_listado
    fuente = Idealista(cache_dir=AQUI / "cache")

    if args.desde_cache:
        print("1/5 Releyendo el HTML ya descargado (sin tocar los portales)...")
        # Cada fichero se parsea con el parser de SU portal: usar el de
        # idealista con todos devolvia cero para roomgo y depisoenpiso.
        from fuentes.roomgo import parsear_listado as parsear_roomgo
        from fuentes.depisoenpiso import parsear_listado as parsear_dpp
        from fuentes.fotocasa import parsear_listado as parsear_fotocasa
        anuncios, vistos = [], set()
        for f in sorted((AQUI / "cache").glob("*.html")):
            nombre = f.name
            if nombre.startswith("roomgo_"):
                parser = parsear_roomgo
            elif nombre.startswith("dpp_"):
                parser = parsear_dpp
            elif nombre.startswith("fotocasa_"):
                parser = parsear_fotocasa
            else:
                parser = parsear_listado
            for a in parser(f.read_text(encoding="utf-8")):
                clave = (a.portal, a.id_portal)
                if clave not in vistos:
                    vistos.add(clave)
                    anuncios.append(a)
        brutos = len(anuncios)
        anuncios, fusionados = deduplicar(anuncios)
        print(f"    {brutos} anuncios recuperados de cache"
              f"{f', {fusionados} duplicados fusionados' if fusionados else ''}\n")
        return _procesar(anuncios, cfg, zonas, con, geo, red, args, fuente,
                         desde_cache=True)

    activas = cfg.get("fuentes", ["idealista"])
    print(f"1/5 Rastreando {', '.join(activas)}...")
    print("    Se abrira una ventana de Chromium: dejala visible, es lo que")
    print("    evita el bloqueo anti-bot. Si sale un captcha, resuelvelo.\n")

    anuncios: list = []
    otras: list = []
    for nombre in activas:
        f = fuente if nombre == "idealista" else _crear_fuente(nombre)
        if f is None:
            print(f"  {nombre}: fuente desconocida, la salto")
            continue
        if f is not fuente:
            otras.append(f)
        try:
            anuncios.extend(f.buscar(cfg, max_paginas=paginas))
        except KeyboardInterrupt:
            break
        except Exception as e:
            # Que un portal falle no debe tumbar la busqueda entera.
            print(f"  {nombre} ha fallado ({str(e)[:70]}); sigo con el resto")
    for f in otras:
        f.cerrar()

    brutos = len(anuncios)
    anuncios, fusionados = deduplicar(anuncios)
    if fusionados:
        print(f"    {brutos} anuncios, {fusionados} eran el mismo piso en "
              f"dos portales -> {len(anuncios)}\n")
    else:
        print(f"    {len(anuncios)} anuncios rastreados\n")

    if not anuncios:
        print("No se ha podido rastrear nada. Prueba de nuevo en unos minutos:")
        print("los portales bloquean temporalmente tras varias peticiones seguidas.")
        fuente.cerrar(); return 1
    return _procesar(anuncios, cfg, zonas, con, geo, red, args, fuente)


def _crear_fuente(nombre: str):
    if nombre == "roomgo":
        from fuentes.roomgo import Roomgo
        return Roomgo(cache_dir=AQUI / "cache")
    if nombre == "depisoenpiso":
        from fuentes.depisoenpiso import DePisoEnPiso
        return DePisoEnPiso(cache_dir=AQUI / "cache")
    if nombre == "fotocasa":
        from fuentes.fotocasa import Fotocasa
        return Fotocasa(cache_dir=AQUI / "cache")
    return None


def _procesar(anuncios, cfg, zonas, con, geo, red, args, fuente,
              desde_cache: bool = False) -> int:
    """Geocodifica, calcula rutas, filtra, puntua e informa."""
    print("2/5 Situando en el mapa (Nominatim, 1 consulta/segundo)...")
    ya_situados = sum(1 for a in anuncios if a.lat is not None)
    if ya_situados:
        print(f"    {ya_situados} ya traen coordenadas del portal")
    for i, a in enumerate(anuncios, 1):
        if a.lat is None:
            geo.situar(a)
        if i % 25 == 0:
            print(f"    {i}/{len(anuncios)}")
    sin_sitio = sum(1 for a in anuncios if a.lat is None)
    print(f"    {len(anuncios) - sin_sitio} situados, {sin_sitio} sin ubicacion\n")

    print("3/5 Calculando trayectos...")
    dest1 = cfg["transporte"]["destino_principal"]
    dest2 = cfg["transporte"]["destino_secundario"]
    for a in anuncios:
        if a.lat is None:
            continue
        r1 = red.ruta_desde(a.lat, a.lon, dest1)
        r2 = red.ruta_desde(a.lat, a.lon, dest2)
        if r1:
            a.minutos_fira, a.ruta_fira = r1.minutos, r1.detalle
        if r2:
            a.minutos_collblanc = r2.minutos

    ok, posibles, fuera = filtrar(anuncios, cfg, zonas, almacen.descartados(con))
    ok = ordenar(ok, cfg, zonas)
    posibles = ordenar(posibles, cfg, zonas)
    minimo = cfg["requisitos"].get("puntos_minimos_para_preguntar", 60)
    flojos = [p for p in posibles if p.puntuacion < minimo]
    posibles = [p for p in posibles if p.puntuacion >= minimo]
    fuera.extend((p, "genero sin confirmar y puntuacion baja") for p in flojos)
    print(f"    {len(ok)} cumplen todos tus requisitos, "
          f"{len(posibles)} posibles sin confirmar genero, "
          f"{len(fuera)} descartados\n")

    fichas = 0
    if ok and not args.sin_fichas and not desde_cache:
        de_idealista = [a for a in ok if a.portal == "idealista"]
        tope = min(cfg["busqueda"]["fichas_a_enriquecer"], len(de_idealista))
        print(f"4/5 Leyendo las {tope} mejores fichas (visitas, propietario)...")
        fuente.enriquecer(de_idealista, maximo=tope)
        fichas = sum(1 for a in ok if a.ficha_leida)
        ok, _, fuera2 = filtrar(ok, cfg, zonas, almacen.descartados(con))
        fuera.extend(fuera2)
        ok = ordenar(ok, cfg, zonas)
        print(f"    {fichas} fichas leidas, quedan {len(ok)}\n")
    else:
        print("4/5 Fichas omitidas\n")
    fuente.cerrar()

    navegador.cerrar_todo()

    print("5/5 Guardando e informando...")
    nuevos = almacen.registrar(con, ok + posibles)
    destino = informe.generar(
        ok, {a.id for a in nuevos}, fuera, cfg, AQUI / "informe.html",
        {"rastreados": len(anuncios), "fichas": fichas,
         "portales": len({a.portal for a in anuncios})}, posibles=posibles)
    print(f"\n  {len(ok)} habitaciones ({len(nuevos)} nuevas) -> {destino}")
    for a in ok[:5]:
        print(f"    {a.puntuacion:5.0f}  {a.coste_total:>4} €  "
              f"{(a.minutos_fira or 0):4.0f} min  {a.barrio[:22]:22s}  {a.url}")
    if not args.no_abrir:
        webbrowser.open(destino.as_uri())
    return 0


def cmd_marcar(args) -> int:
    con = almacen.abrir(BD)
    if almacen.marcar(con, args.id, args.estado, args.nota or ""):
        print(f"{args.id} -> {args.estado}")
        return 0
    print(f"no encuentro el anuncio {args.id}")
    return 1


def cmd_estados(args) -> int:
    con = almacen.abrir(BD)
    filas = con.execute(
        "SELECT id, estado, primera_vez, url, nota FROM anuncios "
        "WHERE estado != 'nuevo' ORDER BY estado, primera_vez").fetchall()
    if not filas:
        print("no has marcado nada todavia")
        return 0
    for i, e, f, u, n in filas:
        print(f"{i}  {e:11s} {f}  {u}  {n}")
    return 0


def main(argv=None) -> int:
    # El rastreo tarda minutos: sin esto el progreso no se ve hasta el final.
    sys.stdout.reconfigure(line_buffering=True)
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd")

    p.add_argument("--paginas", type=int, help="paginas por municipio")
    p.add_argument("--sin-fichas", action="store_true", help="no abrir fichas")
    p.add_argument("--solo-nuevos", action="store_true", help="solo ultimas 48 h")
    p.add_argument("--offline", action="store_true", help="no geocodificar por red")
    p.add_argument("--no-abrir", action="store_true", help="no abrir el navegador")
    p.add_argument("--municipios", nargs="+", metavar="SLUG",
                   help="limita la busqueda a estos municipios de idealista")
    p.add_argument("--max-minutos", type=int, metavar="N",
                   help="tiempo maximo hasta el trabajo (por defecto, el de "
                        "config.yaml). Ej: --max-minutos 60")
    p.add_argument("--presupuesto", type=int, metavar="EUROS",
                   help="coste total maximo al mes, gastos incluidos")
    p.add_argument("--fuentes", nargs="+", metavar="PORTAL",
                   choices=["idealista", "roomgo", "depisoenpiso", "fotocasa"],
                   help="portales a rastrear (por defecto, los de config.yaml)")
    p.add_argument("--desde-cache", action="store_true",
                   help="reusa el HTML ya descargado: sirve para reajustar los "
                        "pesos de config.yaml sin volver a rastrear")

    m = sub.add_parser("marcar", help="cambia el estado de un anuncio")
    m.add_argument("id"); m.add_argument("estado", choices=almacen.ESTADOS)
    m.add_argument("nota", nargs="?", default="")
    m.set_defaults(func=cmd_marcar)

    e = sub.add_parser("estados", help="lista lo que has marcado")
    e.set_defaults(func=cmd_estados)

    args = p.parse_args(argv)
    if getattr(args, "func", None):
        return args.func(args)
    return cmd_buscar(args)


if __name__ == "__main__":
    sys.exit(main())
