"""El Chromium que usa el rastreo. La app empaquetada no lo trae (pesa unos
150 MB): la primera vez se descarga con el propio instalador de Playwright."""
from __future__ import annotations

import os
import pathlib
import subprocess
from typing import Callable


class PlaywrightBrowser:
    def installed(self) -> bool:
        from playwright.sync_api import sync_playwright
        try:
            with sync_playwright() as p:
                return pathlib.Path(p.chromium.executable_path).exists()
        except Exception:       # noqa: BLE001 - sin driver o sin navegador: no instalado
            return False

    def install(self, on_line: Callable[[str], None]) -> None:
        from playwright._impl._driver import compute_driver_executable, get_driver_env
        driver = compute_driver_executable()
        orden = [*driver, "install", "chromium"] if isinstance(driver, tuple) else [driver, "install", "chromium"]
        proc = subprocess.Popen(orden, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                env={**os.environ, **get_driver_env()})
        for linea in proc.stdout:
            if linea.strip():
                on_line(linea.strip())
        if proc.wait() != 0:
            raise RuntimeError(f"The browser installer stopped with code {proc.returncode}")
