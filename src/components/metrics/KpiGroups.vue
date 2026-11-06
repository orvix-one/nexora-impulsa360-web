<script setup>
defineProps({ grupos: { type: Array, required: true } })
</script>

<template>
  <div class="metrics-kpi-groups">
    <section
      v-for="grupo in grupos"
      :key="grupo.key"
      :class="`metrics-kpi-group metrics-kpi-group-${grupo.key}`"
    >
      <p class="metrics-kpi-group-label">{{ grupo.label }}</p>
      <div
        class="metrics-kpi-grid metrics-kpi-grid-compact"
        :style="{ '--cols': grupo.tarjetas.length }"
      >
        <article
          v-for="card in grupo.tarjetas"
          :key="card.key"
          class="metrics-kpi-card"
          :title="`${card.label}: ${card.value}`"
        >
          <span class="metrics-kpi-icon">{{ card.icon }}</span>
          <div>
            <p class="metrics-kpi-label">{{ card.label }}</p>
            <p class="metrics-kpi-value">{{ card.value }}</p>
            <p class="metrics-kpi-note">{{ card.note }}</p>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>

<style scoped>
.metrics-kpi-groups {
  display: grid;
  grid-template-columns: 3fr 2fr;
  gap: 0.9rem 1rem;
}

.metrics-kpi-group {
  min-width: 0;
}

.metrics-kpi-group-volumen {
  grid-column: 1 / -1;
}

.metrics-kpi-group-label {
  margin: 0 0 0.35rem 0.15rem;
  color: #b7cde4;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.metrics-kpi-grid-compact {
  grid-template-columns: repeat(var(--cols, 4), minmax(0, 1fr));
  gap: 1rem;
}

.metrics-kpi-grid-compact :deep(.metrics-kpi-card) {
  min-height: 116px;
  height: 116px;
  grid-template-columns: 34px minmax(0, 1fr);
  align-items: center;
  padding: 0.85rem;
  border-radius: 14px;
}

.metrics-kpi-grid-compact :deep(.metrics-kpi-icon) {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  font-size: 1rem;
}

.metrics-kpi-grid-compact :deep(.metrics-kpi-value) {
  font-size: clamp(1.55rem, 1.9vw, 2rem);
}

.metrics-kpi-grid-compact :deep(.metrics-kpi-label),
.metrics-kpi-grid-compact :deep(.metrics-kpi-note) {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.metrics-kpi-grid-compact :deep(.metrics-kpi-label) {
  -webkit-line-clamp: 2;
}

.metrics-kpi-grid-compact :deep(.metrics-kpi-note) {
  -webkit-line-clamp: 1;
}

@media (max-width: 1100px) {
  .metrics-kpi-groups {
    grid-template-columns: 1fr;
  }

  .metrics-kpi-grid-compact {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .metrics-kpi-grid-compact {
    grid-template-columns: 1fr;
  }

  .metrics-kpi-grid-compact :deep(.metrics-kpi-card) {
    min-height: 104px;
    height: 104px;
  }
}
</style>
