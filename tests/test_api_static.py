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
