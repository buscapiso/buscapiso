"""La clave de Google, en el llavero del sistema y nunca en la base de datos."""
from __future__ import annotations

import os

import keyring
from keyring.errors import KeyringError, PasswordDeleteError

SERVICE, USER = "buscapiso", "google"


class KeysUnavailable(RuntimeError):
    """No hay llavero del sistema donde guardar la clave."""


def get_google_key() -> str | None:
    try:
        clave = keyring.get_password(SERVICE, USER)
    except KeyringError:
        clave = None
    return clave or os.environ.get("BUSCAPISO_GOOGLE_KEY") or None


def set_google_key(key: str | None) -> None:
    try:
        if key:
            keyring.set_password(SERVICE, USER, key)
        else:
            try:
                keyring.delete_password(SERVICE, USER)
            except PasswordDeleteError:
                pass
    except KeyringError as e:
        raise KeysUnavailable(
            "No system keyring is available. Set BUSCAPISO_GOOGLE_KEY instead.") from e
