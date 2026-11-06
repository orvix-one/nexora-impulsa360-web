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
  gap: 0.35rem;
  padding: 0.35rem;
  border: 1px solid #bcd7ff;
  border-radius: 16px;
  background: linear-gradient(180deg, #eef5ff 0%, #dcebff 100%);
}

.metrics-tab {
  padding: 0.75rem 1rem;
  border-radius: 12px;
  color: #2c68b8;
  font-size: 0.95rem;
  font-weight: 800;
  text-align: center;
  text-decoration: none;
  transition:
    background 0.18s ease,
    color 0.18s ease,
    box-shadow 0.18s ease;
}

.metrics-tab:hover {
  background: rgba(255, 255, 255, 0.75);
  color: #0f4ecc;
}

.metrics-tab.router-link-active {
  background: linear-gradient(135deg, #3b8bff 0%, var(--ru-primary) 55%, #0f4ecc 100%);
  box-shadow: 0 6px 16px rgba(23, 105, 255, 0.35);
  color: #ffffff;
}
</style>
