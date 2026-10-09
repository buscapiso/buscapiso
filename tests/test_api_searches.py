import json
import threading

import pytest
from fastapi.testclient import TestClient

from buscapiso import events
from buscapiso.api.app import create_app
from buscapiso.api.searches import SearchRunner
from buscapiso.pipeline import SearchResult


def fake_run(gate: threading.Event | None = None, fail: bool = False):
    def run(profile, options, db_path):
        events.emit("stage", "1/5 Crawling", step=1, total=5)
        if gate is not None:
            gate.wait(5)
        if fail:
            raise RuntimeError("browser closed")
        events.emit("stage", "5/5 Saving", step=5, total=5)
        return SearchResult(crawled=3, new_ids={"a"})
    return run


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("BUSCAPISO_HOME", str(tmp_path))
    return tmp_path


def client_with(runner, home):
    return TestClient(create_app(db_path=home / "pisos.db",
                                 static_dir=home / "no-dist", runner=runner))


def test_a_search_runs_and_ends_with_done(home):
    runner = SearchRunner(run=fake_run())
    c = client_with(runner, home)
    assert c.post("/api/searches", json={}).status_code == 202
    runner.wait(5)
    s = c.get("/api/searches/current").json()
    assert s["running"] is False
    assert [e["kind"] for e in s["events"]] == ["stage", "stage", "done"]
    assert s["summary"]["crawled"] == 3
    assert s["summary"]["new"] == 1


def test_only_one_search_at_a_time(home):
    gate = threading.Event()
    runner = SearchRunner(run=fake_run(gate))
    c = client_with(runner, home)
    assert c.post("/api/searches", json={}).status_code == 202
    assert c.post("/api/searches", json={}).status_code == 409
    gate.set()
    runner.wait(5)
    assert c.post("/api/searches", json={}).status_code == 202
    runner.wait(5)


def test_a_failing_search_ends_with_error_and_frees_the_runner(home):
    runner = SearchRunner(run=fake_run(fail=True))
    c = client_with(runner, home)
    c.post("/api/searches", json={})
    runner.wait(5)
    s = c.get("/api/searches/current").json()
    assert s["running"] is False
    assert s["events"][-1]["kind"] == "error"
    assert "browser closed" in s["events"][-1]["message"]
    assert c.post("/api/searches", json={}).status_code == 202
    runner.wait(5)


def test_the_stream_replays_past_events_and_stops_at_done(home):
    runner = SearchRunner(run=fake_run())
    c = client_with(runner, home)
    c.post("/api/searches", json={})
    runner.wait(5)
    with c.stream("GET", "/api/searches/current/stream") as r:
        cuerpo = "".join(r.iter_text())
    datos = [json.loads(l[6:]) for l in cuerpo.splitlines() if l.startswith("data: ")]
    assert [d["kind"] for d in datos] == ["stage", "stage", "done"]


def test_events_do_not_leak_into_the_global_sink(home, capsys):
    runner = SearchRunner(run=fake_run())
    client_with(runner, home).post("/api/searches", json={})
    runner.wait(5)
    assert "1/5 Crawling" not in capsys.readouterr().out


def test_state_before_any_search(home):
    s = client_with(SearchRunner(run=fake_run()), home).get("/api/searches/current").json()
    assert s == {"running": False, "id": None, "events": [], "summary": None}


def test_a_failed_run_does_not_poison_the_next_one(home):
    """Caso real de la revision: Playwright arrancado en el hilo de una busqueda
    que falla queda ligado a ese hilo muerto, y la siguiente busqueda revienta
    con 'cannot switch to a different thread'."""
    from buscapiso import navegador

    def run_que_falla(profile, options, db_path):
        navegador.playwright()
        raise RuntimeError("nothing crawled")

    def run_que_usa_playwright(profile, options, db_path):
        navegador.playwright().chromium     # en un Playwright de otro hilo, revienta
        return SearchResult()

    runner = SearchRunner(run=run_que_falla)
    c = client_with(runner, home)
    c.post("/api/searches", json={})
    runner.wait(30)
    assert navegador._PW is None, "la busqueda fallida debe cerrar Playwright"
    runner._run = run_que_usa_playwright
    c.post("/api/searches", json={})
    runner.wait(30)
    assert c.get("/api/searches/current").json()["events"][-1]["kind"] == "done"


def test_playwright_started_in_a_dead_thread_is_replaced():
    import threading
    from buscapiso import navegador
    viejo = []
    h = threading.Thread(target=lambda: viejo.append(navegador.playwright()))
    h.start(); h.join()
    nuevo = navegador.playwright()
    try:
        assert nuevo is not viejo[0]
    finally:
        navegador.cerrar_todo()


def test_the_after_hook_sees_every_finished_search(home):
    vistos = []
    runner = SearchRunner(run=fake_run(), after=vistos.append)
    client_with(runner, home).post("/api/searches", json={})
    runner.wait(5)
    assert len(vistos) == 1 and vistos[0].crawled == 3


def test_a_failing_after_hook_does_not_fail_the_search(home):
    def roto(r):
        raise RuntimeError("ntfy exploded")
    runner = SearchRunner(run=fake_run(), after=roto)
    c = client_with(runner, home)
    c.post("/api/searches", json={})
    runner.wait(5)
    assert c.get("/api/searches/current").json()["events"][-1]["kind"] == "done"
