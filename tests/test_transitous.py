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


def test_transit_takes_the_fastest_itinerary_and_names_its_lines():
    llamadas = []
    [t] = provider(["transit"], llamadas).trips([SANTS], FIRA)
    assert t.minutes == pytest.approx(19.0, abs=0.5)
    assert t.detail == "L5 > L9S"
    assert t.source == "transitous"
    q = urllib.parse.parse_qs(urllib.parse.urlparse(llamadas[0][0]).query)
    assert q["fromPlace"] == ["41.3792,2.1404"]
    assert q["toPlace"] == ["41.3519,2.1307"]
    assert q["time"][0].endswith("Z")


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
    provider(["transit"], llamadas).trips([SANTS], FIRA)
    ua = llamadas[0][1]["User-Agent"]
    assert ua == transitous_user_agent("ana@example.org")
    assert "buscapiso" in ua and "ana@example.org" in ua and "github.com" in ua


def test_one_failed_request_gives_none_for_that_origin():
    llamadas = []
    viajes = provider([OSError("timeout"), "transit"], llamadas).trips(
        [SANTS, (41.38, 2.15)], FIRA)
    assert viajes[0] is None and viajes[1] is not None


def test_all_requests_failing_is_a_travel_error():
    with pytest.raises(TravelError):
        provider([OSError("no network")], []).trips([SANTS], FIRA)


def test_a_contact_is_required():
    with pytest.raises(ValueError):
        TransitousProvider("  ")
