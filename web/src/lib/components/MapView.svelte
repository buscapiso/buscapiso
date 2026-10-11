<script lang="ts">
  import L from 'leaflet';
  import 'leaflet/dist/leaflet.css';
  import { onMount } from 'svelte';
  import { popupContent } from '../mapPopup';

  export interface MapPoint {
    id: string; lat: number; lon: number; label: string; sub?: string; href?: string; color: string;
    /** Numero del anuncio en la lista de al lado: la chincheta lo lleva. */
    n?: number;
    /** Aun por confirmar (preguntar antes): chincheta hueca. */
    faint?: boolean;
  }
  export interface MapPlace { name: string; lat: number; lon: number }
  /** Un tramo de camino: color de la linea, a trazos si se va andando. */
  export interface MapRoute { points: [number, number][]; color: string; dashed?: boolean; stops?: MapPlace[] }

  let { points = [], places = [], routes = [], onpick, onmove, onselect, highlight = null, height = '360px', label,
    center = [41.3874, 2.1686] }: {
    points?: MapPoint[]; places?: MapPlace[]; routes?: MapRoute[];
    /** Clic en un punto: su id. */
    onselect?: (id: string) => void;
    /** Punto resaltado (la tarjeta bajo el puntero). */
    highlight?: string | null;
    onpick?: (lat: number, lon: number) => void;
    /** Arrastrar el destino i a otro sitio. */
    onmove?: (i: number, lat: number, lon: number) => void;
    height?: string; label: string;
    /** Donde mirar si aun no hay nada que encuadrar: el centro de la ciudad. */
    center?: [number, number];
  } = $props();

  let el: HTMLDivElement;
  let map = $state.raw<L.Map | null>(null);
  let layer: L.LayerGroup;
  let markers = new Map<string, L.Marker>();
  let bounds: L.LatLngExpression[] = [];
  // Se encuadra mientras llegan datos (el anuncio, luego los destinos, luego
  // el camino) hasta que la persona toca el mapa: desde entonces manda ella.
  // Eligiendo sitio, una sola vez: cada clic añade un punto.
  let framed = false;
  let touched = false;

  const resolve = (c: string) => c.startsWith('var(')
    ? getComputedStyle(document.documentElement).getPropertyValue(c.slice(4, -1)).trim() || '#888'
    : c;

  function fit(m: L.Map) {
    if (!bounds.length) return;
    // Sin animacion: si llegan los destinos mientras se anima el primer
    // encuadre, Leaflet descarta el segundo y el mapa se queda corto.
    m.invalidateSize();
    m.fitBounds(L.latLngBounds(bounds), { padding: [28, 28], maxZoom: 15, animate: false });
  }

  onMount(() => {
    const m = L.map(el, { scrollWheelZoom: true, zoomSnap: 0.5 }).setView(center, 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m);
    const FitAll = L.Control.extend({
      onAdd() {
        const b = L.DomUtil.create('button', 'fit-all');
        b.type = 'button';
        b.title = 'Show everything';
        b.setAttribute('aria-label', 'Show everything');
        b.textContent = '⤢';
        L.DomEvent.disableClickPropagation(b);
        b.onclick = () => fit(m);
        return b;
      },
    });
    new FitAll({ position: 'topleft' }).addTo(m);
    layer = L.layerGroup().addTo(m);
    for (const ev of ['mousedown', 'wheel', 'touchstart', 'keydown']) el.addEventListener(ev, () => { touched = true; }, { passive: true });
    if (onpick) m.on('click', (e: L.LeafletMouseEvent) => onpick(e.latlng.lat, e.latlng.lng));
    map = m;
    return () => m.remove();
  });

  $effect(() => {
    if (!map) return;
    layer.clearLayers();
    bounds = [];
    for (const r of routes) {
      L.polyline(r.points, { color: resolve(r.color), weight: r.dashed ? 4 : 6, opacity: r.dashed ? 0.6 : 0.9,
        dashArray: r.dashed ? '2 8' : undefined, lineCap: 'round' }).addTo(layer);
      for (const s of r.stops ?? []) {
        L.circleMarker([s.lat, s.lon], { radius: 5, color: resolve(r.color), weight: 3, fillColor: '#fff', fillOpacity: 1 })
          .bindTooltip(popupContent({ label: s.name }), { direction: 'top', offset: [0, -4] }).addTo(layer);
      }
      bounds.push(...r.points);
    }
    markers = new Map();
    for (const p of points) {
      // Con numero, una chincheta que casa con la tarjeta; sin el, un punto del color de su puntuacion.
      const icon = p.n !== undefined
        ? L.divIcon({ className: `pin${p.faint ? ' faint' : ''}`, html: String(p.n), iconSize: [26, 26], iconAnchor: [13, 13] })
        : L.divIcon({ className: 'dot', html: `<i style="background:${resolve(p.color)}"></i>`, iconSize: [16, 16], iconAnchor: [8, 8] });
      const m = L.marker([p.lat, p.lon], { icon, keyboard: false, riseOnHover: true })
        .bindPopup(popupContent(p)).addTo(layer);
      if (onselect) m.on('click', () => onselect(p.id));
      markers.set(p.id, m);
      bounds.push([p.lat, p.lon]);
    }
    places.forEach((d, i) => {
      const pin = L.marker([d.lat, d.lon], { draggable: !!onmove, keyboard: !!onmove,
        icon: L.divIcon({ className: 'place-pin', iconSize: [18, 18], iconAnchor: [9, 9] }) })
        .bindTooltip(popupContent({ label: d.name }), { permanent: true, direction: 'top', offset: [0, -10] })
        .addTo(layer);
      if (onmove) pin.on('dragend', () => { const ll = pin.getLatLng(); onmove(i, ll.lat, ll.lng); });
      bounds.push([d.lat, d.lon]);
    });
    if (onpick ? !framed : !touched) fit(map);
    if (bounds.length || onpick) framed = true;
  });

  // Resaltar sin redibujar: solo cambia un punto. Depende tambien de los
  // puntos para volver a aplicarse cuando se redibujan.
  $effect(() => {
    const h = highlight;
    void points;
    if (!map) return;
    for (const [id, m] of markers) {
      m.getElement()?.classList.toggle('hot', id === h);
      m.setZIndexOffset(id === h ? 1000 : 0);
    }
  });
</script>

<div class="map" bind:this={el} style:height role="region" aria-label={label}></div>

<style>
  .map { width: 100%; border: 1.5px solid var(--ink); border-radius: var(--radius); z-index: 0; }
  .map :global(.place-pin) { background: var(--gold); border: 3px solid var(--ink); transform: rotate(45deg); border-radius: 2px; }
  .map :global(.leaflet-marker-draggable.place-pin) { cursor: grab; }
  .map :global(.pin) { display: grid; place-items: center; border-radius: 50%; background: var(--ink); color: var(--paper);
    border: 2px solid var(--paper); box-shadow: 0 0 0 1px var(--ink); font: 800 13px/1 var(--display); font-stretch: 80%;
    font-variant-numeric: tabular-nums; transition: transform .12s ease; }
  .map :global(.pin.faint) { background: var(--paper); color: var(--ink); border-color: var(--ink); box-shadow: none; }
  .map :global(.pin.hot) { transform: scale(1.35); background: var(--gold); color: var(--ink); }
  .map :global(.dot) { display: grid; place-items: center; }
  .map :global(.dot i) { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--paper); box-shadow: 0 0 0 1px var(--ink); }
  .map :global(.dot.hot i) { width: 16px; height: 16px; }
  .map :global(.fit-all) { width: 30px; height: 30px; min-height: 0; padding: 0; border: 1px solid var(--ink); border-radius: var(--radius);
    background: var(--surface); font-size: 16px; line-height: 1; cursor: pointer; }
</style>
