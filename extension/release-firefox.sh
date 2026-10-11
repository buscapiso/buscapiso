#!/usr/bin/env bash
# Firma la extension de Firefox con Mozilla (sin publicarla en su tienda) y la
# sube a la release ext-vX.Y.Z que ya creo el workflow al etiquetar. Al final
# marca esa release como "latest": desde ahi la descargan los enlaces de la web.
#
#   ./extension/release-firefox.sh
#
# Pide la clave de API de addons.mozilla.org (JWT issuer y secret), sacada de
# https://addons.mozilla.org/developers/addon/api/key/ . Tambien vale pasarla en
# WEB_EXT_API_KEY y WEB_EXT_API_SECRET. No se guarda en ningun sitio.
set -euo pipefail
cd "$(dirname "$0")/.."

version=$(node -e "import('./extension/src/protocol.js').then((m) => console.log(m.VERSION))")
tag="ext-v$version"
gh release view "$tag" >/dev/null || { echo "No existe la release $tag: etiqueta y sube el tag primero."; exit 1; }

if [ -z "${WEB_EXT_API_KEY:-}" ]; then read -rp 'JWT issuer (user:...): ' WEB_EXT_API_KEY; fi
if [ -z "${WEB_EXT_API_SECRET:-}" ]; then read -rsp 'JWT secret: ' WEB_EXT_API_SECRET; echo; fi
export WEB_EXT_API_KEY WEB_EXT_API_SECRET

node extension/build.mjs
out=$(mktemp -d)
npx --yes web-ext@8 sign --source-dir extension/dist/firefox --channel unlisted --artifacts-dir "$out"
cp "$out"/*.xpi "$out/buscapiso-firefox.xpi"
gh release upload "$tag" "$out/buscapiso-firefox.xpi" --clobber
gh release edit "$tag" --latest
echo "Listo: $tag lleva buscapiso-firefox.xpi firmado y es la release 'latest'."
