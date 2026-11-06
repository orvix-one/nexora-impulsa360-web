<script setup>
import { formatNumber } from '../../lib/metrics/formato'
import { alturaBarra, maximo } from '../../lib/metrics/graficos'

defineProps({ items: { type: Array, required: true } })
</script>

<template>
  <div class="vertical-bars">
    <div
      v-for="item in items"
      :key="item.label"
      class="vertical-bar"
      :title="`${item.label}: ${formatNumber(item.value)} activaciones`"
    >
      <strong>{{ formatNumber(item.value) }}</strong>
      <span :style="{ height: alturaBarra(item.value, maximo(items)) }"></span>
      <small>{{ item.label }}</small>
    </div>
  </div>
</template>

<style scoped>
.vertical-bars {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(84px, 1fr);
  align-items: end;
  gap: 0.75rem;
  flex: 1;
  min-height: 240px;
  margin-top: 1rem;
  padding: 0.5rem 0.2rem 0;
  overflow-x: auto;
  border-bottom: 1px solid #c7d3df;
}

.vertical-bar {
  display: grid;
  grid-template-rows: 22px 1fr 3.4em;
  align-items: end;
  justify-items: center;
  min-width: 0;
  height: 100%;
  color: #24496d;
}

.vertical-bar span {
  width: 72%;
  min-height: 8px;
  border-radius: 7px 7px 0 0;
  background: linear-gradient(180deg, var(--ru-primary) 0%, var(--ru-primary-strong) 100%);
}

.vertical-bar strong {
  color: #6a849c;
  font-size: 0.72rem;
  line-height: 1;
}

.vertical-bar small {
  align-self: start;
  padding-top: 0.35rem;
  color: #55728e;
  font-size: 0.72rem;
  line-height: 1.15;
  overflow-wrap: anywhere;
  text-align: center;
}
</style>
