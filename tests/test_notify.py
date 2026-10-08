import pytest
from fastapi.testclient import TestClient

from buscapiso import almacen, events
from buscapiso.api.app import create_app
from buscapiso.modelo import Anuncio
from buscapiso.notify import notify_new_listings
from buscapiso.pipeline import SearchResult


def anuncio(n, puntos, precio=450):
    a = Anuncio(portal="idealista", id_portal=str(n), url=f"https://x/{n}", titulo=f"Room {n}",
                precio=precio, gastos_extra=50, barrio=f"Barrio {n}",
                trayectos={"Fira": 10.0 + n})
    a.puntuacion = puntos
    return a


@pytest.fixture
def con(tmp_path):
    c = almacen.abrir(tmp_path / "p.db")
    almacen.guardar_ajuste(c, "ntfy_topic", "buscapiso-abc123")
    return c


def resultado(*anuncios, nuevos=None):
    ids = {a.id for a in anuncios} if nuevos is None else {a.id for a in nuevos}
    return SearchResult(accepted=list(anuncios), new_ids=ids)


def test_only_good_new_listings_are_sent(con):
    enviados = []
    a, b, c, viejo = anuncio(1, 120), anuncio(2, 95), anuncio(3, 50), anuncio(4, 130)
    n = notify_new_listings(con, resultado(a, b, c, viejo, nuevos=[a, b, c]),
                            post=lambda url, headers, body: enviados.append((url, headers, body)))
    assert n == 2
    url, headers, body = enviados[0]
    assert url == "https://ntfy.sh/buscapiso-abc123"
    assert headers["Title"] == "2 new rooms worth a look"
    assert headers["Tags"] == "house"
    texto = body.decode()
    assert "Room 1" in texto and "500 €" in texto and "11 min to Fira" in texto
    assert "Room 3" not in texto and "Room 4" not in texto


def test_at_most_three_are_listed(con):
    enviados = []
    lista = [anuncio(i, 100 + i) for i in range(5)]
    notify_new_listings(con, resultado(*lista), post=lambda u, h, b: enviados.append(b))
    assert enviados[0].decode().count("€") == 3
    assert "and 2 more" in enviados[0].decode()


def test_nothing_is_sent_without_a_topic(tmp_path):
    c = almacen.abrir(tmp_path / "q.db")
    enviados = []
    assert notify_new_listings(c, resultado(anuncio(1, 120)), post=lambda *a: enviados.append(a)) == 0
    assert enviados == []


def test_a_failing_ntfy_only_warns(con):
    seen = []
    previous = events.set_sink(seen.append)

    def post(url, headers, body):
        raise OSError("network down")
    try:
        assert notify_new_listings(con, resultado(anuncio(1, 120)), post=post) == 0
    finally:
        events.set_sink(previous)
    assert any(e.kind == "warning" and "ntfy" in e.message for e in seen)


def test_notify_api_generates_a_private_topic_and_sends_a_test(tmp_path, monkeypatch):
    enviados = []
    monkeypatch.setattr("buscapiso.notify._post", lambda u, h, b: enviados.append((u, b)))
    c = TestClient(create_app(db_path=tmp_path / "p.db", static_dir=tmp_path / "x"))
    assert c.get("/api/notify").json() == {"server": "https://ntfy.sh", "topic": "", "min_score": 80}
    r = c.put("/api/notify", json={"enabled": True, "min_score": 90}).json()
    assert r["topic"].startswith("buscapiso-") and len(r["topic"]) == len("buscapiso-") + 10
    assert r["min_score"] == 90
    assert c.post("/api/notify/test").json() == {"ok": True}
    assert enviados[0][0] == f"https://ntfy.sh/{r['topic']}"
    c.put("/api/notify", json={"enabled": False})
    assert c.get("/api/notify").json()["topic"] == ""
