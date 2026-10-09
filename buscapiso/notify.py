"""Avisos al movil con ntfy: una app gratuita (iOS y Android) que recibe lo
que se publica en un "tema". No hace falta cuenta. En ntfy.sh cualquiera que
sepa el nombre del tema puede leerlo, asi que el tema por defecto es aleatorio.
"""
from __future__ import annotations

import secrets
import string
import urllib.request

from buscapiso import almacen
from buscapiso.events import emit

DEFAULT_SERVER = "https://ntfy.sh"


def _post(url: str, headers: dict, body: bytes) -> None:
    req = urllib.request.Request(url, data=body, method="POST", headers=headers)
    with urllib.request.urlopen(req, timeout=20):
        pass


def random_topic() -> str:
    letras = string.ascii_lowercase + string.digits
    return "buscapiso-" + "".join(secrets.choice(letras) for _ in range(10))


def settings(con) -> dict:
    a = almacen.leer_ajustes(con)
    return {"server": a.get("ntfy_server", DEFAULT_SERVER), "topic": a.get("ntfy_topic", ""),
            "min_score": int(a.get("notify_min_score", "80"))}


def send(con, title: str, body: str, click: str | None = None, post=None) -> None:
    s = settings(con)
    headers = {"Title": title, "Tags": "house"}
    if click:
        headers["Click"] = click
    (post or _post)(f"{s['server'].rstrip('/')}/{s['topic']}", headers, body.encode())


def _linea(a) -> str:
    destino = next(iter(a.trayectos.items()), None)
    viaje = f", {destino[1]:.0f} min to {destino[0]}" if destino else ""
    sitio = a.barrio or a.municipio
    return f"{a.coste_total or '?'} €{viaje}. {a.titulo or sitio}"


def notify_new_listings(con, result, click: str | None = None, post=None) -> int:
    """Avisa de los anuncios nuevos que superan la puntuacion minima. Nunca
    lanza: un aviso que no llega no debe estropear la busqueda."""
    s = settings(con)
    if not s["topic"]:
        return 0
    buenos = sorted((a for a in result.accepted
                     if a.id in result.new_ids and a.puntuacion >= s["min_score"]),
                    key=lambda a: a.puntuacion, reverse=True)
    if not buenos:
        return 0
    lineas = [_linea(a) for a in buenos[:3]]
    if len(buenos) > 3:
        lineas.append(f"and {len(buenos) - 3} more")
    titulo = (f"{len(buenos)} new rooms worth a look" if len(buenos) > 1
              else "A new room worth a look")
    try:
        send(con, titulo, "\n".join(lineas), click=click, post=post)
    except OSError as e:
        emit("warning", f"Could not send the ntfy notification ({type(e).__name__})")
        return 0
    return len(buenos)
