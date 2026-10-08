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

    def ruta_desde(self, lat: float, lon: float, destino: str,
                   radio_m: float = RADIO_ANDANDO_M) -> Ruta | None:
        """Ruta mas rapida desde unas coordenadas hasta una estacion.

        Devuelve None si no hay ninguna estacion a distancia andable.
        """
        if destino not in self.estaciones:
            raise KeyError(f"estacion desconocida: {destino}")

        dest = self.estaciones[destino]
        d_directa = haversine_m(lat, lon, dest["lat"], dest["lon"])
        mejor = Ruta(minutos_andando(d_directa), None, minutos_andando(d_directa),
                     [], 0, f"{minutos_andando(d_directa):.0f} min andando")
        hay_origen = d_directa <= radio_m

        origenes = self.estaciones_cercanas(lat, lon, radio_m)
        if not origenes and not hay_origen:
            return None

        # Dijkstra multi-origen: el coste inicial de cada nodo es
        # andar hasta esa estacion + media frecuencia de espera.
        dist: dict[tuple, float] = {}
        previo: dict[tuple, tuple | None] = {}
        cola: list[tuple[float, tuple]] = []
        for nombre, d in origenes:
            andar = minutos_andando(d)
            for linea in self.estaciones[nombre]["lineas"]:
                nodo = (nombre, linea)
                coste = andar + self.lineas[linea]["frecuencia_min"] / 2
                if coste < dist.get(nodo, math.inf):
                    dist[nodo] = coste
                    previo[nodo] = None
                    heapq.heappush(cola, (coste, nodo))

        final = None
        while cola:
            coste, nodo = heapq.heappop(cola)
            if coste > dist.get(nodo, math.inf):
                continue
            if nodo[0] == destino:
                final = nodo
                break
            for vecino, peso in self._aristas.get(nodo, ()):
                nuevo = coste + peso
                if nuevo < dist.get(vecino, math.inf):
                    dist[vecino] = nuevo
                    previo[vecino] = nodo
                    heapq.heappush(cola, (nuevo, vecino))

        if final is not None and dist[final] < mejor.minutos:
            camino = []
            n = final
            while n is not None:
                camino.append(n)
                n = previo.get(n)
            camino.reverse()
            lineas_usadas = []
            for est, linea in camino:
                if not lineas_usadas or lineas_usadas[-1] != linea:
                    lineas_usadas.append(linea)
            origen_nombre = camino[0][0]
            andar = minutos_andando(
                haversine_m(lat, lon, self.estaciones[origen_nombre]["lat"],
                            self.estaciones[origen_nombre]["lon"]))
            mejor = Ruta(
                minutos=dist[final],
                estacion_origen=origen_nombre,
                minutos_andando=andar,
                lineas=lineas_usadas,
                transbordos=len(lineas_usadas) - 1,
                detalle=(f"{andar:.0f} min a {origen_nombre} + "
                         f"{' > '.join(lineas_usadas)} "
                         f"({len(lineas_usadas) - 1} transbordo"
                         f"{'s' if len(lineas_usadas) != 2 else ''}) = "
                         f"{dist[final]:.0f} min"),
            )
        return mejor
