import pathlib

import yaml

from buscapiso import informe
from buscapiso.modelo import GENERO_CHICAS, Anuncio

RAIZ = pathlib.Path(__file__).resolve().parents[1]


def test_the_report_shows_minutes_to_each_destination(tmp_path):
    cfg = yaml.safe_load((RAIZ / "config.yaml").read_text(encoding="utf-8"))
    a = Anuncio(portal="idealista", id_portal="1", url="https://x/1", precio=450,
                genero_piso=GENERO_CHICAS,
                trayectos={"Fira": 12.0, "Collblanc": 9.6})
    destino = informe.generar([a], {a.id}, [], cfg, tmp_path / "i.html",
                              {"rastreados": 1, "fichas": 0, "portales": 1})
    html = destino.read_text(encoding="utf-8")
    assert "12 min a Fira" in html
    assert "10 min a Collblanc" in html
    assert "máximo 30 min a Fira" in html
