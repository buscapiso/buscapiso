import datetime as dt

import pytest
from fastapi.testclient import TestClient

from buscapiso import almacen
from buscapiso.api.app import create_app
from buscapiso.api.scheduler import Scheduler


class Reloj:
    def __init__(self, cuando):
        self.cuando = cuando

    def __call__(self):
        return self.cuando


@pytest.fixture
def ctx(tmp_path):
    db = tmp_path / "p.db"
    almacen.abrir(db).close()
    lanzadas = []
    estado = {"ocupado": False, "falla": False}

    def start():
        if estado["falla"]:
            raise RuntimeError("profile broken")
        lanzadas.append(1)

    reloj = Reloj(dt.datetime(2026, 10, 13, 9, 0))
    s = Scheduler(db, start=start, is_running=lambda: estado["ocupado"], now=reloj)
    return s, db, lanzadas, estado, reloj


def ajustar(db, **kw):
    con = almacen.abrir(db)
    for k, v in kw.items():
        almacen.guardar_ajuste(con, k, v)
    con.close()


def test_off_by_default(ctx):
    s, _, lanzadas, _, _ = ctx
    assert s.tick() == "off" and lanzadas == []


def test_runs_when_due_and_then_waits(ctx):
    s, db, lanzadas, _, reloj = ctx
    ajustar(db, schedule_hours="3")
    assert s.tick() == "started"
    reloj.cuando += dt.timedelta(hours=2)
    assert s.tick() == "not_due"
    reloj.cuando += dt.timedelta(hours=1, minutes=1)
    assert s.tick() == "started"
    assert len(lanzadas) == 2


def test_respects_the_hours(ctx):
    s, db, lanzadas, _, reloj = ctx
    ajustar(db, schedule_hours="3", schedule_from="08:00", schedule_to="23:00")
    reloj.cuando = dt.datetime(2026, 10, 13, 3, 0)
    assert s.tick() == "outside_hours" and lanzadas == []


def test_never_overlaps_a_running_search(ctx):
    s, db, lanzadas, estado, _ = ctx
    ajustar(db, schedule_hours="3")
    estado["ocupado"] = True
    assert s.tick() == "busy" and lanzadas == []


def test_a_failing_start_does_not_stop_the_scheduler(ctx):
    s, db, lanzadas, estado, reloj = ctx
    ajustar(db, schedule_hours="3")
    estado["falla"] = True
    assert s.tick() == "failed"
    estado["falla"] = False
    reloj.cuando += dt.timedelta(hours=3, minutes=1)
    assert s.tick() == "started"


def test_schedule_api_validates_hours(tmp_path, monkeypatch):
    monkeypatch.setenv("BUSCAPISO_HOME", str(tmp_path))
    c = TestClient(create_app(db_path=tmp_path / "p.db", static_dir=tmp_path / "x"))
    assert c.get("/api/schedule").json() == {"hours": 0, "from": "08:00", "to": "23:00",
                                             "last_run": None}
    assert c.put("/api/schedule", json={"hours": 1}).status_code == 422
    r = c.put("/api/schedule", json={"hours": 4, "from": "09:00", "to": "22:00"})
    assert r.json()["hours"] == 4 and r.json()["from"] == "09:00"
