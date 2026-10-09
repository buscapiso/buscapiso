#!/usr/bin/env bash
# Compila la web y empaqueta buscapiso para este sistema en dist/buscapiso/.
set -euo pipefail
cd "$(dirname "$0")/.."
npm --prefix web ci
npm --prefix web run build
python -m pip install -e '.[build]'
python -m PyInstaller --noconfirm --clean packaging/buscapiso.spec
echo "Listo: dist/buscapiso/"
