<script lang="ts">
  import L from 'leaflet';
  import 'leaflet/dist/leaflet.css';
  import { onMount } from 'svelte';
  import { popupContent } from '../mapPopup';

  export interface MapPoint { id: string; lat: number; lon: number; label: string; sub?: string; href?: string; color: string }
  export interface MapPlace { name: string; lat: number; lon: number }

  let { points = [], places = [], onpick, height = '360px', label }: {
    points?: MapPoint[]; places?: MapPlace[]; onpick?: (lat: number, lon: number) => void;
    height?: string; label: string;
  } = $props();

  let el: HTMLDivElement;
  let map = $state.raw<L.Map | null>(null);
  let layer: L.LayerGroup;

  const resolve = (c: string) => c.startsWith('var(')
    ? getComputedStyle(document.documentElement).getPropertyValue(c.slice(4, -1)).trim() || '#888'
    : c;

  onMount(() => {
    const m = L.map(el, { scrollWheelZoom: false }).setView([41.3874, 2.1686], 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m);
    layer = L.layerGroup().addTo(m);
    if (onpick) m.on('click', (e: L.LeafletMouseEvent) => onpick(e.latlng.lat, e.latlng.lng));
    map = m;
    return () => m.remove();
  });

  $effect(() => {
    if (!map) return;
    layer.clearLayers();
    const bounds: L.LatLngExpression[] = [];
    for (const p of points) {
      L.circleMarker([p.lat, p.lon], { radius: 7, color: '#fff', weight: 2,
        fillColor: resolve(p.color), fillOpacity: 1 })
        .bindPopup(popupContent(p)).addTo(layer);
      bounds.push([p.lat, p.lon]);
    }
    for (const d of places) {
      L.circleMarker([d.lat, d.lon], { radius: 9, color: resolve('var(--paper)'), weight: 3,
        fillColor: resolve('var(--ink)'), fillOpacity: 1 })
        .bindTooltip(popupContent({ label: d.name }), { permanent: true, direction: 'top', offset: [0, -8] })
        .addTo(layer);
      bounds.push([d.lat, d.lon]);
    }
    if (bounds.length) {
      // Sin animacion: si llegan los destinos mientras se anima el primer
      // encuadre, Leaflet descarta el segundo y el mapa se queda corto.
      map.invalidateSize();
      map.fitBounds(L.latLngBounds(bounds), { padding: [28, 28], maxZoom: 15, animate: false });
    }
  });
</script>

<div class="map" bind:this={el} style:height role="region" aria-label={label}></div>

<style>
  .map { width: 100%; border-radius: var(--radius); border: 1px solid var(--line); z-index: 0; }
</style>
