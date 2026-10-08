"""Direccion -> coordenadas, usando Nominatim (OpenStreetMap) con cache local.

Las paginas de listado de idealista no traen coordenadas, asi que hay que
geocodificar la direccion del titulo. Nominatim es gratis pero pide como maximo
1 peticion por segundo, asi que la cache en SQLite no es una optimizacion: es
lo que hace viable relanzar la busqueda muchas veces.
"""
from __future__ import annotations

import json
import sqlite3
import time
import urllib.parse
import urllib.request

NOMINATIM = "https://nominatim.openstreetmap.org/search"
AGENTE = "buscapiso/1.0 (uso personal, busqueda de habitacion)"
PAUSA_MIN_S = 1.1        # politica de uso de Nominatim


class Geocodificador:
    def __init__(self, conexion: sqlite3.Connection, offline: bool = False):
        self.con = conexion
        self.offline = offline
        self._ultima = 0.0
        self.con.execute("""
            CREATE TABLE IF NOT EXISTS geocache (
                consulta TEXT PRIMARY KEY,
                lat REAL, lon REAL, encontrado INTEGER, ts REAL)""")
        self.con.commit()

    # --- cache ---------------------------------------------------------
    def _de_cache(self, consulta: str):
        fila = self.con.execute(
            "SELECT lat, lon, encontrado FROM geocache WHERE consulta = ?",
            (consulta,)).fetchone()
        if fila is None:
            return None
        lat, lon, ok = fila
        return (lat, lon) if ok else (None, None)

    def _a_cache(self, consulta: str, lat, lon) -> None:
        self.con.execute(
            "INSERT OR REPLACE INTO geocache VALUES (?,?,?,?,?)",
            (consulta, lat, lon, 1 if lat is not None else 0, time.time()))
        self.con.commit()

    # --- consulta ------------------------------------------------------
    def _pedir(self, consulta: str, bbox: tuple | None = None):
        espera = PAUSA_MIN_S - (time.time() - self._ultima)
        if espera > 0:
            time.sleep(espera)
        campos = {"q": consulta, "format": "json", "limit": 1, "countrycodes": "es"}
        if bbox:
            # Nominatim resuelve "Eixample" a un sitio cerca de Mollet si no se
            # le acota: el nombre se repite en media Cataluna.
            izq, arriba, der, abajo = bbox
            campos["viewbox"] = f"{izq},{arriba},{der},{abajo}"
            campos["bounded"] = 1
        params = urllib.parse.urlencode(campos)
        req = urllib.request.Request(f"{NOMINATIM}?{params}",
                                     headers={"User-Agent": AGENTE})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                datos = json.load(r)
        except Exception:
            return (None, None)
        finally:
            self._ultima = time.time()
        if not datos:
            return (None, None)
        return (float(datos[0]["lat"]), float(datos[0]["lon"]))

    def geocodificar(self, consulta: str, bbox: tuple | None = None):
        clave = consulta if not bbox else f"{consulta}|{bbox}"
        en_cache = self._de_cache(clave)
        if en_cache is not None:
            return en_cache
        if self.offline:
            return (None, None)
        lat, lon = self._pedir(consulta, bbox)
        self._a_cache(clave, lat, lon)
        return (lat, lon)

    def situar(self, anuncio) -> None:
        """Rellena lat/lon del anuncio probando de lo concreto a lo general.

        coords_aproximadas queda en False solo si acertamos a nivel de calle:
        el ranking necesita saber si el tiempo de trayecto es fiable o es una
        estimacion del centro del barrio.
        """
        intentos = []
        if anuncio.direccion and anuncio.municipio:
            intentos.append((f"{anuncio.direccion}, {anuncio.municipio}, España", False))
        if anuncio.barrio and anuncio.municipio:
            intentos.append((f"{anuncio.barrio}, {anuncio.municipio}, España", True))
        if anuncio.municipio:
            intentos.append((f"{anuncio.municipio}, España", True))

        for consulta, aproximada in intentos:
            lat, lon = self.geocodificar(consulta)
            if lat is not None:
                anuncio.lat, anuncio.lon = lat, lon
                anuncio.coords_aproximadas = aproximada
                return
