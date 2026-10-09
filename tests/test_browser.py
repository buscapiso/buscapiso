import time

from fastapi.testclient import TestClient

from buscapiso import browser
from buscapiso.api.app import create_app


class FakeBrowser:
    def __init__(self, falla=False):
        self.ok, self.falla = False, falla

    def installed(self):
        return self.ok

    def install(self, on_line):
        on_line("Downloading Chromium 150 MB")
        if self.falla:
            raise RuntimeError("no disk space")
        on_line("100%")
        self.ok = True


def esperar(c, cond, n=50):
    for _ in range(n):
        s = c.get("/api/browser").json()
        if cond(s):
            return s
        time.sleep(0.05)
    raise AssertionError(s)


def test_missing_browser_is_reported_and_installed(tmp_path):
    fb = FakeBrowser()
    c = TestClient(create_app(db_path=tmp_path / "p.db", static_dir=tmp_path / "x", browser=fb))
    assert c.get("/api/browser").json() == {"installed": False, "installing": False, "log": [], "error": None}
    assert c.post("/api/browser/install").status_code == 202
    s = esperar(c, lambda s: not s["installing"])
    assert s["installed"] is True and "100%" in s["log"]


def test_a_failed_install_shows_the_error(tmp_path):
    c = TestClient(create_app(db_path=tmp_path / "p.db", static_dir=tmp_path / "x",
                              browser=FakeBrowser(falla=True)))
    c.post("/api/browser/install")
    s = esperar(c, lambda s: not s["installing"])
    assert s["installed"] is False and "no disk space" in s["error"]


def test_the_real_check_finds_the_installed_chromium():
    # En este ordenador Chromium esta instalado (lo usa el rastreo).
    assert browser.PlaywrightBrowser().installed() is True
