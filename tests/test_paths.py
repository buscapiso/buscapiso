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
