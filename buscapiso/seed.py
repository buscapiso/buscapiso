"""El perfil activo, creandolo la primera vez a partir de config.yaml."""
from __future__ import annotations

import yaml

from buscapiso import almacen, paths
from buscapiso.profiles import SearchProfile, from_engine_cfg


def active_profile(con) -> SearchProfile:
    perfil = almacen.cargar_perfil(con)
    if perfil is not None:
        return perfil
    config = paths.data_dir() / "config.yaml"
    if config.exists():
        cfg = yaml.safe_load(config.read_text(encoding="utf-8"))
        zonas_yaml = paths.data_dir() / "zonas.yaml"
        zonas = (yaml.safe_load(zonas_yaml.read_text(encoding="utf-8")) or {}
                 if zonas_yaml.exists() else {})
        perfil = from_engine_cfg(cfg, zonas, name="default")
        print("Perfil 'default' creado a partir de config.yaml y zonas.yaml")
    else:
        perfil = SearchProfile(name="default")
    almacen.guardar_perfil(con, perfil, activar=True)
    return perfil
