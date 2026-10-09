"""Claves de servicios externos, en el llavero del sistema y nunca en la base de datos."""
from __future__ import annotations

import os

import keyring
from keyring.errors import KeyringError, PasswordDeleteError

SERVICE = "buscapiso"


class KeysUnavailable(RuntimeError):
    """No hay llavero del sistema donde guardar la clave."""


def get_key(name: str) -> str | None:
    """Del llavero, o de BUSCAPISO_<NAME>_KEY si no hay llavero."""
    try:
        clave = keyring.get_password(SERVICE, name)
    except KeyringError:
        clave = None
    return clave or os.environ.get(f"BUSCAPISO_{name.upper()}_KEY") or None


def set_key(name: str, value: str | None) -> None:
    try:
        if value:
            keyring.set_password(SERVICE, name, value)
        else:
            try:
                keyring.delete_password(SERVICE, name)
            except PasswordDeleteError:
                pass
    except KeyringError as e:
        raise KeysUnavailable(
            f"No system keyring is available. Set BUSCAPISO_{name.upper()}_KEY instead.") from e


def get_google_key() -> str | None:
    return get_key("google")


def set_google_key(key: str | None) -> None:
    set_key("google", key)
