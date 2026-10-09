"""Elige que zonas rastrear a partir del limite de tiempo al trabajo.

Antes la lista estaba escrita a mano en config.yaml, y eso hacia que
--max-minutos mintiera: relajaba el filtro de aceptacion pero no visitaba
ninguna zona nueva, asi que once zonas dentro del limite (el Eixample y Gracia
entre ellas) no se miraban nunca.
"""
from __future__ import annotations

import json
import pathlib
from dataclasses import dataclass

RUTA = pathlib.Path(__file__).parent / "datos" / "zonas.json"

# Un distrito mide kilometros: se compara su centroide, pero su parte mas
# cercana puede estar bastante mas cerca que el centro.
MARGEN_MINUTOS = 10


@dataclass
class Catalogo:
    zonas: list
    fotocasa_ciudad: str

    @classmethod
    def cargar(cls, ruta: pathlib.Path = RUTA) -> "Catalogo":
        d = json.loads(pathlib.Path(ruta).read_text(encoding="utf-8"))
        return cls(zonas=d["zonas"], fotocasa_ciudad=d["fotocasa_ciudad"])

    def seleccionar(self, destinos: list[dict], red,
                    margen_minutos: float = MARGEN_MINUTOS) -> list[dict]:
        """Zonas desde las que se llega a tiempo a todos los destinos con limite,
        de mas holgada a menos.

        Sin destinos con limite no hay nada que recortar: se rastrea todo.
        Con limites, nunca devuelve vacio salvo que ninguna zona tenga ruta:
        con un limite absurdo la busqueda se quedaria sin hacer nada y sin
        decir por que, asi que se conserva la mas cercana.
        """
        limitados = [d for d in destinos if d.get("max_minutos") is not None]
        if not limitados:
            return [{**z, "minutos": None} for z in self.zonas]
        con_tiempo = []
        for z in self.zonas:
            tiempos = []
            for d in limitados:
                ruta = red.ruta_a_punto(z["lat"], z["lon"], d["lat"], d["lon"])
                if ruta is None:
                    break
                tiempos.append((ruta.minutos, d["max_minutos"]))
            else:
                exceso = max(m - tope for m, tope in tiempos)
                con_tiempo.append({**z, "minutos": tiempos[0][0], "exceso": exceso})
        con_tiempo.sort(key=lambda z: z["exceso"])
        dentro = [z for z in con_tiempo if z["exceso"] <= margen_minutos]
        return dentro or con_tiempo[:1]

    def slugs(self, zonas: list[dict], portal: str) -> list[str]:
        """Slugs de ese portal, sin huecos ni repeticiones.

        Fotocasa cubre todos los distritos de Barcelona con una sola busqueda,
        asi que los distritos se colapsan en una entrada.
        """
        salida: list[str] = []
        ciudad_puesta = False
        for z in zonas:
            if portal == "fotocasa" and z["nombre"].endswith(", Barcelona"):
                if not ciudad_puesta:
                    salida.append(self.fotocasa_ciudad)
                    ciudad_puesta = True
                continue
            slug = z.get(portal)
            if slug and slug not in salida:
                salida.append(slug)
        return salida
