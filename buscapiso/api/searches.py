"""Una busqueda en segundo plano, con sus eventos guardados para que el
navegador pueda engancharse (o volver a engancharse) en cualquier momento."""
from __future__ import annotations

import pathlib
import threading
import traceback
import uuid
from dataclasses import asdict
from typing import Callable

from buscapiso import almacen, events, navegador
from buscapiso.pipeline import SearchOptions, SearchResult, run_search
from buscapiso.profiles import SearchProfile, to_engine_cfg

Run = Callable[[SearchProfile, SearchOptions, pathlib.Path], SearchResult]


def run_profile(profile: SearchProfile, options: SearchOptions,
                db_path: pathlib.Path) -> SearchResult:
    cfg, zonas = to_engine_cfg(profile)
    # El hilo de la busqueda abre su propia conexion: sqlite3 no comparte
    # conexiones entre hilos.
    con = almacen.abrir(db_path)
    try:
        return run_search(cfg, zonas, options, con)
    finally:
        con.close()


class SearchRunner:
    def __init__(self, run: Run | None = None):
        self._run = run or run_profile
        self._cond = threading.Condition()
        self._thread: threading.Thread | None = None
        self._id: str | None = None
        self._events: list[dict] = []
        self._summary: dict | None = None
        self._running = False

    def _emit(self, event: events.Event) -> None:
        with self._cond:
            self._events.append(asdict(event))
            self._cond.notify_all()

    def start(self, profile: SearchProfile, options: SearchOptions,
              db_path: pathlib.Path) -> str:
        with self._cond:
            if self._running:
                raise RuntimeError("a search is already running")
            self._running = True
            self._id = uuid.uuid4().hex[:8]
            self._events, self._summary = [], None
        self._thread = threading.Thread(target=self._body, daemon=True,
                                        args=(profile, options, db_path))
        self._thread.start()
        return self._id

    def _body(self, profile, options, db_path) -> None:
        previous = events.set_sink(self._emit)
        try:
            r = self._run(profile, options, db_path)
            summary = {"accepted": len(r.accepted), "possible": len(r.possible),
                       "new": len(r.new_ids), "crawled": r.crawled}
            with self._cond:
                self._summary = summary
            events.emit("done", f"Done: {summary['new']} new listings", **summary)
        except Exception as e:      # noqa: BLE001 - el motivo va al usuario
            traceback.print_exc()
            events.emit("error", f"The search stopped: {e}")
        finally:
            # Siempre, tambien si fallo: un Playwright vivo en este hilo, que
            # muere ahora, envenenaria la siguiente busqueda.
            navegador.cerrar_todo()
            events.set_sink(previous)
            with self._cond:
                self._running = False
                self._cond.notify_all()

    def state(self) -> dict:
        with self._cond:
            return {"running": self._running, "id": self._id,
                    "events": list(self._events), "summary": self._summary}

    def events_since(self, n: int) -> tuple[list[dict], bool]:
        with self._cond:
            return list(self._events[n:]), self._running

    def wait(self, timeout: float) -> None:
        if self._thread is not None:
            self._thread.join(timeout)
