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

    def seleccionar(self, minutos_max: float, red, destino: str,
                    margen_minutos: float = MARGEN_MINUTOS) -> list[dict]:
        """Zonas alcanzables, de mas cerca a mas lejos.

        Nunca devuelve vacio: con un limite absurdo, la busqueda se quedaria
        sin hacer nada y sin decir por que, asi que se conserva la mas cercana.
        """
        con_tiempo = []
        for z in self.zonas:
            ruta = red.ruta_desde(z["lat"], z["lon"], destino)
            if ruta is None:
                continue
            con_tiempo.append({**z, "minutos": ruta.minutos})
        con_tiempo.sort(key=lambda z: z["minutos"])

        dentro = [z for z in con_tiempo
                  if z["minutos"] <= minutos_max + margen_minutos]
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
