<script lang="ts">
  import L from 'leaflet';
  import 'leaflet/dist/leaflet.css';
  import { onMount } from 'svelte';
  import { popupContent } from '../mapPopup';

  export interface MapPoint { id: string; lat: number; lon: number; label: string; sub?: string; href?: string; color: string }
  export interface MapPlace { name: string; lat: number; lon: number }
  /** Un tramo de camino: color de la linea, a trazos si se va andando. */
  export interface MapRoute { points: [number, number][]; color: string; dashed?: boolean; stops?: MapPlace[] }

  let { points = [], places = [], routes = [], onpick, onmove, height = '360px', label }: {
    points?: MapPoint[]; places?: MapPlace[]; routes?: MapRoute[];
    onpick?: (lat: number, lon: number) => void;
    /** Arrastrar el destino i a otro sitio. */
    onmove?: (i: number, lat: number, lon: number) => void;
    height?: string; label: string;
  } = $props();

  let el: HTMLDivElement;
  let map = $state.raw<L.Map | null>(null);
  let layer: L.LayerGroup;
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
    const m = L.map(el, { scrollWheelZoom: true, zoomSnap: 0.5 }).setView([41.3874, 2.1686], 12);
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
    for (const p of points) {
      L.circleMarker([p.lat, p.lon], { radius: 7, color: '#fff', weight: 2,
        fillColor: resolve(p.color), fillOpacity: 1 })
        .bindPopup(popupContent(p)).addTo(layer);
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
</script>

<div class="map" bind:this={el} style:height role="region" aria-label={label}></div>

<style>
  .map { width: 100%; border-radius: var(--radius); border: 1px solid var(--line); z-index: 0; }
  .map :global(.place-pin) { background: var(--ink); border: 3px solid var(--paper); border-radius: 50%;
    box-shadow: 0 1px 4px rgb(0 0 0 / .35); }
  .map :global(.leaflet-marker-draggable.place-pin) { cursor: grab; }
  .map :global(.fit-all) { width: 30px; height: 30px; border: 2px solid rgb(0 0 0 / .2); border-radius: 4px;
    background: #fff; color: #333; font-size: 16px; cursor: pointer; background-clip: padding-box; }
</style>
