"""Motor de rutas en transporte publico sobre la red de datos/red.json.

Por que un Dijkstra casero y no la API de Google Directions:
el ranking solo necesita ORDENAR bien los pisos, no cronometrarlos. Un grafo
de 116 estaciones con tiempos medios da un error de unos +-4 min, que es menos
que la varianza real del metro, y no depende de ninguna clave de API ni cuota.
"""
from __future__ import annotations

import heapq
import json
import math
import pathlib
from dataclasses import dataclass, field

RUTA_RED = pathlib.Path(__file__).parent / "datos" / "red.json"

VELOCIDAD_ANDANDO_M_MIN = 75.0   # 4,5 km/h
FACTOR_RODEO = 1.3               # la calle no va en linea recta
RADIO_ANDANDO_M = 1200.0         # hasta donde se considera "ir andando a la parada"
INTERCAMBIO_MIN = 2.0            # andar dentro de la estacion al cambiar de linea
INTERCAMBIO_CALLE_M = 400.0      # dos estaciones distintas pero pegadas
INTERCAMBIO_CALLE_MIN = 1.5      # recargo por salir a la calle para cambiar


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distancia en linea recta sobre la superficie terrestre, en metros."""
    R = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def minutos_andando(metros: float) -> float:
    """Minutos a pie, corrigiendo la linea recta por el rodeo real de las calles."""
    return metros * FACTOR_RODEO / VELOCIDAD_ANDANDO_M_MIN


@dataclass
class Ruta:
    minutos: float
    estacion_origen: str | None
    minutos_andando: float
    lineas: list[str]
    transbordos: int
    detalle: str = ""

    def __str__(self) -> str:
        return self.detalle


@dataclass
class Red:
    lineas: dict
    estaciones: dict
    _aristas: dict = field(default_factory=dict, repr=False)

    @classmethod
    def cargar(cls, ruta: pathlib.Path = RUTA_RED) -> "Red":
        datos = json.loads(pathlib.Path(ruta).read_text())
        red = cls(lineas=datos["lineas"], estaciones=datos["estaciones"])
        red._construir_aristas()
        return red

    # --- construccion del grafo -------------------------------------------
    # Un nodo es (estacion, linea): "voy en el tren de esa linea, parado ahi".
    # Asi el transbordo es una arista explicita con su coste, en vez de algo
    # implicito que luego no sabes contar.
    def _construir_aristas(self) -> None:
        ar: dict[tuple, list[tuple]] = {}

        def arista(a, b, coste):
            ar.setdefault(a, []).append((b, coste))

        for linea, datos in self.lineas.items():
            ests = datos["estaciones"]
            hop = datos["hop_min"]
            for i in range(len(ests) - 1):
                a, b = (ests[i], linea), (ests[i + 1], linea)
                arista(a, b, hop)
                arista(b, a, hop)

        # Transbordo dentro de la misma estacion.
        for nombre, est in self.estaciones.items():
            for l1 in est["lineas"]:
                for l2 in est["lineas"]:
                    if l1 != l2:
                        espera = self.lineas[l2]["frecuencia_min"] / 2
                        arista((nombre, l1), (nombre, l2), INTERCAMBIO_MIN + espera)

        # Transbordo a pie entre estaciones distintas pero cercanas.
        nombres = list(self.estaciones)
        for i, n1 in enumerate(nombres):
            e1 = self.estaciones[n1]
            for n2 in nombres[i + 1:]:
                e2 = self.estaciones[n2]
                d = haversine_m(e1["lat"], e1["lon"], e2["lat"], e2["lon"])
                if d > INTERCAMBIO_CALLE_M:
                    continue
                andar = minutos_andando(d) + INTERCAMBIO_CALLE_MIN
                for l1 in e1["lineas"]:
                    for l2 in e2["lineas"]:
                        arista((n1, l1), (n2, l2),
                               andar + self.lineas[l2]["frecuencia_min"] / 2)
                        arista((n2, l2), (n1, l1),
                               andar + self.lineas[l1]["frecuencia_min"] / 2)
        self._aristas = ar

    # --- consulta ----------------------------------------------------------
    def estaciones_cercanas(self, lat: float, lon: float,
                            radio_m: float = RADIO_ANDANDO_M) -> list[tuple[str, float]]:
        """Estaciones a distancia andable, de mas cerca a mas lejos."""
        cerca = []
        for nombre, est in self.estaciones.items():
            d = haversine_m(lat, lon, est["lat"], est["lon"])
            if d <= radio_m:
                cerca.append((nombre, d))
        cerca.sort(key=lambda x: x[1])
        return cerca

    def _dijkstra(self, lat: float, lon: float,
                  radio_m: float) -> tuple[dict, dict]:
        """Coste minimo desde unas coordenadas hasta cada nodo (estacion, linea).

        Multi-origen: el coste inicial de cada nodo es andar hasta esa
        estacion + media frecuencia de espera.
        """
        dist: dict[tuple, float] = {}
        previo: dict[tuple, tuple | None] = {}
        cola: list[tuple[float, tuple]] = []
        for nombre, d in self.estaciones_cercanas(lat, lon, radio_m):
            andar = minutos_andando(d)
            for linea in self.estaciones[nombre]["lineas"]:
                nodo = (nombre, linea)
                coste = andar + self.lineas[linea]["frecuencia_min"] / 2
                if coste < dist.get(nodo, math.inf):
                    dist[nodo] = coste
                    previo[nodo] = None
                    heapq.heappush(cola, (coste, nodo))
        while cola:
            coste, nodo = heapq.heappop(cola)
            if coste > dist.get(nodo, math.inf):
                continue
            for vecino, peso in self._aristas.get(nodo, ()):
                nuevo = coste + peso
                if nuevo < dist.get(vecino, math.inf):
                    dist[vecino] = nuevo
                    previo[vecino] = nodo
                    heapq.heappush(cola, (nuevo, vecino))
        return dist, previo

    def _ruta(self, lat: float, lon: float, final: tuple, previo: dict,
              minutos: float, andar_final: float = 0.0) -> Ruta:
        camino = []
        n = final
        while n is not None:
            camino.append(n)
            n = previo.get(n)
        camino.reverse()
        lineas_usadas: list[str] = []
        for _est, linea in camino:
            if not lineas_usadas or lineas_usadas[-1] != linea:
                lineas_usadas.append(linea)
        origen = camino[0][0]
        andar = minutos_andando(haversine_m(lat, lon, self.estaciones[origen]["lat"],
                                            self.estaciones[origen]["lon"]))
        transbordos = len(lineas_usadas) - 1
        tramo_final = (f" + {andar_final:.0f} min andando desde {final[0]}"
                       if andar_final >= 1 else "")
        return Ruta(
            minutos=minutos,
            estacion_origen=origen,
            minutos_andando=andar + andar_final,
            lineas=lineas_usadas,
            transbordos=transbordos,
            detalle=(f"{andar:.0f} min a {origen} + {' > '.join(lineas_usadas)} "
                     f"({transbordos} transbordo{'s' if transbordos != 1 else ''})"
                     f"{tramo_final} = {minutos:.0f} min"),
        )

    @staticmethod
    def _solo_andando(metros: float) -> Ruta:
        m = minutos_andando(metros)
        return Ruta(m, None, m, [], 0, f"{m:.0f} min andando")

    def ruta_desde(self, lat: float, lon: float, destino: str,
                   radio_m: float = RADIO_ANDANDO_M) -> Ruta | None:
        """Ruta mas rapida desde unas coordenadas hasta una estacion.

        Devuelve None si no hay ninguna estacion a distancia andable.
        """
        if destino not in self.estaciones:
            raise KeyError(f"estacion desconocida: {destino}")
        dest = self.estaciones[destino]
        return self.ruta_a_punto(lat, lon, dest["lat"], dest["lon"], radio_m,
                                 _solo_estacion=destino)

    def ruta_a_punto(self, lat: float, lon: float, dlat: float, dlon: float,
                     radio_m: float = RADIO_ANDANDO_M,
                     _solo_estacion: str | None = None) -> Ruta | None:
        """Ruta mas rapida desde unas coordenadas hasta otras cualesquiera.

        Se llega en tren a alguna estacion cercana al destino y se anda el
        resto. Devuelve None si no hay forma razonable de llegar: sin
        estacion andable en un extremo y demasiado lejos para ir a pie.
        """
        directo = haversine_m(lat, lon, dlat, dlon)
        mejor = self._solo_andando(directo)
        origenes = self.estaciones_cercanas(lat, lon, radio_m)
        if _solo_estacion is not None:
            llegadas = [(_solo_estacion, 0.0)]
        else:
            llegadas = self.estaciones_cercanas(dlat, dlon, radio_m)
        if not origenes or not llegadas:
            return mejor if directo <= radio_m else None

        dist, previo = self._dijkstra(lat, lon, radio_m)
        for nombre, metros in llegadas:
            andar_final = minutos_andando(metros)
            for linea in self.estaciones[nombre]["lineas"]:
                nodo = (nombre, linea)
                if nodo not in dist:
                    continue
                total = dist[nodo] + andar_final
                if total < mejor.minutos:
                    mejor = self._ruta(lat, lon, nodo, previo, total, andar_final)
        return mejor
