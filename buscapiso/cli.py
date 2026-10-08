"""Linea de comandos de buscapiso.

    buscapiso                         busca con el perfil activo
    buscapiso --max-minutos 45        retoca el perfil solo para esta busqueda
    buscapiso mark <id> contacted     cambia el estado de un anuncio
    buscapiso statuses                lista lo que has marcado
    buscapiso profile list|show|use|export|import

Los nombres antiguos siguen valiendo: marcar, estados, y los estados en
espanol (interesa, contactado, visita, descartado).
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys
import webbrowser

from pydantic import ValidationError

from buscapiso import almacen, informe, paths
from buscapiso.pipeline import SearchOptions, run_search
from buscapiso.profiles import SearchProfile, to_engine_cfg
from buscapiso.seed import active_profile

FUENTES = ["idealista", "roomgo", "depisoenpiso", "fotocasa"]


def apply_overrides(profile: SearchProfile, args: argparse.Namespace) -> SearchProfile:
    """Copia del perfil con los flags de esta ejecucion. No toca el guardado."""
    p = profile.model_copy(deep=True)
    if args.solo_nuevos:
        p.idealista.last_48h = True
    if args.presupuesto:
        p.budget.max_total = args.presupuesto
        p.budget.ideal_total = min(p.budget.ideal_total, args.presupuesto)
    if args.fuentes:
        p.sources = list(args.fuentes)
    if args.paginas:
        p.crawl.max_pages = args.paginas
    if args.max_minutos:
        limitado = next((d for d in p.destinations if d.max_minutes is not None), None)
        if limitado is None:
            raise SystemExit("--max-minutos necesita un destino con max_minutes en "
                             "el perfil (buscapiso profile show)")
        limitado.max_minutes = args.max_minutos
    return SearchProfile.model_validate(p.model_dump())


def cmd_search(args) -> int:
    con = almacen.abrir(paths.db_path())
    try:
        perfil = apply_overrides(active_profile(con), args)
    except ValidationError as e:
        print(f"opciones no validas para esta busqueda:\n{e}")
        return 2
    cfg, zonas = to_engine_cfg(perfil)
    opciones = SearchOptions(pages=args.paginas, skip_details=args.sin_fichas,
                             from_cache=args.desde_cache, offline=args.offline,
                             municipalities=args.municipios)
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
              f"{next(iter(a.trayectos.values()), 0):4.0f} min  "
              f"{a.barrio[:22]:22s}  {a.url}")
    if not args.no_abrir:
        webbrowser.open(destino.as_uri())
    return 0


def cmd_mark(args) -> int:
    con = almacen.abrir(paths.db_path())
    if almacen.marcar(con, args.id, args.estado, args.nota or None):
        print(f"{args.id} -> {almacen.ESTADOS_ANTIGUOS.get(args.estado, args.estado)}")
        return 0
    print(f"no encuentro el anuncio {args.id}")
    return 1


def cmd_statuses(args) -> int:
    con = almacen.abrir(paths.db_path())
    filas = con.execute(
        "SELECT id, estado, primera_vez, url, nota FROM anuncios "
        "WHERE estado != 'new' ORDER BY estado, primera_vez").fetchall()
    if not filas:
        print("no has marcado nada todavia")
        return 0
    for i, e, f, u, n in filas:
        print(f"{i}  {e:15s} {f}  {u}  {n}")
    return 0


def cmd_profile(args) -> int:
    con = almacen.abrir(paths.db_path())
    active_profile(con)
    if args.accion == "list":
        for nombre, activo in almacen.listar_perfiles(con):
            print(f"{nombre}{' *' if activo else ''}")
        return 0
    if args.accion == "show":
        perfil = almacen.cargar_perfil(con, args.nombre)
        if perfil is None:
            print(f"no hay ningun perfil llamado {args.nombre}")
            return 1
        print(perfil.model_dump_json(indent=2))
        return 0
    if args.accion == "use":
        if almacen.activar_perfil(con, args.nombre):
            print(f"perfil activo: {args.nombre}")
            return 0
        print(f"no hay ningun perfil llamado {args.nombre}")
        return 1
    if args.accion == "export":
        perfil = almacen.cargar_perfil(con, args.nombre)
        if perfil is None:
            print(f"no hay ningun perfil llamado {args.nombre}")
            return 1
        pathlib.Path(args.fichero).write_text(perfil.model_dump_json(indent=2),
                                              encoding="utf-8")
        print(f"{args.nombre} -> {args.fichero}")
        return 0
    # import
    try:
        perfil = SearchProfile.model_validate_json(
            pathlib.Path(args.fichero).read_text(encoding="utf-8"))
    except (OSError, ValidationError, json.JSONDecodeError) as e:
        print(f"no se puede importar {args.fichero}:\n{e}")
        return 2
    almacen.guardar_perfil(con, perfil, activar=args.use)
    print(f"perfil {perfil.name} guardado{' y activo' if args.use else ''}")
    return 0


def cmd_serve(args) -> int:
    import threading
    import uvicorn
    from buscapiso.api.app import create_app
    url = f"http://{args.host}:{args.port}/"
    print(f"buscapiso en {url} (Ctrl+C para parar)")
    if not args.no_open:
        threading.Timer(1.0, webbrowser.open, args=(url,)).start()
    uvicorn.run(create_app(), host=args.host, port=args.port, log_level="warning")
    return 0


def main(argv: list[str] | None = None) -> int:
    # El rastreo tarda minutos: sin esto el progreso no se ve hasta el final.
    sys.stdout.reconfigure(line_buffering=True)
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--paginas", type=int, help="paginas por municipio")
    p.add_argument("--sin-fichas", action="store_true", help="no abrir fichas")
    p.add_argument("--solo-nuevos", action="store_true", help="solo ultimas 48 h")
    p.add_argument("--offline", action="store_true", help="no geocodificar por red")
    p.add_argument("--no-abrir", action="store_true", help="no abrir el navegador")
    p.add_argument("--municipios", nargs="+", metavar="SLUG",
                   help="limita la busqueda a estos municipios de idealista")
    p.add_argument("--max-minutos", type=int, metavar="N",
                   help="tiempo maximo al primer destino con limite, solo para "
                        "esta busqueda")
    p.add_argument("--presupuesto", type=int, metavar="EUROS",
                   help="coste total maximo al mes, gastos incluidos")
    p.add_argument("--fuentes", nargs="+", metavar="PORTAL", choices=FUENTES,
                   help="portales a rastrear en esta busqueda")
    p.add_argument("--desde-cache", action="store_true",
                   help="reusa el HTML ya descargado, sin tocar los portales")
    sub = p.add_subparsers(dest="cmd")

    sub.add_parser("search", help="busca con el perfil activo (por defecto)")

    m = sub.add_parser("mark", aliases=["marcar"], help="cambia el estado de un anuncio")
    m.add_argument("id")
    m.add_argument("estado",
                   choices=list(almacen.ESTADOS) + list(almacen.ESTADOS_ANTIGUOS))
    m.add_argument("nota", nargs="?", default=None)
    m.set_defaults(func=cmd_mark)

    e = sub.add_parser("statuses", aliases=["estados"], help="lista lo que has marcado")
    e.set_defaults(func=cmd_statuses)

    pr = sub.add_parser("profile", help="perfiles de busqueda")
    acciones = pr.add_subparsers(dest="accion", required=True)
    acciones.add_parser("list")
    for nombre in ("show", "use"):
        acciones.add_parser(nombre).add_argument("nombre")
    ex = acciones.add_parser("export")
    ex.add_argument("nombre")
    ex.add_argument("fichero")
    im = acciones.add_parser("import")
    im.add_argument("fichero")
    im.add_argument("--use", action="store_true", help="dejarlo como perfil activo")
    pr.set_defaults(func=cmd_profile)

    sv = sub.add_parser("serve", help="abre la web app")
    sv.add_argument("--host", default="127.0.0.1")
    sv.add_argument("--port", type=int, default=8770)
    sv.add_argument("--no-open", action="store_true", help="no abrir el navegador")
    sv.set_defaults(func=cmd_serve)

    args = p.parse_args(argv)
    if getattr(args, "func", None):
        return args.func(args)
    return cmd_search(args)
