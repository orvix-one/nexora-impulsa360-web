<script setup>
import { useRoute } from 'vue-router'

const route = useRoute()
const TABS = [
  { path: '/metricas/resumen', label: 'Resumen' },
  { path: '/metricas/equipos', label: 'Equipos' },
  { path: '/metricas/campo', label: 'Campo' },
]
</script>

<template>
  <nav class="metrics-tabs" role="tablist" aria-label="Secciones de métricas">
    <router-link
      v-for="tab in TABS"
      :key="tab.path"
      :to="{ path: tab.path, query: route.query }"
      class="metrics-tab"
      role="tab"
    >
      {{ tab.label }}
    </router-link>
  </nav>
</template>

<style scoped>
.metrics-tabs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.42rem;
}

.metrics-tab {
  min-height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.5rem 0.78rem;
  border-radius: 999px;
  border: 1px solid rgba(167, 193, 220, 0.3);
  color: #bfd4ea;
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  background: rgba(255, 255, 255, 0.04);
  transition:
    transform 0.2s ease,
    background-color 0.2s ease,
    border-color 0.2s ease;
}

.metrics-tab:hover {
  transform: translateY(-1px);
  border-color: rgba(183, 210, 237, 0.55);
  background: rgba(255, 255, 255, 0.09);
}

.metrics-tab.router-link-active {
  color: #ffffff;
  border-color: transparent;
  background: var(--ru-primary);
  box-shadow: 0 9px 20px rgba(23, 105, 255, 0.35);
}
</style>
