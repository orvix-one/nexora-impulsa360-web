<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({ radio: { type: Number, default: 300 }, soloLectura: { type: Boolean, default: false } })
const punto = defineModel({ type: Object, default: null })
const mapElement = ref(null)
const BOLIVIA_BOUNDS = [[-22.95, -69.7], [-9.6, -57.4]]
let L = null
let map = null
let marcador = null
let circulo = null

function pintar() {
  if (!map) return
  if (!punto.value) {
    marcador?.remove(); circulo?.remove(); marcador = null; circulo = null
    return
  }
  const latlng = [punto.value.latitud, punto.value.longitud]
  if (!marcador) {
    marcador = L.circleMarker(latlng, { radius: 8, color: '#0f4ecc', fillOpacity: 0.9 }).addTo(map)
    circulo = L.circle(latlng, { radius: props.radio, color: '#1769ff', weight: 1, fillOpacity: 0.12 }).addTo(map)
  } else {
    marcador.setLatLng(latlng)
    circulo.setLatLng(latlng)
  }
  circulo.setRadius(props.radio)
  if (props.soloLectura) map.fitBounds(circulo.getBounds(), { padding: [24, 24] })
  else if (!map.getBounds().contains(latlng)) map.setView(latlng, 16)
}

onMounted(async () => {
  const [{ default: leaflet }] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')])
  L = leaflet
  if (!mapElement.value) return
  map = L.map(mapElement.value)
  if (punto.value) map.setView([punto.value.latitud, punto.value.longitud], 16)
  else map.fitBounds(BOLIVIA_BOUNDS)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map)
  if (!props.soloLectura) map.on('click', (event) => { punto.value = { latitud: event.latlng.lat, longitud: event.latlng.lng } })
  pintar()
})

watch(() => [punto.value, props.radio], pintar)

onBeforeUnmount(() => {
  map?.remove()
  map = null
})
</script>

<template>
  <div ref="mapElement" class="mapa-lugar" :aria-label="soloLectura ? 'Mapa del lugar' : 'Mapa: toca para marcar el lugar'"></div>
</template>
