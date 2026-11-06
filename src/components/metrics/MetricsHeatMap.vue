<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  points: { type: Array, default: () => [] },
})

const BOLIVIA_BOUNDS = [
  [-22.9, -69.7],
  [-9.6, -57.4],
]

const mapElement = ref(null)
// Leaflet se carga bajo demanda para no pesar en el resto del tablero.
let L = null
let map = null
let heatLayer = null
let tooltipLayer = null
let destroyed = false

function clearLayers() {
  if (!map) return
  if (heatLayer) map.removeLayer(heatLayer)
  if (tooltipLayer) map.removeLayer(tooltipLayer)
  heatLayer = null
  tooltipLayer = null
}

async function renderPoints() {
  if (!map) return
  clearLayers()
  if (!props.points.length) return

  const heatPoints = props.points.map((point) => [point.lat, point.lng, 1])
  heatLayer = L.heatLayer(heatPoints, { radius: 28, blur: 20, maxZoom: 17 }).addTo(map)
  tooltipLayer = L.layerGroup(
    props.points.map((point) => {
      const tooltip = document.createElement('span')
      tooltip.textContent = point.label
      return L.circleMarker([point.lat, point.lng], {
        radius: 7,
        stroke: false,
        fillOpacity: 0,
      }).bindTooltip(tooltip, { direction: 'top' })
    }),
  ).addTo(map)

  await nextTick()
  map.invalidateSize()
  const pais = L.latLngBounds(BOLIVIA_BOUNDS)
  const enBolivia = heatPoints.filter(([lat, lng]) => pais.contains([lat, lng]))
  const bounds = L.latLngBounds(enBolivia.map(([lat, lng]) => [lat, lng]))
  if (!enBolivia.length) map.fitBounds(pais)
  else if (enBolivia.length === 1) map.setView(bounds.getCenter(), 15)
  else map.fitBounds(bounds, { padding: [28, 28], maxZoom: 16 })
}

onMounted(async () => {
  if (map || !mapElement.value) return
  const [{ default: leaflet }] = await Promise.all([
    import('leaflet'),
    import('leaflet/dist/leaflet.css'),
  ])
  L = leaflet
  window.L = L
  await import('leaflet.heat')
  if (destroyed || map || !mapElement.value) return
  map = L.map(mapElement.value, { zoomControl: true, preferCanvas: true })
  map.fitBounds(BOLIVIA_BOUNDS)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map)
  renderPoints()
})

watch(() => props.points, renderPoints, { deep: false })

onBeforeUnmount(() => {
  destroyed = true
  clearLayers()
  if (map) map.remove()
  map = null
})
</script>

<template>
  <div ref="mapElement" class="metrics-heat-map" aria-label="Mapa de calor de activaciones"></div>
</template>
