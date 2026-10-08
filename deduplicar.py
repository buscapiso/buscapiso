"""Un mismo piso anunciado en varios portales debe salir una sola vez.

El criterio es deliberadamente estrecho: mismo precio y a menos de 150 m.
Fusionar de mas es peor que fusionar de menos, porque esconde anuncios que
son distintos de verdad, y eso no se nota al mirar el informe.
"""
from __future__ import annotations

from transporte import haversine_m

TOLERANCIA_PRECIO = 10      # euros
TOLERANCIA_METROS = 150.0


def _mismo_piso(a, b) -> bool:
    if a.portal == b.portal:
        return False                      # dentro de un portal ya deduplicamos por id
    if a.precio is None or b.precio is None:
        return False
    if abs(a.precio - b.precio) > TOLERANCIA_PRECIO:
        return False
    if None in (a.lat, a.lon, b.lat, b.lon):
        return False                      # sin posicion no se afirma nada
    return haversine_m(a.lat, a.lon, b.lat, b.lon) <= TOLERANCIA_METROS


def _fusionar(ganador, perdedor):
    """Rellena en el ganador los huecos que el perdedor si tiene."""
    for campo, vacio in (("lat", None), ("lon", None), ("descripcion", ""),
                         ("foto", ""), ("companeros", None), ("habitaciones", None),
                         ("gastos_extra", None), ("edad_companeros", ""),
                         ("disponible_desde", ""), ("admite_parejas", None),
                         ("barrio", ""), ("direccion", "")):
        if getattr(ganador, campo) in (vacio, None) and getattr(perdedor, campo) not in (vacio, None):
            setattr(ganador, campo, getattr(perdedor, campo))
    if not ganador.genero_confirmado and perdedor.genero_confirmado:
        ganador.genero_piso = perdedor.genero_piso
        ganador.genero_confirmado = True
    if perdedor.portal not in ganador.tambien_en:
        ganador.tambien_en.append(perdedor.portal)
    return ganador


def deduplicar(anuncios: list) -> tuple[list, int]:
    """Devuelve (lista sin duplicados, cuantos se fusionaron).

    Gana el anuncio con mas datos; el otro aporta lo que el ganador no tiene
    y queda anotado en `tambien_en`, para que sepas que esta en dos sitios.
    """
    unicos: list = []
    fusionados = 0
    for a in sorted(anuncios, key=lambda x: x.riqueza, reverse=True):
        for u in unicos:
            if _mismo_piso(u, a):
                _fusionar(u, a)
                fusionados += 1
                break
        else:
            unicos.append(a)
    return unicos, fusionados
