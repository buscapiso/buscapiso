# PyInstaller: python -m PyInstaller packaging/buscapiso.spec
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_data_files, collect_submodules

RAIZ = Path(SPECPATH).parent
datas = [
    (str(RAIZ / "buscapiso" / "web_dist"), "buscapiso/web_dist"),
    (str(RAIZ / "buscapiso" / "datos" / "red.json"), "buscapiso/datos"),
    (str(RAIZ / "buscapiso" / "datos" / "zonas.json"), "buscapiso/datos"),
]
binaries, hidden = [], []
for paquete in ("playwright",):          # trae su propio driver (node + js)
    d, b, h = collect_all(paquete)
    datas += d; binaries += b; hidden += h
datas += collect_data_files("certifi")
hidden += (collect_submodules("uvicorn") + collect_submodules("keyring.backends")
           + ["anthropic", "segno", "platformdirs"])

a = Analysis([str(RAIZ / "packaging" / "launcher.py")], pathex=[str(RAIZ)], binaries=binaries,
             datas=datas, hiddenimports=hidden, excludes=["tkinter", "pytest"])
pyz = PYZ(a.pure)
# PyInstaller convierte el PNG a .ico o .icns si Pillow esta instalado.
icono = str(RAIZ / "packaging" / "icon.png")
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="buscapiso",
          console=sys.platform.startswith("linux"),     # en Windows y macOS, sin ventana negra
          icon=icono if Path(icono).exists() else None)
coll = COLLECT(exe, a.binaries, a.datas, name="buscapiso")
if sys.platform == "darwin":
    app = BUNDLE(coll, name="buscapiso.app", icon=icono if Path(icono).exists() else None,
                 bundle_identifier="io.github.feal-ca.buscapiso")
