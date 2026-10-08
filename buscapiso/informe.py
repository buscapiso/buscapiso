"""Informe HTML autocontenido: un solo fichero que abres en el navegador."""
from __future__ import annotations

import datetime as dt
import html
import pathlib

CSS = """
:root{--bg:#faf9f7;--card:#fff;--tx:#1a1a1a;--sub:#666;--bd:#e4e0da;
 --ok:#1a7f4b;--nuevo:#b4531a;--mal:#a01f2e;--acc:#2b5f8f}
@media(prefers-color-scheme:dark){:root{--bg:#16181c;--card:#1e2128;--tx:#e8e6e3;
 --sub:#9a9691;--bd:#32363e;--ok:#4ac48a;--nuevo:#f0913f;--mal:#e46b7b;--acc:#77aee0}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--tx);
 font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:1000px;margin:0 auto;padding:24px 18px 60px}
h1{font-size:23px;margin:0 0 4px} h2{font-size:17px;margin:34px 0 12px;
 padding-bottom:6px;border-bottom:1px solid var(--bd)}
.meta{color:var(--sub);font-size:13px;margin-bottom:8px}
.resumen{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0}
.kpi{background:var(--card);border:1px solid var(--bd);border-radius:10px;
 padding:10px 14px;min-width:110px}
.kpi b{display:block;font-size:21px;line-height:1.2}
.kpi span{color:var(--sub);font-size:12px}
.card{background:var(--card);border:1px solid var(--bd);border-radius:12px;
 padding:14px;margin-bottom:12px;display:flex;gap:14px}
.card.nuevo{border-left:4px solid var(--nuevo)}
.foto{width:132px;height:99px;object-fit:cover;border-radius:8px;flex-shrink:0;
 background:var(--bd)}
.cuerpo{min-width:0;flex:1}
.tit{font-weight:600;font-size:15px;margin:0 0 3px}
.tit a{color:var(--tx);text-decoration:none} .tit a:hover{color:var(--acc)}
.linea{color:var(--sub);font-size:13px;margin-bottom:7px}
.badges{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:7px}
.b{font-size:11.5px;padding:2px 8px;border-radius:20px;border:1px solid var(--bd);
 color:var(--sub);white-space:nowrap}
.b.ok{color:var(--ok);border-color:var(--ok)}
.b.nu{color:var(--nuevo);border-color:var(--nuevo)}
.b.ac{color:var(--acc);border-color:var(--acc)}
.motivos{font-size:12.5px;color:var(--sub);margin:0;padding-left:16px}
.pts{font-size:19px;font-weight:700;color:var(--acc);text-align:right;
 min-width:56px;flex-shrink:0}
.pts small{display:block;font-size:10px;color:var(--sub);font-weight:400}
.desc{font-size:13px;color:var(--sub);margin:7px 0 0;
 display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.fuera{font-size:13px;color:var(--sub)}
.fuera li{margin-bottom:3px}
.vacio{background:var(--card);border:1px dashed var(--bd);border-radius:12px;
 padding:26px;text-align:center;color:var(--sub)}
.id{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--sub)}
.portal{font-size:11px;text-transform:uppercase;letter-spacing:.04em;
 font-weight:600;color:var(--acc)}
@media(max-width:620px){.card{flex-wrap:wrap}.foto{width:100%;height:150px}
 .pts{text-align:left;min-width:0}}
"""


def _badges(a, gastos_def: int = 55) -> str:
    bs = []
    if a.visto_por_primera_vez and a.publicado_texto:
        bs.append(('nu', f"publicado {a.publicado_texto}"))
    if a.genero_piso == "chicas":
        bs.append(('ok', "solo chicas") if a.genero_confirmado
                  else ('nu', "parece de chicas (sin confirmar)"))
    elif a.genero_piso == "desconocido":
        bs.append(('nu', "el portal no dice el género"))
    if a.gastos_extra == 0:
        bs.append(('ok', "gastos incluidos"))
    elif a.gastos_extra:
        bs.append(('', f"+{a.gastos_extra} € gastos"))
    else:
        bs.append(('', f"gastos sin declarar (~{gastos_def} €)"))
    for i, (nombre, minutos) in enumerate(a.trayectos.items()):
        bs.append(('ac' if i == 0 else '', f"{minutos:.0f} min a {nombre}"))
    if a.companeros:
        bs.append(('', f"{a.companeros} compañeros"))
    if a.visitas_permitidas is True:
        bs.append(('ok', "visitas permitidas"))
    elif a.visitas_permitidas is False:
        bs.append(('', "visitas prohibidas"))
    if a.edad_companeros:
        bs.append(('ok', f"compañeras de {a.edad_companeros} años"))
    if a.disponible_desde:
        bs.append(('', f"libre el {a.disponible_desde}"))
    if a.estancia_minima_meses:
        bs.append(('', f"mínimo {a.estancia_minima_meses} meses"))
    if a.exterior:
        bs.append(('ok', "exterior"))
    if a.admite_parejas is False:
        bs.append(('', "no admite parejas"))
    if a.coords_aproximadas:
        bs.append(('', "ubicación estimada"))
    return "".join(f'<span class="b {c}">{html.escape(t)}</span>' for c, t in bs)


def _tarjeta(a, es_nuevo: bool, gastos_def: int = 55) -> str:
    foto = (f'<img class="foto" src="{html.escape(a.foto)}" alt="" loading="lazy">'
            if a.foto else '<div class="foto"></div>')
    motivos = "".join(f"<li>{html.escape(m)}</li>" for m in a.motivos)
    return f"""<div class="card {'nuevo' if es_nuevo else ''}">
 {foto}
 <div class="cuerpo">
  <p class="tit"><a href="{html.escape(a.url)}" target="_blank" rel="noopener">
   {html.escape(a.titulo or 'Habitación')}</a></p>
  <p class="linea"><span class="portal">{html.escape(a.portal)}{
    ' + ' + ' + '.join(html.escape(x) for x in a.tambien_en) if a.tambien_en else ''
  }</span> &middot; {a.coste_estimado(gastos_def)} €/mes{'' if a.gastos_extra is not None else ' estimados'} &middot;
   {html.escape(a.barrio or '')}{', ' if a.barrio else ''}{html.escape(a.municipio or '')}
   &middot; <span class="id">{a.id}</span></p>
  <div class="badges">{_badges(a, gastos_def)}</div>
  <ul class="motivos">{motivos}</ul>
  {f'<p class="desc">{html.escape(a.ambiente)}</p>' if a.ambiente else ''}
  {f'<p class="desc">{html.escape(a.descripcion[:210])}</p>' if a.descripcion else ''}
 </div>
 <div class="pts">{a.puntuacion:.0f}<small>puntos</small></div>
</div>"""


def generar(anuncios: list, nuevos_ids: set, fuera: list, cfg: dict,
            destino: pathlib.Path, stats: dict,
            posibles: list | None = None) -> pathlib.Path:
    ahora = dt.datetime.now().strftime("%d/%m/%Y a las %H:%M")
    nuevos = [a for a in anuncios if a.id in nuevos_ids]
    resto = [a for a in anuncios if a.id not in nuevos_ids]

    gastos_def = cfg["presupuesto"]["gastos_si_no_declara"]

    def bloque(lista, vacio_txt):
        if not lista:
            return f'<div class="vacio">{vacio_txt}</div>'
        return "".join(_tarjeta(a, a.id in nuevos_ids, gastos_def) for a in lista)

    por_motivo: dict[str, int] = {}
    for _, m in fuera:
        clave = m.split(":")[0].split("(")[0].strip()
        clave = clave if not clave[:1].isdigit() else "demasiado lejos de un destino"
        por_motivo[clave] = por_motivo.get(clave, 0) + 1
    lista_fuera = "".join(
        f"<li>{html.escape(k)}: <b>{v}</b></li>"
        for k, v in sorted(por_motivo.items(), key=lambda x: -x[1]))

    limites = "".join(
        f", máximo {d['max_minutos']:.0f} min a {html.escape(d['nombre'])}"
        for d in cfg.get("destinos", []) if d.get("max_minutos") is not None)

    cuerpo = f"""<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Habitaciones en Barcelona</title><style>{CSS}</style></head><body>
<div class="wrap">
<h1>Habitaciones que encajan contigo</h1>
<p class="meta">Generado el {ahora} &middot; filtro: solo chicas, sin propietario,
 máximo {cfg['presupuesto']['coste_total_maximo']} €/mes totales{limites}</p>
<div class="resumen">
 <div class="kpi"><b>{stats['rastreados']}</b><span>anuncios rastreados</span></div>
 <div class="kpi"><b>{len(anuncios)}</b><span>cumplen tus requisitos</span></div>
 <div class="kpi"><b>{len(nuevos)}</b><span>nuevos desde la última vez</span></div>
 <div class="kpi"><b>{stats['fichas']}</b><span>fichas completas leídas</span></div>
 <div class="kpi"><b>{stats.get('portales', 1)}</b><span>portales rastreados</span></div>
 <div class="kpi"><b>{len(posibles or [])}</b><span>posibles a preguntar</span></div>
</div>
<h2>Nuevos desde la última búsqueda</h2>
{bloque(nuevos, "Ninguno nuevo esta vez. Los de abajo siguen disponibles.")}
<h2>El resto, por puntuación</h2>
{bloque(resto, "Nada más que mostrar.")}
<h2>Posibles: el portal no dice si es piso de chicas</h2>
<p class="meta">Cumplen todo lo demás y puntúan bien. Fotocasa y De Piso en Piso
 no publican el género del piso, así que esto solo se resuelve preguntando.</p>
{bloque(posibles or [], "Ninguno esta vez.")}
<h2>Qué se ha quedado fuera y por qué</h2>
<ul class="fuera">{lista_fuera or '<li>Nada descartado.</li>'}</ul>
<p class="meta" style="margin-top:26px">Para marcar uno:
 <code>python buscar.py marcar &lt;id&gt; contactado</code> &middot;
 estados: interesa, contactado, visita, descartado</p>
</div></body></html>"""
    destino.write_text(cuerpo, encoding="utf-8")
    return destino
