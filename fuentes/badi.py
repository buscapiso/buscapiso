"""Fuente Badi. EXPERIMENTAL Y SIN VERIFICAR.

Estado real, para que no te lleves sorpresas:

  VERIFICADO  - badi.com/es/habitaciones/barcelona devuelve 404: cambiaron las
                rutas publicas.
  VERIFICADO  - la web llama a https://api.badiapp.com/v1/application/...
  VERIFICADO  - esa API responde 401 sin autenticacion. El path existe (401,
                no 404), pero exige sesion.
  SIN PROBAR  - todo lo de abajo. La captura del token y la forma de la
                respuesta son suposiciones razonables, no hechos comprobados,
                porque hacerlo necesita una cuenta de Badi.

Por eso esta fuente esta desactivada en config.yaml. Para intentarlo:
  1. crea una cuenta en badi.com,
  2. ejecuta  python fuentes/badi.py  y haz login en la ventana que se abre,
  3. pon  fuentes: [idealista, badi]  en config.yaml.
Si la respuesta no tiene la forma esperada, el modulo te lo dira sin romper
el resto de la busqueda.
"""
from __future__ import annotations

import json
import pathlib
import time

from fuentes.base import Fuente
from modelo import DESCONOCIDO, GENERO_CHICAS, GENERO_CHICOS, GENERO_MIXTO, Anuncio

PERFIL = pathlib.Path(__file__).resolve().parents[1] / ".perfil-badi"
API = "https://api.badiapp.com"
WEB = "https://badi.com/es"


class SinSesionBadi(RuntimeError):
    """No hay sesion iniciada en el perfil de Badi."""


def _genero(valor) -> str:
    return {"female": GENERO_CHICAS, "male": GENERO_CHICOS,
            "mixed": GENERO_MIXTO, "any": GENERO_MIXTO}.get(valor, DESCONOCIDO)


def _a_anuncio(bruto: dict) -> Anuncio | None:
    """Traduce un objeto de la API de Badi al esquema comun.

    Defensivo a proposito: no conozco el contrato real, asi que cualquier
    campo que falte deja el anuncio incompleto en vez de tumbar la busqueda.
    """
    try:
        id_portal = str(bruto.get("id") or bruto.get("room_id") or "")
        if not id_portal:
            return None
        precio = bruto.get("price") or (bruto.get("monthly_price") or {}).get("amount")
        if isinstance(precio, (int, float)) and precio > 10000:
            precio = precio / 100          # algunos endpoints dan centimos
        sitio = bruto.get("location") or {}
        return Anuncio(
            portal="badi",
            id_portal=id_portal,
            url=bruto.get("url") or f"https://badi.com/es/room/{id_portal}",
            titulo=bruto.get("title", ""),
            precio=int(precio) if precio else None,
            gastos_extra=bruto.get("bills_included") and 0 or None,
            direccion=sitio.get("street", "") or "",
            barrio=sitio.get("neighbourhood", "") or sitio.get("area", "") or "",
            municipio=sitio.get("city", "Barcelona") or "Barcelona",
            lat=sitio.get("lat"), lon=sitio.get("lon"),
            coords_aproximadas=False if sitio.get("lat") else True,
            genero_piso=_genero((bruto.get("flatmates") or {}).get("gender")),
            companeros=(bruto.get("flatmates") or {}).get("count"),
            descripcion=bruto.get("description", "") or "",
            foto=((bruto.get("pictures") or [{}])[0] or {}).get("url", ""),
        )
    except Exception:
        return None


class Badi(Fuente):
    nombre = "badi"

    def __init__(self):
        self._pw = self._ctx = self._pagina = None
        self._token = None

    def _navegador(self):
        if self._pagina is not None:
            return self._pagina
        from playwright.sync_api import sync_playwright
        self._pw = sync_playwright().start()
        self._ctx = self._pw.chromium.launch_persistent_context(
            str(PERFIL), headless=False, locale="es-ES",
            timezone_id="Europe/Madrid", viewport={"width": 1400, "height": 950})
        self._pagina = self._ctx.pages[0] if self._ctx.pages else self._ctx.new_page()
        return self._pagina

    def _capturar_token(self) -> str:
        """Roba el Authorization de las propias llamadas de la web."""
        pg = self._navegador()
        tokens: list[str] = []
        pg.on("request", lambda r: tokens.append(r.headers["authorization"])
              if "badiapp.com" in r.url and "authorization" in r.headers else None)
        pg.goto(WEB, wait_until="domcontentloaded", timeout=60000)
        time.sleep(6)
        if not tokens:
            raise SinSesionBadi(
                "Badi no expone anuncios sin cuenta. Ejecuta 'python fuentes/badi.py',"
                " inicia sesion en la ventana, y vuelve a lanzar la busqueda.")
        self._token = tokens[-1]
        return self._token

    def buscar(self, cfg: dict, max_paginas: int = 3) -> list[Anuncio]:
        pg = self._navegador()
        token = self._token or self._capturar_token()
        precio = cfg.get("filtros_idealista", {}).get("precio_max", 600)
        resultados: list[Anuncio] = []
        for pagina in range(1, max_paginas + 1):
            url = (f"{API}/v1/application/rooms/search?coordinates=41.3760,2.1190"
                   f"&radius=8000&max_price={precio}&page={pagina}&limit=50")
            try:
                resp = pg.evaluate(
                    """async ([u, t]) => {
                        const r = await fetch(u, {headers: {Authorization: t,
                                                            Accept: 'application/json'}});
                        return {status: r.status, body: await r.text()};
                    }""", [url, token])
            except Exception as e:
                print(f"  badi: fallo la llamada ({str(e)[:60]})")
                break
            if resp["status"] != 200:
                print(f"  badi: la API respondio {resp['status']}; "
                      "probablemente la sesion no es valida")
                break
            try:
                datos = json.loads(resp["body"])
            except json.JSONDecodeError:
                print("  badi: respuesta que no es JSON")
                break
            lote = datos.get("data") or datos.get("rooms") or datos.get("results") or []
            if not lote:
                break
            resultados.extend(a for a in (_a_anuncio(x) for x in lote) if a)
            print(f"  badi p{pagina}: {len(lote)} anuncios")
            time.sleep(3)
        return resultados

    def cerrar(self) -> None:
        try:
            if self._ctx:
                self._ctx.close()
            if self._pw:
                self._pw.stop()
        finally:
            self._ctx = self._pagina = self._pw = None


if __name__ == "__main__":
    # Modo login: abre la ventana y espera a que inicies sesion a mano.
    b = Badi()
    pg = b._navegador()
    pg.goto(WEB, wait_until="domcontentloaded", timeout=60000)
    print("Inicia sesion en la ventana de Badi. Tienes 3 minutos.")
    print("Al terminar, la sesion queda guardada en", PERFIL)
    time.sleep(180)
    b.cerrar()
