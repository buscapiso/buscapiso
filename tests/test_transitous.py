import json
import pathlib
import urllib.parse

import pytest

from buscapiso.travel import TransitousProvider, TravelError, transitous_user_agent

FIX = pathlib.Path(__file__).parent / "fixtures"
SANTS, FIRA = (41.3792, 2.1404), {"nombre": "Fira", "lat": 41.3519, "lon": 2.1307,
                                  "modo": "transporte", "salida": "08:30"}


def fake(respuestas, llamadas):
    def fetch(url, headers):
        llamadas.append((url, headers))
        r = respuestas.pop(0)
        if isinstance(r, Exception):
            raise r
        return json.loads((FIX / f"transitous_{r}.json").read_text())
    return fetch


def provider(respuestas, llamadas):
    return TransitousProvider("ana@example.org", fetch=fake(respuestas, llamadas), pause=0)


@pytest.mark.parametrize("modo, fixture, modo_api, minutos", [
    ("a_pie", "walk", "WALK", 57), ("bici", "bike", "BIKE", 19)])
def test_walk_and_bike_use_the_direct_route(modo, fixture, modo_api, minutos):
    llamadas = []
    [t] = provider([fixture], llamadas).trips([SANTS], {**FIRA, "modo": modo})
    assert round(t.minutes) == minutos
    q = urllib.parse.parse_qs(urllib.parse.urlparse(llamadas[0][0]).query)
    assert q["directModes"] == [modo_api]
    assert q["maxDirectTime"] == ["7200"]


def test_every_request_identifies_the_app_and_its_contact():
    llamadas = []
    provider(["walk"], llamadas).trips([SANTS], {**FIRA, "modo": "a_pie"})
    ua = llamadas[0][1]["User-Agent"]
    assert ua == transitous_user_agent("ana@example.org")
    assert "buscapiso" in ua and "ana@example.org" in ua and "github.com" in ua


def test_one_failed_request_gives_none_for_that_origin():
    llamadas = []
    viajes = provider([OSError("timeout"), "walk"], llamadas).trips(
        [SANTS, (41.38, 2.15)], {**FIRA, "modo": "a_pie"})
    assert viajes[0] is None and viajes[1] is not None


def test_all_requests_failing_is_a_travel_error():
    with pytest.raises(TravelError):
        provider([OSError("no network")], []).trips([SANTS], FIRA)


def test_a_contact_is_required():
    with pytest.raises(ValueError):
        TransitousProvider("  ")


def test_transit_uses_one_request_for_all_origins():
    llamadas = []

    def fetch(url, headers):
        llamadas.append(url)
        return json.loads((FIX / "transitous_one_to_all.json").read_text())

    p = TransitousProvider("ana@example.org", fetch=fetch, pause=0)
    lejos = (41.5931, 1.8378)
    viajes = p.trips([SANTS, (41.37587, 2.1184), lejos], FIRA)
    assert len(llamadas) == 1
    q = urllib.parse.parse_qs(urllib.parse.urlparse(llamadas[0]).query)
    assert "/api/v1/one-to-all" in llamadas[0]
    assert q["one"] == ["41.3519,2.1307"] and q["arriveBy"] == ["true"]
    assert viajes[0].minutes == pytest.approx(22.6, abs=0.5)
    assert viajes[0].detail == "via Barcelona Sants"
    assert viajes[1].minutes == pytest.approx(15.4, abs=0.5)
    assert viajes[2] is None


def test_a_local_motis_needs_no_contact():
    p = TransitousProvider(base_url="http://localhost:8080")
    assert p.name == "transitous"
    with pytest.raises(ValueError):
        TransitousProvider(base_url="https://api.transitous.org")
