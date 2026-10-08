"""Filtrado duro y puntuacion explicable.

Regla de diseno: ninguna puntuacion sin motivo. Cada anuncio sale con la lista
de por que suma y por que resta, para que puedas discutirle el criterio a la
herramienta en vez de tragarte un numero.
"""
from __future__ import annotations

import datetime as dt
import re

from buscapiso.modelo import DESCONOCIDO, GENERO_CUALQUIERA, Anuncio

_AMBIENTE_JOVEN = re.compile(
    r"estudiant|j[oó]ven|joven|profesional|trabajador|erasmus|universitari", re.I)
_AMBIENTE_CERRADO = re.compile(r"no\s+suelen\s+tener\s+visitas|abunda\s+el\s+silencio",
                               re.I)
_MESES = r"enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre"
# "de octubre a diciembre" es un alquiler temporal aunque no use la palabra
# "temporada". Lo descubrio una ficha real que el listado no delataba.
_AMBIENTE_MALO = re.compile(
    rf"solo\s+temporada|turis|d[ií]as\s+sueltos|"
    rf"de\s+({_MESES})\s+a\s+({_MESES})|"
    rf"(?:solo|s[oó]lo|[uú]nicamente)\s+(?:hasta|por)\s+\d+\s+mes", re.I)
_VISITAS_TEXTO_NO = re.compile(r"no\s+se\s+(permiten|admiten)\s+visitas|"
                               r"prohibid\w+\s+(las\s+)?visitas", re.I)
_VISITAS_TEXTO_SI = re.compile(r"se\s+(permiten|admiten)\s+visitas", re.I)

_DESCRIPCION_GENERO = {"chicas": "solo chicas", "chicos": "solo chicos",
                       "mixto": "mixto"}


def _texto(a: Anuncio) -> str:
    return f"{a.titulo} {a.descripcion}"


def filtrar(anuncios: list[Anuncio], cfg: dict, zonas: dict,
            descartados: set[str] | None = None
            ) -> tuple[list[Anuncio], list[Anuncio], list[tuple]]:
    """Separa lo que cumple los requisitos duros de lo que no.

    Devuelve (aceptados, posibles, [(anuncio, motivo), ...]).

    "Posibles" son los que cumplen todo menos que el portal no publica el
    genero del piso. Descartarlos tira opciones buenas por falta de un dato
    que se resuelve con un mensaje; colarlos en la lista principal la
    contamina. Van aparte, y solo si puntuan bien.
    """
    req = cfg["requisitos"]
    pres = cfg["presupuesto"]
    destinos = cfg.get("destinos", [])
    excluidos = {z.lower() for z in (zonas.get("excluir") or [])}
    descartados = descartados or set()

    ok, posibles, fuera = [], [], []
    preguntar = req.get("preguntar_si_genero_desconocido", False)
    for a in anuncios:
        if a.id in descartados:
            fuera.append((a, "lo descartaste antes")); continue
        dudoso = False
        genero = req.get("genero", GENERO_CUALQUIERA)
        if genero != GENERO_CUALQUIERA and a.genero_piso != genero:
            if a.genero_piso == DESCONOCIDO and preguntar:
                dudoso = True          # sigue el resto de filtros y va aparte
            else:
                motivo = ("el portal no dice el genero del piso"
                          if a.genero_piso == DESCONOCIDO
                          else f"piso {a.genero_piso}, no {_DESCRIPCION_GENERO[genero]}")
                fuera.append((a, motivo)); continue
        estimado = a.coste_estimado(pres["gastos_si_no_declara"])
        if estimado is None:
            fuera.append((a, "sin precio")); continue
        if estimado > pres["coste_total_maximo"]:
            fuera.append((a, f"{estimado} € totales, por encima del maximo")); continue
        if req.get("sin_propietario") and a.propietario_vive is True:
            fuera.append((a, "el propietario vive en el piso")); continue
        if req.get("visitas_permitidas") == "estricto":
            if a.visitas_permitidas is False or _VISITAS_TEXTO_NO.search(_texto(a)):
                fuera.append((a, "no se permiten visitas")); continue
        limitados = [d for d in destinos if d.get("max_minutos") is not None]
        if any(d["nombre"] not in a.trayectos for d in limitados):
            fuera.append((a, "sin ubicacion utilizable")); continue
        lejos = next((d for d in limitados
                      if a.trayectos[d["nombre"]] > d["max_minutos"]), None)
        if lejos is not None:
            fuera.append((a, f"{a.trayectos[lejos['nombre']]:.0f} min a "
                             f"{lejos['nombre']}")); continue
        zona = (a.barrio or a.municipio).lower()
        if any(e in zona for e in excluidos):
            fuera.append((a, f"zona excluida por ti: {a.barrio or a.municipio}")); continue
        (posibles if dudoso else ok).append(a)
    return ok, posibles, fuera


def puntuar(a: Anuncio, cfg: dict, zonas: dict) -> float:
    """Puntuacion 0-inf. Rellena a.motivos con el desglose."""
    p = cfg["pesos"]
    pres = cfg["presupuesto"]
    motivos: list[str] = []
    total = 100.0

    # Trayectos: cada destino resta segun su propio peso por minuto.
    for d in cfg.get("destinos", []):
        minutos = a.trayectos.get(d["nombre"])
        if minutos is None:
            continue
        exceso = max(0.0, minutos - p["minutos_gratis"])
        castigo = exceso * d["peso_minuto"]
        total -= castigo
        motivos.append(f"{minutos:.0f} min a {d['nombre']} ({-castigo:+.0f})")

    # Dinero: penaliza lo que pasa del coste ideal, no el precio absoluto.
    estimado = a.coste_estimado(pres["gastos_si_no_declara"])
    if estimado is not None:
        exceso = max(0, estimado - pres["coste_total_ideal"])
        castigo = exceso * p["euro_sobre_ideal"]
        total -= castigo
        if a.gastos_extra:
            etiqueta = f"{a.precio} € + {a.gastos_extra} € gastos = {estimado} €/mes"
        elif a.gastos_extra == 0:
            etiqueta = f"{a.precio} € todo incluido"
        else:
            etiqueta = (f"{a.precio} € + gastos sin declarar "
                        f"(cuento ~{pres['gastos_si_no_declara']} €) = {estimado} €/mes")
        motivos.append(f"{etiqueta} ({-castigo:+.0f})")
    if a.gastos_extra == 0:
        total += p["gastos_incluidos"]
        motivos.append(f"gastos incluidos (+{p['gastos_incluidos']:.0f})")

    # Novedad: en Barcelona llegar el primero vale mas que el filtro perfecto.
    # Cuando el portal da la antiguedad, manda ella; tener fecha no es lo
    # mismo que ser reciente.
    if a.antiguedad_dias is not None:
        if a.antiguedad_dias <= p["dias_para_ser_nuevo"]:
            total += p["novedad"]
            motivos.append(f"publicado {a.publicado_texto} (+{p['novedad']:.0f})")
        elif a.antiguedad_dias >= p["dias_para_estar_rancio"]:
            total -= p["rancio"]
            motivos.append(f"publicado {a.publicado_texto}, probablemente ya "
                           f"alquilado (-{p['rancio']:.0f})")
    elif a.publicado_texto:
        # Idealista solo muestra fecha en los anuncios recientes.
        total += p["novedad"]
        motivos.append(f"publicado {a.publicado_texto} (+{p['novedad']:.0f})")

    if _AMBIENTE_JOVEN.search(_texto(a)):
        total += p["ambiente_joven"]
        motivos.append(f"ambiente joven/estudiantes (+{p['ambiente_joven']:.0f})")
    if _AMBIENTE_MALO.search(_texto(a)):
        total -= p["temporal"]
        motivos.append(f"parece alquiler temporal (-{p['temporal']:.0f})")

    if a.companeros and a.companeros > p["companeros_comodos"]:
        castigo = (a.companeros - p["companeros_comodos"]) * p["por_companero_extra"]
        total -= castigo
        motivos.append(f"{a.companeros} compañeros ({-castigo:+.0f})")

    if a.visitas_permitidas is True or _VISITAS_TEXTO_SI.search(_texto(a)):
        total += p["visitas"]
        motivos.append(f"visitas permitidas (+{p['visitas']:.0f})")
    elif a.ambiente and _AMBIENTE_CERRADO.search(a.ambiente):
        # Costumbre de la casa, no norma: resta, pero no descarta.
        total -= p["visitas"]
        motivos.append(f"casa poco dada a visitas (-{p['visitas']:.0f})")
    if a.admite_parejas is False:
        total -= p["no_admite_parejas"]
        motivos.append(f"no admite parejas (-{p['no_admite_parejas']:.0f})")

    # Edad real de los companeros: mucho mejor senal que buscar "joven" en
    # el texto libre del anuncio.
    if a.edad_companeros:
        try:
            menor, mayor = (int(x) for x in a.edad_companeros.split("-"))
            if abs((menor + mayor) / 2 - p["edad_afin"]) <= p["margen_edad"]:
                total += p["ambiente_joven"]
                motivos.append(f"compañeras de {a.edad_companeros} años "
                               f"(+{p['ambiente_joven']:.0f})")
        except ValueError:
            pass

    # Entras "ya": un piso libre dentro de un mes vale menos que uno libre hoy.
    if a.disponible_desde:
        try:
            libre = dt.datetime.strptime(a.disponible_desde, "%d-%m-%Y").date()
            dias = (libre - dt.date.today()).days
            if dias > p["dias_de_espera_tolerables"]:
                castigo = min((dias - p["dias_de_espera_tolerables"]) * p["por_dia_de_espera"],
                              p["espera_maxima"])
                total -= castigo
                motivos.append(f"libre el {a.disponible_desde}, dentro de "
                               f"{dias} días ({-castigo:+.0f})")
        except ValueError:
            pass

    # Zonas que tu has marcado en zonas.yaml.
    zona = (a.barrio or a.municipio).lower()
    for nombre in (zonas.get("preferir") or []):
        if nombre.lower() in zona:
            total += p["zona_preferida"]
            motivos.append(f"zona preferida: {a.barrio} (+{p['zona_preferida']:.0f})")
            break
    for nombre in (zonas.get("penalizar") or []):
        if nombre.lower() in zona:
            total -= p["zona_penalizada"]
            motivos.append(f"zona penalizada: {a.barrio} (-{p['zona_penalizada']:.0f})")
            break

    # Honestidad sobre la calidad del dato: si solo sabemos el barrio, el
    # tiempo de trayecto es una estimacion y el anuncio no debe adelantar a
    # otro con direccion exacta y tiempo parecido.
    if a.coords_aproximadas:
        total -= p["ubicacion_estimada"]
        motivos.append(f"ubicacion estimada, no exacta (-{p['ubicacion_estimada']:.0f})")

    a.puntuacion = round(total, 1)
    a.motivos = motivos
    return a.puntuacion


def ordenar(anuncios: list[Anuncio], cfg: dict, zonas: dict) -> list[Anuncio]:
    for a in anuncios:
        puntuar(a, cfg, zonas)
    return sorted(anuncios, key=lambda x: x.puntuacion, reverse=True)
