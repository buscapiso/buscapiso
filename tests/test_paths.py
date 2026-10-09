import pathlib

from buscapiso import paths

RAIZ = pathlib.Path(__file__).resolve().parents[1]


def test_data_dir_defaults_to_repo_root(monkeypatch):
    monkeypatch.delenv("BUSCAPISO_HOME", raising=False)
    assert paths.data_dir() == RAIZ


def test_everything_moves_with_buscapiso_home(monkeypatch, tmp_path):
    monkeypatch.setenv("BUSCAPISO_HOME", str(tmp_path))
    assert paths.data_dir() == tmp_path
    assert paths.db_path() == tmp_path / "pisos.db"
    assert paths.cache_dir() == tmp_path / "cache"
    assert paths.report_path() == tmp_path / "informe.html"
    assert paths.browser_profile("chrome") == tmp_path / ".perfil-chrome"


def test_an_installed_app_keeps_its_data_in_the_user_folder(monkeypatch, tmp_path):
    import platformdirs
    monkeypatch.delenv("BUSCAPISO_HOME", raising=False)
    monkeypatch.setattr(paths, "_desde_codigo_fuente", lambda: False)
    monkeypatch.setattr(platformdirs, "user_data_dir", lambda app, appauthor=False: str(tmp_path / app))
    assert paths.data_dir() == tmp_path / "buscapiso"
    assert paths.data_dir().is_dir()                        # se crea si no existe


def test_running_from_the_source_keeps_the_repo_folder(monkeypatch):
    monkeypatch.delenv("BUSCAPISO_HOME", raising=False)
    assert paths._desde_codigo_fuente() is True
    assert paths.data_dir() == RAIZ
