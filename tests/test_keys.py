import keyring
import keyring.backend
import pytest

from buscapiso import keys


class Memoria(keyring.backend.KeyringBackend):
    priority = 1

    def __init__(self):
        self.datos = {}

    def get_password(self, service, username):
        return self.datos.get((service, username))

    def set_password(self, service, username, password):
        self.datos[(service, username)] = password

    def delete_password(self, service, username):
        self.datos.pop((service, username), None)


@pytest.fixture
def llavero(monkeypatch):
    previo = keyring.get_keyring()
    keyring.set_keyring(Memoria())
    monkeypatch.delenv("BUSCAPISO_GOOGLE_KEY", raising=False)
    yield
    keyring.set_keyring(previo)


def test_the_key_round_trips_through_the_keyring(llavero):
    assert keys.get_google_key() is None
    keys.set_google_key("ABC")
    assert keys.get_google_key() == "ABC"
    keys.set_google_key(None)
    assert keys.get_google_key() is None


def test_the_environment_variable_is_a_fallback(llavero, monkeypatch):
    monkeypatch.setenv("BUSCAPISO_GOOGLE_KEY", "FROMENV")
    assert keys.get_google_key() == "FROMENV"


def test_each_provider_has_its_own_key(llavero, monkeypatch):
    keys.set_key("anthropic", "A1")
    keys.set_key("openai_compat", "O1")
    assert (keys.get_key("anthropic"), keys.get_key("openai_compat")) == ("A1", "O1")
    monkeypatch.setenv("BUSCAPISO_OLLAMA_KEY", "E")
    assert keys.get_key("ollama") == "E"
