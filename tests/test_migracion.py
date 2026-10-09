import sqlite3

import pytest

from buscapiso import almacen
from buscapiso.profiles import SearchProfile


def base_antigua(ruta):
    """Una pisos.db tal como la dejaba la version anterior."""
    con = sqlite3.connect(ruta)
    con.execute("""CREATE TABLE anuncios (
        id TEXT PRIMARY KEY, portal TEXT, id_portal TEXT, url TEXT,
        primera_vez TEXT, ultima_vez TEXT, estado TEXT DEFAULT 'nuevo',
        nota TEXT DEFAULT '', datos TEXT)""")
    filas = [("a", "contactado", "escrito el lunes"), ("b", "descartado", "lejos"),
             ("c", "nuevo", ""), ("d", "interesa", ""), ("e", "visita", "jueves 18h")]
    for id_, estado, nota in filas:
        con.execute("INSERT INTO anuncios VALUES (?,?,?,?,?,?,?,?,?)",
                    (id_, "idealista", id_, f"https://x/{id_}", "2026-09-20",
                     "2026-09-21", estado, nota, "{}"))
    con.commit()
    con.close()


def test_legacy_statuses_and_notes_survive(tmp_path):
    ruta = tmp_path / "pisos.db"
    base_antigua(ruta)
    con = almacen.abrir(ruta)
    filas = dict(con.execute("SELECT id, estado FROM anuncios").fetchall())
    assert filas == {"a": "contacted", "b": "discarded", "c": "new",
                     "d": "liked", "e": "visit_scheduled"}
    notas = dict(con.execute("SELECT id, nota FROM anuncios").fetchall())
    assert notas["a"] == "escrito el lunes"
    assert almacen.historial(con, "e") == [("visit_scheduled", "jueves 18h", "2026-09-21")]


def test_a_backup_is_made_before_migrating(tmp_path):
    ruta = tmp_path / "pisos.db"
    base_antigua(ruta)
    almacen.abrir(ruta).close()
    copia = sqlite3.connect(tmp_path / "pisos.v0.bak")
    assert copia.execute("SELECT estado FROM anuncios WHERE id='a'").fetchone() == ("contactado",)


def test_opening_twice_does_not_duplicate_history(tmp_path):
    ruta = tmp_path / "pisos.db"
    base_antigua(ruta)
    almacen.abrir(ruta).close()
    con = almacen.abrir(ruta)
    assert con.execute("SELECT COUNT(*) FROM historial").fetchone() == (4,)


def test_a_newer_database_is_refused(tmp_path):
    ruta = tmp_path / "pisos.db"
    con = sqlite3.connect(ruta)
    con.execute(f"PRAGMA user_version = {almacen.SCHEMA_VERSION + 1}")
    con.close()
    with pytest.raises(RuntimeError):
        almacen.abrir(ruta)


def test_a_fresh_database_needs_no_backup(tmp_path):
    almacen.abrir(tmp_path / "nueva.db").close()
    assert not list(tmp_path.glob("*.bak"))


def test_profiles_are_stored_and_the_first_one_is_active(tmp_path):
    con = almacen.abrir(tmp_path / "t.db")
    almacen.guardar_perfil(con, SearchProfile(name="yo"))
    almacen.guardar_perfil(con, SearchProfile(name="amiga"))
    assert almacen.listar_perfiles(con) == [("amiga", False), ("yo", True)]
    assert almacen.cargar_perfil(con).name == "yo"
    assert almacen.activar_perfil(con, "amiga")
    assert almacen.cargar_perfil(con).name == "amiga"
    assert almacen.activar_perfil(con, "no-existe") is False
    assert almacen.cargar_perfil(con, "yo") == SearchProfile(name="yo")


def test_saving_again_overwrites(tmp_path):
    con = almacen.abrir(tmp_path / "t.db")
    almacen.guardar_perfil(con, SearchProfile(name="yo"))
    cambiado = SearchProfile(name="yo", sources=["fotocasa"])
    almacen.guardar_perfil(con, cambiado)
    assert almacen.cargar_perfil(con, "yo") == cambiado




def test_v1_databases_gain_the_group_column(tmp_path):
    ruta = tmp_path / "pisos.db"
    base_antigua(ruta)
    con = almacen.abrir(ruta)
    assert con.execute("PRAGMA user_version").fetchone() == (almacen.SCHEMA_VERSION,)
    assert set(r[0] for r in con.execute("SELECT DISTINCT grupo FROM anuncios")) == {"accepted"}


def test_each_migration_step_leaves_its_own_backup(tmp_path):
    ruta = tmp_path / "pisos.db"
    base_antigua(ruta)
    almacen.abrir(ruta).close()
    assert (tmp_path / "pisos.v0.bak").exists()


def test_concurrent_first_opens_migrate_once(tmp_path):
    """La web abre una conexion por peticion: tras actualizar, la primera
    carga lanza varias a la vez y todas intentaban migrar."""
    import threading
    for ronda in range(5):
        ruta = tmp_path / f"p{ronda}.db"
        base_antigua(ruta)
        errores = []

        def abrir():
            try:
                almacen.abrir(ruta).close()
            except Exception as e:      # noqa: BLE001
                errores.append(e)

        hilos = [threading.Thread(target=abrir) for _ in range(4)]
        for h in hilos: h.start()
        for h in hilos: h.join()
        assert errores == []
        con = sqlite3.connect(ruta)
        assert con.execute("PRAGMA user_version").fetchone() == (almacen.SCHEMA_VERSION,)
        copia = sqlite3.connect(tmp_path / f"p{ronda}.v0.bak")
        assert copia.execute("PRAGMA user_version").fetchone() == (0,)


def test_v3_adds_settings_and_travel_cache(tmp_path):
    ruta = tmp_path / "pisos.db"
    base_antigua(ruta)
    con = almacen.abrir(ruta)
    tablas = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"ajustes", "trayectos"} <= tablas
    almacen.guardar_ajuste(con, "travel_provider", "transitous")
    assert almacen.leer_ajustes(con) == {"travel_provider": "transitous"}
