"""Busquedas automaticas cada pocas horas, mientras el servidor esta abierto.

Solo dentro de la franja horaria elegida y nunca encima de otra busqueda: la
ventana de Chromium aparece al buscar, y a las 3 de la madrugada no la quiere
nadie. Un fallo al lanzar no para el programador; se reintenta en el siguiente
turno que toque.
"""
from __future__ import annotations

import datetime as dt
import threading
import time
import traceback
from typing import Callable

from buscapiso import almacen

MIN_HOURS = 2


def _hora(hhmm: str) -> dt.time:
    h, m = (int(x) for x in hhmm.split(":"))
    return dt.time(h, m)


def dentro_de_franja(ahora: dt.time, desde: str, hasta: str) -> bool:
    a, b = _hora(desde), _hora(hasta)
    return a <= ahora <= b if a <= b else (ahora >= a or ahora <= b)   # franja que cruza medianoche


class Scheduler:
    def __init__(self, db_path, start: Callable[[], None], is_running: Callable[[], bool],
                 now: Callable[[], dt.datetime] = dt.datetime.now):
        self.db_path, self.start, self.is_running, self.now = db_path, start, is_running, now

    def tick(self) -> str:
        con = almacen.abrir(self.db_path)
        try:
            a = almacen.leer_ajustes(con)
            horas = int(a.get("schedule_hours", "0") or 0)
            if not horas:
                return "off"
            ahora = self.now()
            if not dentro_de_franja(ahora.time(), a.get("schedule_from", "08:00"),
                                    a.get("schedule_to", "23:00")):
                return "outside_hours"
            ultima = a.get("schedule_last_run")
            if ultima and ahora - dt.datetime.fromisoformat(ultima) < dt.timedelta(hours=horas):
                return "not_due"
            if self.is_running():
                return "busy"
            # Se apunta antes de lanzar: si falla, no se reintenta cada minuto.
            almacen.guardar_ajuste(con, "schedule_last_run", ahora.isoformat(timespec="minutes"))
            try:
                self.start()
            except Exception:       # noqa: BLE001 - el programador no debe morir
                traceback.print_exc()
                return "failed"
            return "started"
        finally:
            con.close()

    def run_forever(self, every: float = 60.0) -> None:
        while True:
            try:
                self.tick()
            except Exception:       # noqa: BLE001
                traceback.print_exc()
            time.sleep(every)

    def start_thread(self) -> threading.Thread:
        h = threading.Thread(target=self.run_forever, daemon=True, name="buscapiso-scheduler")
        h.start()
        return h
