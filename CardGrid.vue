<script setup>
defineProps({ columnas: { type: String, default: '' } })
</script>

<template>
  <section class="metrics-card-grid" :style="columnas ? { '--columnas': columnas } : {}">
    <slot />
  </section>
</template>

<style scoped>
.metrics-card-grid {
  display: grid;
  grid-template-columns: var(--columnas, repeat(auto-fit, minmax(300px, 1fr)));
  gap: 1rem;
  align-items: stretch;
  min-width: 0;
}

@media (max-width: 1100px) {
  .metrics-card-grid {
    grid-template-columns: 1fr;
  }
}
</style>
