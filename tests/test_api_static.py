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
