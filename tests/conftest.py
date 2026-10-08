import pytest


@pytest.fixture(autouse=True)
def _datos_aislados(tmp_path_factory, monkeypatch):
    """Ningun test toca la pisos.db real ni la cache de la usuaria: por defecto,
    BUSCAPISO_HOME apunta a un directorio temporal. Los tests que necesitan
    otro lo cambian con su propio monkeypatch, y el de la ruta por defecto lo
    borra explicitamente."""
    monkeypatch.setenv("BUSCAPISO_HOME", str(tmp_path_factory.mktemp("home")))
