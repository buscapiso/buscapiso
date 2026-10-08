"""Esquema normalizado. Toda fuente devuelve esto y nada mas del sistema
necesita saber de que portal vino cada anuncio."""
from __future__ import annotations

import datetime as dt
import hashlib
from dataclasses import dataclass, field, asdict

GENERO_CHICAS = "chicas"
GENERO_MIXTO = "mixto"
GENERO_CHICOS = "chicos"
DESCONOCIDO = "desconocido"
GENERO_CUALQUIERA = "cualquiera"


@dataclass
class Anuncio:
    portal: str
    id_portal: str
    url: str
    titulo: str = ""
    precio: int | None = None
    gastos_extra: int | None = None      # None = el anuncio no lo dice
    direccion: str = ""
    barrio: str = ""
    municipio: str = ""
    lat: float | None = None
    lon: float | None = None
    coords_aproximadas: bool = True
    genero_piso: str = DESCONOCIDO
    genero_confirmado: bool = False   # False = inferido del texto libre
    habitaciones: int | None = None
    companeros: int | None = None
    fumar_permitido: bool | None = None
    propietario_vive: bool | None = None
    visitas_permitidas: bool | None = None
    publicado_texto: str = ""
    # Dias desde la publicacion cuando el portal lo dice. publicado_texto no
    # sirve para esto: en idealista solo aparece si el anuncio es reciente,
    # en fotocasa aparece siempre y puede decir "hace 602 dias".
    antiguedad_dias: int | None = None
    # Solo disponibles tras leer la ficha
    edad_companeros: str = ""
    ocupacion_companeros: str = ""
    ambiente: str = ""
    admite_parejas: bool | None = None
    exterior: bool | None = None
    estancia_minima_meses: int | None = None
    disponible_desde: str = ""
    descripcion: str = ""
    foto: str = ""
    ficha_leida: bool = False
    descripcion_extra: str = ""   # avisos del portal (alquiler temporal, etc.)

    # Calculados despues
    trayectos: dict[str, float] = field(default_factory=dict)  # minutos por destino
    rutas: dict[str, str] = field(default_factory=dict)        # detalle por destino
    trayectos_fuente: str = "graph"   # "graph" o el proveedor
    puntuacion: float = 0.0
    motivos: list[str] = field(default_factory=list)
    visto_por_primera_vez: str = ""
    tambien_en: list[str] = field(default_factory=list)   # otros portales

    @property
    def id(self) -> str:
        """Identificador estable entre ejecuciones y entre portales."""
        return hashlib.sha1(f"{self.portal}:{self.id_portal}".encode()).hexdigest()[:12]

    @property
    def coste_total(self) -> int | None:
        """Lo que pagas de verdad al mes. Un anuncio de 490 + 150 de gastos
        es mas caro que uno de 550 con todo incluido."""
        if self.precio is None:
            return None
        return self.precio + (self.gastos_extra or 0)

    def coste_estimado(self, gastos_por_defecto: int) -> int | None:
        """Lo que pagarias de verdad, suponiendo gastos cuando no se declaran.

        El anuncio que calla sus gastos no debe adelantar al que los declara
        solo por callarlos: un dato ausente codificado como cero convierte el
        silencio en ventaja. coste_total sigue siendo el dato factual; esto es
        lo que usa la puntuacion.
        """
        if self.precio is None:
            return None
        gastos = self.gastos_extra if self.gastos_extra is not None else gastos_por_defecto
        return self.precio + gastos

    @property
    def gastos_incluidos(self) -> bool:
        return self.gastos_extra == 0

    @property
    def riqueza(self) -> int:
        """Cuantos campos utiles trae. Decide cual gana al deduplicar."""
        campos = (self.lat, self.descripcion, self.foto, self.companeros,
                  self.habitaciones, self.gastos_extra, self.edad_companeros,
                  self.disponible_desde, self.admite_parejas)
        puntos = sum(1 for c in campos if c not in (None, "", []))
        return puntos + (3 if self.genero_confirmado else 0)

    def como_dict(self) -> dict:
        d = asdict(self)
        d["id"] = self.id
        d["coste_total"] = self.coste_total
        return d
