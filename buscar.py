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

from buscapiso import almacen, paths
from buscapiso import informe
from buscapiso.pipeline import SearchOptions, run_search

AQUI = pathlib.Path(__file__).resolve().parent
BD = paths.db_path()


def cargar_cfg():
    cfg = yaml.safe_load((AQUI / "config.yaml").read_text(encoding="utf-8"))
    zonas = yaml.safe_load((AQUI / "zonas.yaml").read_text(encoding="utf-8")) or {}
    return cfg, zonas


def cmd_buscar(args) -> int:
    cfg, zonas = cargar_cfg()
    if args.solo_nuevos:
        cfg["filtros_idealista"]["publicado_48h"] = True
    if args.max_minutos:
        limitado = next((d for d in cfg["destinos"] if d.get("max_minutos") is not None),
                        None)
        if limitado is None:
            print("--max-minutos necesita un destino con max_minutos en config.yaml")
            return 2
        limitado["max_minutos"] = args.max_minutos
    if args.presupuesto:
        cfg["presupuesto"]["coste_total_maximo"] = args.presupuesto
    if args.fuentes:
        cfg["fuentes"] = args.fuentes

    opciones = SearchOptions(pages=args.paginas, skip_details=args.sin_fichas,
                             from_cache=args.desde_cache, offline=args.offline,
                             municipalities=args.municipios)
    con = almacen.abrir(BD)
    r = run_search(cfg, zonas, opciones, con)
    if r.crawled == 0:
        return 1
    destino = informe.generar(
        r.accepted, r.new_ids, r.rejected, cfg, paths.report_path(),
        {"rastreados": r.crawled, "fichas": r.details_read, "portales": r.portals},
        posibles=r.possible)
    print(f"\n  {len(r.accepted)} habitaciones ({len(r.new_ids)} nuevas) -> {destino}")
    for a in r.accepted[:5]:
        print(f"    {a.puntuacion:5.0f}  {a.coste_total:>4} €  "
              f"{next(iter(a.trayectos.values()), 0):4.0f} min  {a.barrio[:22]:22s}  {a.url}")
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
        "WHERE estado != 'new' ORDER BY estado, primera_vez").fetchall()
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
    m.add_argument("id"); m.add_argument("estado", choices=list(almacen.ESTADOS) + list(almacen.ESTADOS_ANTIGUOS))
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
