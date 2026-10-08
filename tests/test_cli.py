import argparse
import json
import pathlib
import shutil

import pytest

from buscapiso import almacen, cli
from buscapiso.modelo import Anuncio
from buscapiso.profiles import Budget, Destination, SearchProfile

RAIZ = pathlib.Path(__file__).resolve().parents[1]


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("BUSCAPISO_HOME", str(tmp_path))
    shutil.copy(RAIZ / "config.yaml", tmp_path)
    shutil.copy(RAIZ / "zonas.yaml", tmp_path)
    return tmp_path


def test_first_run_seeds_a_default_profile_from_config_yaml(home, capsys):
    assert cli.main(["profile", "list"]) == 0
    out = capsys.readouterr().out
    assert "default *" in out
    perfil = almacen.cargar_perfil(almacen.abrir(home / "pisos.db"))
    assert perfil.destinations[0].name == "Fira"


def test_without_config_yaml_the_default_profile_is_neutral(tmp_path, monkeypatch):
    monkeypatch.setenv("BUSCAPISO_HOME", str(tmp_path))
    cli.main(["profile", "list"])
    perfil = almacen.cargar_perfil(almacen.abrir(tmp_path / "pisos.db"))
    assert perfil == SearchProfile(name="default")


def test_old_spanish_commands_still_work(home, capsys):
    con = almacen.abrir(home / "pisos.db")
    x = Anuncio(portal="idealista", id_portal="1", url="https://x/1", precio=500)
    almacen.registrar(con, [x])
    assert cli.main(["marcar", x.id, "contactado", "escrito el lunes"]) == 0
    assert almacen.estado_de(con, x.id) == "contacted"
    assert cli.main(["estados"]) == 0
    assert "contacted" in capsys.readouterr().out


def test_profiles_export_and_import(home, tmp_path):
    cli.main(["profile", "list"])
    fichero = tmp_path / "p.json"
    assert cli.main(["profile", "export", "default", str(fichero)]) == 0
    datos = json.loads(fichero.read_text())
    datos["name"] = "amiga"
    fichero.write_text(json.dumps(datos))
    assert cli.main(["profile", "import", str(fichero), "--use"]) == 0
    assert almacen.cargar_perfil(almacen.abrir(home / "pisos.db")).name == "amiga"


def test_importing_an_invalid_profile_fails_cleanly(home, tmp_path, capsys):
    fichero = tmp_path / "malo.json"
    fichero.write_text(json.dumps({"name": "x", "sources": []}))
    assert cli.main(["profile", "import", str(fichero)]) == 2
    assert "sources" in capsys.readouterr().out


def _args(**kw):
    base = dict(solo_nuevos=False, presupuesto=None, fuentes=None, paginas=None,
                max_minutos=None)
    base.update(kw)
    return argparse.Namespace(**base)


def test_max_minutes_changes_the_first_limited_destination():
    p = SearchProfile(name="x", destinations=[
        Destination(name="Gym", lat=41.38, lon=2.17),
        Destination(name="Work", lat=41.35, lon=2.13, max_minutes=30)])
    q = cli.apply_overrides(p, _args(max_minutos=45))
    assert q.destinations[1].max_minutes == 45
    assert p.destinations[1].max_minutes == 30          # el original no cambia


def test_max_minutes_without_a_limited_destination_is_an_error():
    with pytest.raises(SystemExit):
        cli.apply_overrides(SearchProfile(name="x"), _args(max_minutos=45))


def test_a_budget_below_the_ideal_lowers_the_ideal():
    p = SearchProfile(name="x", budget=Budget(ideal_total=500, max_total=650))
    q = cli.apply_overrides(p, _args(presupuesto=400))
    assert (q.budget.ideal_total, q.budget.max_total) == (400, 400)


def test_an_out_of_range_override_is_a_clean_error(home, capsys):
    assert cli.main(["--paginas", "25", "--desde-cache", "--offline", "--no-abrir"]) == 2
    assert "max_pages" in capsys.readouterr().out
