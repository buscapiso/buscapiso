#!/usr/bin/env python3
"""Atajo de compatibilidad: `python buscar.py ...` sigue funcionando.
El CLI de verdad esta en buscapiso/cli.py."""
import sys

from buscapiso.cli import main

if __name__ == "__main__":
    sys.exit(main())
