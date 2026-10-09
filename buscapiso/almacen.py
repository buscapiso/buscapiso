"""Historico en SQLite: que anuncios ya habiamos visto y en que estado estan.

Sin esto, cada ejecucion te devuelve las mismas 200 habitaciones y no sabes
cuales son nuevas. La deteccion de novedades es la mitad del valor de la
herramienta cuando buscas con prisa.
"""
from __future__ import annotations

import datetime as dt
import json
import pathlib
import sqlite3

from buscapiso.profiles import SearchProfile

SCHEMA_VERSION = 4

ESTADOS = ("new", "liked", "hidden", "contacted", "visit_scheduled", "visited",
           "applied", "got_it", "rejected", "discarded")
ESTADOS_ANTIGUOS = {"nuevo": "new", "interesa": "liked", "contactado": "contacted",
                    "visita": "visit_scheduled", "descartado": "discarded"}
_OCULTOS = ("hidden", "discarded")


def abrir(ruta: pathlib.Path) -> sqlite3.Connection:
    """Abre la base de datos y la migra a SCHEMA_VERSION si hace falta.

    Antes de migrar una base con datos deja una copia <nombre>.v<N>.bak: son
    los estados y notas de la usuaria, y no se pueden reconstruir.
    """
    ruta = pathlib.Path(ruta)
    tenia_datos = ruta.exists() and ruta.stat().st_size > 0
    con = sqlite3.connect(ruta)
    version = con.execute("PRAGMA user_version").fetchone()[0]
    if version > SCHEMA_VERSION:
        con.close()
        raise RuntimeError(f"{ruta} es de una version mas nueva de buscapiso "
                           f"(esquema {version}, esta entiende hasta {SCHEMA_VERSION})")
    if version < SCHEMA_VERSION:
        copia = ruta.with_name(f"{ruta.stem}.v{version}.bak")
        if tenia_datos and not copia.exists():
            destino = sqlite3.connect(copia)
            con.backup(destino)
            destino.close()
        _migrar(con)
    return con


def _migrar(con: sqlite3.Connection) -> None:
    """Todos los pasos en una sola transaccion con el bloqueo de escritura.

    La web abre una conexion por peticion y la primera carga tras actualizar
    lanza varias a la vez: la version se relee ya con el bloqueo puesto, asi
    que solo una migra y las demas ven el esquema nuevo.
    """
    nivel = con.isolation_level
    con.isolation_level = None          # transaccion manual
    try:
        con.execute("BEGIN IMMEDIATE")
        version = con.execute("PRAGMA user_version").fetchone()[0]
        for paso in _MIGRACIONES[version:SCHEMA_VERSION]:
            paso(con)
        con.execute("COMMIT")
    except BaseException:
        con.execute("ROLLBACK")
        raise
    finally:
        con.isolation_level = nivel


def _migrar_a_1(con: sqlite3.Connection) -> None:
    """De la version 0 (sin numero de esquema) a la 1."""
    con.execute("""
        CREATE TABLE IF NOT EXISTS anuncios (
            id TEXT PRIMARY KEY,
            portal TEXT, id_portal TEXT, url TEXT,
            primera_vez TEXT, ultima_vez TEXT,
            estado TEXT DEFAULT 'new',
            nota TEXT DEFAULT '',
            datos TEXT)""")
    for viejo, nuevo in ESTADOS_ANTIGUOS.items():
        con.execute("UPDATE anuncios SET estado = ? WHERE estado = ?", (nuevo, viejo))
    con.execute("""
        CREATE TABLE IF NOT EXISTS historial (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            anuncio TEXT NOT NULL,
            estado TEXT NOT NULL,
            nota TEXT NOT NULL DEFAULT '',
            cuando TEXT NOT NULL)""")
    # El estado actual es lo unico que sabemos del pasado; su fecha
    # aproximada es la ultima vez que se vio el anuncio.
    con.execute("""
        INSERT INTO historial (anuncio, estado, nota, cuando)
        SELECT id, estado, nota, ultima_vez FROM anuncios WHERE estado != 'new'""")
    con.execute("""
        CREATE TABLE IF NOT EXISTS perfiles (
            nombre TEXT PRIMARY KEY,
            datos TEXT NOT NULL,
            activo INTEGER NOT NULL DEFAULT 0,
            actualizado TEXT NOT NULL)""")
    con.execute("PRAGMA user_version = 1")


def _migrar_a_2(con: sqlite3.Connection) -> None:
    """Grupo de cada anuncio: aceptado o posible (genero sin confirmar)."""
    con.execute("ALTER TABLE anuncios ADD COLUMN grupo TEXT NOT NULL "
                "DEFAULT 'accepted'")
    con.execute("PRAGMA user_version = 2")


def _migrar_a_3(con: sqlite3.Connection) -> None:
    """Ajustes de la app y cache de trayectos de proveedores externos."""
    con.execute("CREATE TABLE IF NOT EXISTS ajustes ("
                "clave TEXT PRIMARY KEY, valor TEXT NOT NULL)")
    con.execute("""
        CREATE TABLE IF NOT EXISTS trayectos (
            proveedor TEXT, modo TEXT, salida TEXT,
            lat REAL, lon REAL, dlat REAL, dlon REAL,
            minutos REAL NOT NULL, detalle TEXT NOT NULL, cuando TEXT NOT NULL,
            PRIMARY KEY (proveedor, modo, salida, lat, lon, dlat, dlon))""")
    con.execute("PRAGMA user_version = 3")


def _migrar_a_4(con: sqlite3.Connection) -> None:
    """Cache de lo que la IA ha leido de cada anuncio."""
    con.execute("CREATE TABLE IF NOT EXISTS ia_cache ("
                "clave TEXT PRIMARY KEY, datos TEXT NOT NULL, cuando TEXT NOT NULL)")
    con.execute("PRAGMA user_version = 4")


_MIGRACIONES = [_migrar_a_1, _migrar_a_2, _migrar_a_3, _migrar_a_4]


def leer_ajustes(con: sqlite3.Connection) -> dict[str, str]:
    return dict(con.execute("SELECT clave, valor FROM ajustes"))


def guardar_ajuste(con: sqlite3.Connection, clave: str, valor: str) -> None:
    with con:
        con.execute("INSERT INTO ajustes (clave, valor) VALUES (?, ?) "
                    "ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor",
                    (clave, valor))


def hoy() -> str:
    return dt.date.today().isoformat()


def registrar(con: sqlite3.Connection, anuncios: list, grupo: str = "accepted") -> list:
    """Guarda los anuncios y devuelve solo los que no habiamos visto nunca."""
    nuevos = []
    for a in anuncios:
        fila = con.execute("SELECT primera_vez FROM anuncios WHERE id = ?",
                           (a.id,)).fetchone()
        if fila is None:
            a.visto_por_primera_vez = hoy()
            con.execute(
                "INSERT INTO anuncios (id, portal, id_portal, url, primera_vez,"
                " ultima_vez, estado, datos, grupo) VALUES (?,?,?,?,?,?,?,?,?)",
                (a.id, a.portal, a.id_portal, a.url, hoy(), hoy(), "new",
                 json.dumps(a.como_dict(), ensure_ascii=False), grupo))
            nuevos.append(a)
        else:
            a.visto_por_primera_vez = fila[0]
            con.execute(
                "UPDATE anuncios SET ultima_vez = ?, datos = ?, grupo = ? WHERE id = ?",
                (hoy(), json.dumps(a.como_dict(), ensure_ascii=False), grupo, a.id))
    con.commit()
    return nuevos


def estado_de(con: sqlite3.Connection, id_anuncio: str) -> str:
    fila = con.execute("SELECT estado FROM anuncios WHERE id = ?",
                       (id_anuncio,)).fetchone()
    return fila[0] if fila else "new"


def _ahora() -> str:
    return dt.datetime.now().isoformat(timespec="seconds")


def marcar(con: sqlite3.Connection, id_anuncio: str, estado: str,
           nota: str | None = None) -> bool:
    """Cambia el estado. Sin nota, la que hubiera se conserva."""
    estado = ESTADOS_ANTIGUOS.get(estado, estado)
    if estado not in ESTADOS:
        raise ValueError(f"estado invalido: {estado}. Validos: {', '.join(ESTADOS)}")
    with con:
        if nota is None:
            cur = con.execute("UPDATE anuncios SET estado = ? WHERE id = ?",
                              (estado, id_anuncio))
        else:
            cur = con.execute("UPDATE anuncios SET estado = ?, nota = ? WHERE id = ?",
                              (estado, nota, id_anuncio))
        if cur.rowcount == 0:
            return False
        actual = con.execute("SELECT nota FROM anuncios WHERE id = ?",
                             (id_anuncio,)).fetchone()[0]
        con.execute("INSERT INTO historial (anuncio, estado, nota, cuando) "
                    "VALUES (?,?,?,?)", (id_anuncio, estado, actual, _ahora()))
    return True


def historial(con: sqlite3.Connection, id_anuncio: str) -> list[tuple[str, str, str]]:
    return con.execute("SELECT estado, nota, cuando FROM historial WHERE anuncio = ? "
                       "ORDER BY id", (id_anuncio,)).fetchall()


def anotar(con: sqlite3.Connection, id_anuncio: str, nota: str) -> bool:
    with con:
        cur = con.execute("UPDATE anuncios SET nota = ? WHERE id = ?",
                          (nota, id_anuncio))
    return cur.rowcount > 0


_COLUMNAS = "datos, estado, nota, grupo, primera_vez, ultima_vez"


def _fila(f: tuple) -> dict:
    datos, estado, nota, grupo, primera, ultima = f
    return {"datos": json.loads(datos), "estado": estado, "nota": nota,
            "grupo": grupo, "primera_vez": primera, "ultima_vez": ultima}


def listar_anuncios(con: sqlite3.Connection, estados: list[str] | None = None,
                    grupo: str | None = None) -> list[dict]:
    """Anuncios guardados, de mas a menos puntuacion."""
    sql, args = f"SELECT {_COLUMNAS} FROM anuncios WHERE 1 = 1", []
    if estados:
        sql += f" AND estado IN ({','.join('?' * len(estados))})"
        args += estados
    if grupo:
        sql += " AND grupo = ?"
        args.append(grupo)
    sql += " ORDER BY json_extract(datos, '$.puntuacion') DESC, primera_vez DESC"
    return [_fila(f) for f in con.execute(sql, args)]


def leer_anuncio(con: sqlite3.Connection, id_anuncio: str) -> dict | None:
    f = con.execute(f"SELECT {_COLUMNAS} FROM anuncios WHERE id = ?",
                    (id_anuncio,)).fetchone()
    if f is None:
        return None
    return {**_fila(f), "historial": historial(con, id_anuncio)}


def descartados(con: sqlite3.Connection) -> set[str]:
    """Lo que no debe volver a salir: descartado u oculto."""
    marcas = ",".join("?" * len(_OCULTOS))
    return {f[0] for f in con.execute(
        f"SELECT id FROM anuncios WHERE estado IN ({marcas})", _OCULTOS)}


def guardar_perfil(con: sqlite3.Connection, perfil: SearchProfile,
                   activar: bool = False) -> None:
    """Crea o sobrescribe. El primer perfil queda activo aunque no se pida."""
    primero = con.execute("SELECT COUNT(*) FROM perfiles").fetchone()[0] == 0
    with con:
        con.execute(
            "INSERT INTO perfiles (nombre, datos, activo, actualizado) VALUES (?,?,0,?) "
            "ON CONFLICT(nombre) DO UPDATE SET datos = excluded.datos, "
            "actualizado = excluded.actualizado",
            (perfil.name, perfil.model_dump_json(), _ahora()))
    if activar or primero:
        activar_perfil(con, perfil.name)


def cargar_perfil(con: sqlite3.Connection,
                  nombre: str | None = None) -> SearchProfile | None:
    if nombre is None:
        fila = con.execute("SELECT datos FROM perfiles WHERE activo = 1").fetchone()
    else:
        fila = con.execute("SELECT datos FROM perfiles WHERE nombre = ?",
                           (nombre,)).fetchone()
    return SearchProfile.model_validate_json(fila[0]) if fila else None


def listar_perfiles(con: sqlite3.Connection) -> list[tuple[str, bool]]:
    return [(n, bool(a)) for n, a in con.execute(
        "SELECT nombre, activo FROM perfiles ORDER BY nombre")]


def activar_perfil(con: sqlite3.Connection, nombre: str) -> bool:
    if con.execute("SELECT 1 FROM perfiles WHERE nombre = ?", (nombre,)).fetchone() is None:
        return False
    with con:
        con.execute("UPDATE perfiles SET activo = (nombre = ?)", (nombre,))
    return True


def borrar_perfil(con: sqlite3.Connection, nombre: str) -> bool:
    with con:
        cur = con.execute("DELETE FROM perfiles WHERE nombre = ?", (nombre,))
    return cur.rowcount > 0
