"""Construye datos/zonas.json: catalogo de zonas rastreables con su centroide.

Mismo reparto que build_red.py: los slugs de cada portal van a mano porque son
estables y se verifican uno a uno contra el sitio; las coordenadas salen de
Nominatim, porque teclear 20 centroides de memoria introduce errores de
kilometros y aqui deciden si una zona entra o no en la busqueda.

Uso:  python3 datos/build_zonas.py
"""
import json
import pathlib
import sqlite3
import sys

AQUI = pathlib.Path(__file__).parent
sys.path.insert(0, str(AQUI.parent))

from geocodificador import Geocodificador

# slug_idealista = None  -> ese portal no tiene pagina de habitaciones ahi.
# En fotocasa los distritos de Barcelona ya los cubre barcelona-capital, asi
# que solo se listan los municipios; el distrito queda a None.
ZONAS = [
    # Distritos de Barcelona
    ("Sants-Montjuïc, Barcelona",        "barcelona/sants-montjuic",        None),
    ("Les Corts, Barcelona",             "barcelona/les-corts",             None),
    ("Eixample, Barcelona",              "barcelona/eixample",              None),
    ("Ciutat Vella, Barcelona",          "barcelona/ciutat-vella",          None),
    ("Gràcia, Barcelona",                "barcelona/gracia",                None),
    ("Sarrià-Sant Gervasi, Barcelona",   "barcelona/sarria-sant-gervasi",   None),
    ("Sant Martí, Barcelona",            "barcelona/sant-marti",            None),
    ("Horta-Guinardó, Barcelona",        "barcelona/horta-guinardo",        None),
    ("Nou Barris, Barcelona",            "barcelona/nou-barris",            None),
    ("Sant Andreu, Barcelona",           "barcelona/sant-andreu",           None),
    # Municipios del area metropolitana
    ("L'Hospitalet de Llobregat",  "hospitalet-de-llobregat-barcelona",
     "l-hospitalet-de-llobregat/todas-las-zonas"),
    ("Cornellà de Llobregat",      "cornella-de-llobregat-barcelona",
     "cornella-de-llobregat/todas-las-zonas"),
    ("Esplugues de Llobregat",     "esplugues-de-llobregat-barcelona",
     "esplugues-de-llobregat/todas-las-zonas"),
    ("Sant Joan Despí",            "sant-joan-despi-barcelona",
     "sant-joan-despi/todas-las-zonas"),
    ("El Prat de Llobregat",       None,
     "el-prat-de-llobregat/todas-las-zonas"),
    ("Sant Boi de Llobregat",      None,
     "sant-boi-de-llobregat/todas-las-zonas"),
    ("Badalona",                   "badalona-barcelona",
     "badalona/todas-las-zonas"),
    ("Santa Coloma de Gramenet",   None,
     "santa-coloma-de-gramenet/todas-las-zonas"),
    ("Sant Adrià de Besòs",        "sant-adria-de-besos-barcelona",
     "sant-adria-de-besos/todas-las-zonas"),
]

# Fotocasa cubre todos los distritos de Barcelona con una sola busqueda.
FOTOCASA_CIUDAD = "barcelona-capital/todas-las-zonas"

# Conurbacion de Barcelona: izquierda, arriba, derecha, abajo.
# Ajustada: con el limite norte en 41.60, "Eixample" resolvia a 41.4882 (cerca
# de Mollet) y la validacion lo daba por bueno. El punto mas al norte que
# queremos de verdad es Santa Coloma, a 41.452.
BBOX = (1.95, 41.47, 2.30, 41.25)
DENTRO = (41.25, 41.47, 1.95, 2.30)   # lat_min, lat_max, lon_min, lon_max


def main() -> int:
    con = sqlite3.connect(AQUI.parent / "pisos.db")
    geo = Geocodificador(con)
    zonas, fallos = [], []
    for nombre, idealista, fotocasa in ZONAS:
        consulta = nombre if "," in nombre else f"{nombre}, Barcelona, España"
        if consulta.endswith(", Barcelona"):
            consulta += ", Cataluña, España"   # desambigua los distritos
        lat, lon = geo.geocodificar(consulta, bbox=BBOX)
        if lat is None:
            fallos.append(f"{nombre}: sin resultado")
            continue
        # Validacion obligatoria: sin ella, "Eixample" acaba cerca de Mollet,
        # a 15 km, y la zona queda excluida de la busqueda sin que se note.
        lat_min, lat_max, lon_min, lon_max = DENTRO
        if not (lat_min < lat < lat_max and lon_min < lon < lon_max):
            fallos.append(f"{nombre}: {lat:.4f},{lon:.4f} fuera del area")
            continue
        zonas.append({"nombre": nombre, "lat": lat, "lon": lon,
                      "idealista": idealista, "fotocasa": fotocasa})
        print(f"  {nombre:34s} {lat:.4f},{lon:.4f}")
    if fallos:
        print("ERROR: sin coordenadas:", ", ".join(fallos), file=sys.stderr)
        return 1
    destino = AQUI / "zonas.json"
    destino.write_text(json.dumps(
        {"zonas": zonas, "fotocasa_ciudad": FOTOCASA_CIUDAD},
        ensure_ascii=False, indent=1))
    print(f"OK: {len(zonas)} zonas -> {destino}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
