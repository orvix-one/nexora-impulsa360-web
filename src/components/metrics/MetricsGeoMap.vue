<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { formatNumber } from '../../lib/metrics/formato'
import { cargarGeometria, codigoPoligono } from '../../lib/metrics/geo'

const props = defineProps({
  nivel: { type: String, required: true },
  conteo: { type: Map, required: true },
  indice: { type: Map, required: true },
  elegidos: { type: Set, default: () => new Set() },
})
const emit = defineEmits(['alternar'])

const BOLIVIA_BOUNDS = [[-22.9, -69.7], [-9.6, -57.4]]
const ZOOM_TODAS_LAS_ETIQUETAS = 8
const ETIQUETAS_A_ZOOM_BAJO = 25

const mapElement = ref(null)
const error = ref('')
let L = null
let map = null
let capaPoligonos = null
let capaEtiquetas = null
let destroyed = false
let renderId = 0

function estilo(codigo) {
  const tiene = (props.conteo.get(codigo) ?? 0) > 0
  const elegido = props.elegidos.has(codigo)
  return {
    color: elegido ? '#0b3d91' : tiene ? '#ffffff' : '#8aa4bf',
    weight: elegido ? 2.5 : tiene ? 1 : 0.6,
    fillColor: '#1769ff',
    fillOpacity: tiene ? 0.38 : 0.02,
  }
}

function etiquetasVisibles() {
  if (props.nivel === 'departamento' || map.getZoom() >= ZOOM_TODAS_LAS_ETIQUETAS) return null
  return new Set([...props.conteo].sort((a, b) => b[1] - a[1]).slice(0, ETIQUETAS_A_ZOOM_BAJO).map(([codigo]) => codigo))
}

function pintarEtiquetas(geojson) {
  if (capaEtiquetas) map.removeLayer(capaEtiquetas)
  const visibles = etiquetasVisibles()
  const marcadores = []
  for (const feature of geojson.features) {
    const codigo = codigoPoligono(feature.properties, props.nivel)
    const total = props.conteo.get(codigo) ?? 0
    if (!total || (visibles && !visibles.has(codigo))) continue
    const [lng, lat] = feature.properties.etiqueta
    const html = document.createElement('span')
    html.textContent = formatNumber(total)
    marcadores.push(L.marker([lat, lng], {
      icon: L.divIcon({ className: 'geo-etiqueta', html, iconSize: null }),
      interactive: false,
      keyboard: false,
    }))
  }
  capaEtiquetas = L.layerGroup(marcadores).addTo(map)
}

let geojsonActual = null

async function render({ encuadrar = false } = {}) {
  if (!map) return
  const id = ++renderId
  let geojson
  try {
    geojson = await cargarGeometria(props.nivel)
  } catch {
    error.value = 'No se pudieron cargar los límites territoriales.'
    return
  }
  if (destroyed || id !== renderId) return
  error.value = ''
  geojsonActual = geojson
  if (capaPoligonos) map.removeLayer(capaPoligonos)
  capaPoligonos = L.geoJSON(geojson, {
    style: (feature) => estilo(codigoPoligono(feature.properties, props.nivel)),
    onEachFeature: (feature, layer) => {
      const codigo = codigoPoligono(feature.properties, props.nivel)
      const entrada = props.indice.get(codigo)
      const tooltip = document.createElement('span')
      tooltip.textContent = `${entrada?.nombre ?? codigo}: ${formatNumber(props.conteo.get(codigo) ?? 0)} activaciones`
      layer.bindTooltip(tooltip, { sticky: true })
      layer.on('click', () => { if (entrada) emit('alternar', entrada.key) })
    },
  }).addTo(map)
  pintarEtiquetas(geojson)
  if (encuadrar) encuadrarDatos(geojson)
}

function encuadrarDatos(geojson) {
  const conDatos = geojson.features.filter((f) => props.conteo.has(codigoPoligono(f.properties, props.nivel)))
  if (!conDatos.length) { map.fitBounds(BOLIVIA_BOUNDS); return }
  map.fitBounds(L.geoJSON({ type: 'FeatureCollection', features: conDatos }).getBounds(), { padding: [20, 20], maxZoom: 11 })
}

onMounted(async () => {
  const [{ default: leaflet }] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')])
  L = leaflet
  if (destroyed || !mapElement.value) return
  map = L.map(mapElement.value, { zoomControl: true, preferCanvas: true })
  map.fitBounds(BOLIVIA_BOUNDS)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map)
  map.on('zoomend', () => { if (geojsonActual) pintarEtiquetas(geojsonActual) })
  render({ encuadrar: true })
})

watch(() => props.nivel, () => render({ encuadrar: true }))
watch(() => props.conteo, () => render({ encuadrar: true }))
watch(() => props.elegidos, () => capaPoligonos?.setStyle((f) => estilo(codigoPoligono(f.properties, props.nivel))))

onBeforeUnmount(() => {
  destroyed = true
  if (map) map.remove()
  map = null
})
</script>

<template>
  <div class="geo-mapa">
    <div ref="mapElement" class="metrics-heat-map" aria-label="Mapa de activaciones por territorio"></div>
    <p v-if="error" class="mensaje-error">{{ error }}</p>
  </div>
</template>

<style scoped>
/* Leaflet panes use z-index 400+; isolating the map keeps the filter popovers above it. */
.geo-mapa {
  isolation: isolate;
  display: grid;
  gap: 0.5rem;
  min-width: 0;
}

/* A muted basemap keeps the single-color polygons readable. */
.geo-mapa :deep(.leaflet-tile-pane) {
  filter: grayscale(1) brightness(1.08) contrast(0.85);
}

/* Leaflet positions the marker element with its own transform, so the label centers itself inside it. */
.geo-mapa :deep(.geo-etiqueta > span) {
  display: inline-block;
  transform: translate(-50%, -50%);
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
  background: rgba(11, 61, 145, 0.9);
  color: #ffffff;
  font-size: 0.72rem;
  font-weight: 700;
  white-space: nowrap;
  box-shadow: 0 2px 6px rgba(5, 13, 22, 0.25);
}
</style>
