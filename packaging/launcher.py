"""Punto de entrada de la app empaquetada: doble clic = abrir buscapiso."""
import os
import sys

if getattr(sys, "frozen", False):
    # Windows y macOS no siempre traen certificados que el Python empaquetado
    # sepa usar: sin esto, HTTPS (Nominatim, Transitous, IA, ntfy) falla.
    import certifi
    os.environ.setdefault("SSL_CERT_FILE", certifi.where())
    # Empaquetado, Playwright buscaria los navegadores dentro de la propia app,
    # que puede no admitir escritura (Program Files, una .app). Se guardan en la
    # carpeta de datos del usuario; comprobacion, instalacion y rastreo usan esta.
    from buscapiso import paths
    os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(paths.data_dir() / "browsers"))

from buscapiso.cli import main

sys.exit(main())
