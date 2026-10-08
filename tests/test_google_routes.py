import urllib.error

import pytest

from buscapiso.travel import GoogleProvider, TravelError

FIRA = {"nombre": "Fira", "lat": 41.3519, "lon": 2.1307, "modo": "transporte", "salida": "08:30"}


def test_builds_a_transit_matrix_request_and_reads_durations():
    llamadas = []

    def post(url, headers, body):
        llamadas.append((url, headers, body))
        return [{"originIndex": 1, "destinationIndex": 0, "duration": "1260s",
                 "condition": "ROUTE_EXISTS"},
                {"originIndex": 0, "destinationIndex": 0, "condition": "ROUTE_NOT_FOUND"}]

    viajes = GoogleProvider("KEY123", post=post).trips([(41.37, 2.14), (41.38, 2.15)], FIRA)
    assert viajes[0] is None
    assert viajes[1].minutes == 21 and viajes[1].source == "google"
    url, headers, body = llamadas[0]
    assert url.endswith("/distanceMatrix/v2:computeRouteMatrix")
    assert headers["X-Goog-Api-Key"] == "KEY123"
    assert headers["X-Goog-FieldMask"] == "originIndex,destinationIndex,duration,condition"
    assert body["travelMode"] == "TRANSIT"
    assert body["departureTime"].endswith("Z")
    assert body["origins"][1]["waypoint"]["location"]["latLng"] == {"latitude": 41.38, "longitude": 2.15}


def test_walking_sends_no_departure_time():
    cuerpos = []
    GoogleProvider("K", post=lambda u, h, b: cuerpos.append(b) or []).trips(
        [(41.37, 2.14)], {**FIRA, "modo": "a_pie"})
    assert cuerpos[0]["travelMode"] == "WALK"
    assert "departureTime" not in cuerpos[0]


def test_large_batches_are_split_at_100_origins():
    tamanos = []
    GoogleProvider("K", post=lambda u, h, b: tamanos.append(len(b["origins"])) or []).trips(
        [(41.37, 2.14)] * 230, FIRA)
    assert tamanos == [100, 100, 30]


def test_an_http_error_is_a_travel_error_without_the_key():
    def post(url, headers, body):
        raise urllib.error.HTTPError(url, 403, "API key not valid. KEY123", {}, None)
    with pytest.raises(TravelError) as e:
        GoogleProvider("KEY123", post=post).trips([(41.37, 2.14)], FIRA)
    assert "KEY123" not in str(e.value)
    assert "403" in str(e.value)
