"""Construye datos/red.json: topologia escrita a mano + coordenadas de OpenStreetMap.

La topologia (orden de estaciones por linea) es estable durante anios y un error
se detecta con un test. Las coordenadas vienen de OSM porque teclearlas de
memoria introduce errores de cientos de metros, y 300 m son 4 minutos andando.

Uso:  python3 datos/build_red.py
"""
import json
import pathlib
import sys
import unicodedata

AQUI = pathlib.Path(__file__).parent

# --- Topologia: orden real de estaciones. Nombres tal y como los usa OSM. ---
LINEAS = {
    "L1": {
        "hop_min": 1.8, "frecuencia_min": 3.5,
        "estaciones": [
            "Hospital de Bellvitge", "Bellvitge Rambla Marina", "Avinguda Carrilet",
            "Rambla Just Oliveras", "Can Serra", "Florida", "Torrassa",
            "Santa Eulàlia", "Mercat Nou", "Plaça de Sants", "Hostafrancs",
            "Espanya", "Rocafort", "Urgell", "Universitat", "Catalunya",
            "Urquinaona", "Arc de Triomf", "Marina", "Glòries", "El Clot",
            "Navas", "La Sagrera", "Fabra i Puig", "Sant Andreu",
            "Torras i Bages", "Trinitat Vella", "Baró de Viver", "Santa Coloma",
            "Fondo",
        ],
    },
    "L2": {
        "hop_min": 1.8, "frecuencia_min": 4.0,
        "estaciones": [
            "Paral·lel", "Sant Antoni", "Universitat", "Passeig de Gràcia",
            "Tetuan", "Monumental", "Sagrada Família", "Encants", "El Clot",
            "Bac de Roda", "Sant Martí", "La Pau", "Verneda",
            "Artigues | Sant Adrià", "Sant Roc", "Gorg", "Pep Ventura",
            "Badalona Pompeu Fabra",
        ],
    },
    "L3": {
        "hop_min": 1.8, "frecuencia_min": 3.5,
        "estaciones": [
            "Zona Universitària", "Palau Reial", "Maria Cristina", "les Corts",
            "Plaça del Centre", "Sants Estació", "Tarragona", "Espanya",
            "El Poble-sec", "Paral·lel", "La Rambla | Drassanes", "Liceu",
            "Catalunya", "Passeig de Gràcia", "Diagonal", "Fontana", "Lesseps",
            "Vallcarca", "Penitents", "Vall d’Hebron | Sant Genís", "Montbau",
            "Mundet", "Valldaura", "Canyelles", "Roquetes", "Trinitat Nova",
        ],
    },
    "L5": {
        "hop_min": 1.8, "frecuencia_min": 3.5,
        "estaciones": [
            "Cornellà Centre", "Gavarra", "Sant Ildefons", "Can Boixeres",
            "Can Vidalet", "Pubilla Cases", "Collblanc", "Badal",
            "Plaça de Sants", "Sants Estació", "Entença", "Hospital Clínic",
            "Diagonal", "Verdaguer", "Sagrada Família", "Sant Pau | Dos de Maig",
            "Camp de l'Arpa", "La Sagrera", "Congrés | Indians", "Maragall",
            "Virrei Amat", "Vilapicina", "Horta", "el Carmel",
            "El Coll | La Teixonera", "Vall d’Hebron | Sant Genís",
        ],
    },
    # L9 Sud: automatico, sin conductor, algo mas rapido entre paradas.
    "L9S": {
        "hop_min": 1.7, "frecuencia_min": 4.0,
        "estaciones": [
            "Zona Universitària", "Collblanc", "Torrassa", "Can Tries - Gornal",
            "Europa | Fira", "Fira", "Parc Logístic", "Mercabarna",
            "Les Moreres", "El Prat Estació", "Cèntric", "Parc Nou", "Mas Blau",
            "Aeroport T2", "Aeroport T1",
        ],
    },
    "L10S": {
        "hop_min": 1.7, "frecuencia_min": 6.0,
        "estaciones": [
            "Collblanc", "Torrassa", "Can Tries - Gornal", "Provençana",
            "Ciutat de la Justícia", "Foneria", "Foc", "Zona Franca", "Ecoparc",
            "ZAL | Riu Vell", "Port Comercial | La Factoria",
        ],
    },
    # FGC L8: frecuencia mucho peor que el metro, y eso pesa en el calculo.
    "L8": {
        "hop_min": 2.0, "frecuencia_min": 10.0,
        "estaciones": [
            "Espanya", "Magòria-La Campana", "Ildefons Cerdà", "Europa | Fira",
            "Gornal", "Sant Josep", "Almeda", "Cornellà-Riera", "Sant Boi",
            "Molí Nou | Ciutat Cooperativa",
        ],
    },
}


def normaliza(s: str) -> str:
    """Clave de comparacion: sin acentos, sin signos, minusculas."""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return "".join(c for c in s.lower() if c.isalnum())


def main() -> int:
    osm = json.loads((AQUI / "osm_estaciones.json").read_text())
    coords = {}
    for e in osm["elements"]:
        nombre = e.get("tags", {}).get("name")
        if nombre:
            coords.setdefault(normaliza(nombre), (e["lat"], e["lon"]))

    estaciones, faltan = {}, []
    for linea, datos in LINEAS.items():
        for nombre in datos["estaciones"]:
            clave = normaliza(nombre)
            if clave not in coords:
                faltan.append(f"{linea}: {nombre}")
                continue
            lat, lon = coords[clave]
            est = estaciones.setdefault(
                nombre, {"nombre": nombre, "lat": lat, "lon": lon, "lineas": []}
            )
            if linea not in est["lineas"]:
                est["lineas"].append(linea)

    if faltan:
        # Fallo ruidoso: un nombre que no casa seria un agujero silencioso en la red.
        print("ERROR: estaciones sin coordenadas en OSM:", file=sys.stderr)
        for f in faltan:
            print("  -", f, file=sys.stderr)
        return 1

    red = {
        "lineas": {k: {"hop_min": v["hop_min"], "frecuencia_min": v["frecuencia_min"],
                       "estaciones": v["estaciones"]} for k, v in LINEAS.items()},
        "estaciones": estaciones,
    }
    destino = AQUI / "red.json"
    destino.write_text(json.dumps(red, ensure_ascii=False, indent=1))
    print(f"OK: {len(estaciones)} estaciones, {len(LINEAS)} lineas -> {destino}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
