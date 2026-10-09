import pytest


@pytest.fixture(autouse=True)
def _datos_aislados(tmp_path_factory, monkeypatch):
    """Ningun test toca la pisos.db real ni la cache de la usuaria: por defecto,
    BUSCAPISO_HOME apunta a un directorio temporal. Los tests que necesitan
    otro lo cambian con su propio monkeypatch, y el de la ruta por defecto lo
    borra explicitamente."""
    monkeypatch.setenv("BUSCAPISO_HOME", str(tmp_path_factory.mktemp("home")))


@pytest.fixture(autouse=True)
def _sin_rastreo_real(monkeypatch, request):
    """Ningun test abre el Chromium del rastreo ni visita los portales. Un test
    que llamaba al CLI sin argumentos lanzo una vez una busqueda real (ventanas
    visibles en el escritorio). Las pruebas e2e usan su propio Chromium oculto
    con sync_playwright y no pasan por aqui."""
    if request.node.get_closest_marker("playwright_driver"):
        return                  # arranca el driver, nunca un navegador
    def prohibido(*a, **k):
        raise RuntimeError("tests must not start the crawler browser")
    monkeypatch.setattr("buscapiso.navegador.playwright", prohibido)
