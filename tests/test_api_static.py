from fastapi.testclient import TestClient

from buscapiso.api.app import create_app


def test_without_a_build_the_root_explains_what_to_do(tmp_path):
    c = TestClient(create_app(db_path=tmp_path / "p.db", static_dir=tmp_path / "nope"))
    r = c.get("/")
    assert r.status_code == 200
    assert "npm --prefix web run build" in r.json()["hint"]


def test_with_a_build_the_root_serves_the_app(tmp_path):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html><title>buscapiso</title>")
    c = TestClient(create_app(db_path=tmp_path / "p.db", static_dir=dist))
    assert "<title>buscapiso</title>" in c.get("/").text
    assert c.get("/api/meta").status_code == 200


def test_serve_is_a_cli_command():
    from buscapiso import cli
    import pytest
    with pytest.raises(SystemExit) as e:
        cli.main(["serve", "--help"])
    assert e.value.code == 0


def test_serve_defaults_to_port_8770(monkeypatch):
    """8765 lo usa otro programa de la usuaria (tds_stats)."""
    import uvicorn
    from buscapiso import cli
    llamadas = []
    monkeypatch.setattr(uvicorn, "run", lambda app, **kw: llamadas.append(kw))
    assert cli.main(["serve", "--no-open"]) == 0
    assert llamadas[0]["port"] == 8770
    assert llamadas[0]["host"] == "127.0.0.1"


def test_serve_on_a_busy_port_explains_and_opens_nothing(monkeypatch, capsys):
    import socket
    import uvicorn
    import webbrowser
    from buscapiso import cli
    monkeypatch.setattr(uvicorn, "run", lambda *a, **k: (_ for _ in ()).throw(AssertionError("no")))
    abiertos = []
    monkeypatch.setattr(webbrowser, "open", abiertos.append)
    with socket.socket() as ocupado:
        ocupado.bind(("127.0.0.1", 0))
        ocupado.listen()
        puerto = ocupado.getsockname()[1]
        assert cli.main(["serve", "--port", str(puerto)]) == 2
    assert "--port" in capsys.readouterr().out
    assert abiertos == []


def test_serve_lan_listens_everywhere_and_protects_the_api(monkeypatch, tmp_path, capsys):
    import uvicorn
    from buscapiso import cli
    monkeypatch.setenv("BUSCAPISO_HOME", str(tmp_path))
    llamadas = []
    monkeypatch.setattr(uvicorn, "run", lambda app, **kw: llamadas.append((app, kw)))
    assert cli.main(["serve", "--lan", "--no-open", "--port", "8797"]) == 0
    app, kw = llamadas[0]
    assert kw["host"] == "0.0.0.0" and app.state.lan is True and app.state.port == 8797
    assert "/?t=" in capsys.readouterr().out


def test_quit_only_from_the_computer(tmp_path):
    from buscapiso.api.app import create_app
    paradas = []
    app = create_app(db_path=tmp_path / "p.db", static_dir=tmp_path / "x", require_token=True,
                     on_quit=lambda: paradas.append(1))
    assert TestClient(app, client=("192.168.1.50", 5000)).post(
        "/api/quit", headers={"X-Buscapiso-Token": "x"}).status_code in (401, 403)
    assert TestClient(app).post("/api/quit").json() == {"bye": True}
    assert paradas == [1]


def test_a_second_launch_opens_the_running_app(monkeypatch, capsys):
    import socket
    import webbrowser
    from buscapiso import cli
    abiertos = []
    monkeypatch.setattr(webbrowser, "open", abiertos.append)
    monkeypatch.setattr(cli, "_es_buscapiso", lambda port: True)
    with socket.socket() as ocupado:
        ocupado.bind(("127.0.0.1", 0)); ocupado.listen()
        puerto = ocupado.getsockname()[1]
        assert cli.main(["serve", "--port", str(puerto)]) == 0
    assert abiertos == [f"http://127.0.0.1:{puerto}/"]
    assert "already open" in capsys.readouterr().out


def test_the_packaged_app_serves_when_run_without_arguments(monkeypatch):
    import sys
    from buscapiso import cli
    llamadas = []
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(cli, "cmd_serve", lambda args: llamadas.append(args) or 0)
    assert cli.main([]) == 0
    assert llamadas and llamadas[0].lan is False and llamadas[0].no_open is False
