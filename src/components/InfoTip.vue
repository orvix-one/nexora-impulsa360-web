<script setup>
import { useId } from 'vue'

defineProps({
  text: { type: String, required: true },
})

const tipId = useId()
</script>

<template>
  <span class="info-tip">
    <button type="button" class="info-tip-trigger" :aria-describedby="tipId" aria-label="Mas informacion">i</button>
    <span :id="tipId" role="tooltip" class="info-tip-bubble">{{ text }}</span>
  </span>
</template>

<style scoped>
.info-tip {
  position: relative;
  display: inline-flex;
  vertical-align: middle;
  margin-left: 0.3rem;
}

.info-tip-trigger {
  width: 1.05rem;
  height: 1.05rem;
  padding: 0;
  border: 1px solid rgba(72, 111, 148, 0.45);
  border-radius: 999px;
  background: #ffffff;
  color: #24496d;
  font: italic 700 0.62rem/1 Georgia, serif;
  text-transform: none;
  letter-spacing: 0;
  cursor: help;
}

.info-tip-trigger:focus-visible {
  outline: 2px solid var(--ru-primary);
  outline-offset: 1px;
}

.info-tip-bubble {
  position: absolute;
  top: calc(100% + 6px);
  left: 50%;
  z-index: 20;
  width: min(250px, 70vw);
  transform: translateX(-50%);
  padding: 0.5rem 0.6rem;
  border-radius: 10px;
  background: var(--ru-ink);
  color: #ffffff;
  font-size: 0.72rem;
  font-weight: 500;
  line-height: 1.35;
  letter-spacing: 0;
  text-transform: none;
  box-shadow: var(--shadow-soft);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 120ms ease;
}

.info-tip:hover .info-tip-bubble,
.info-tip-trigger:focus + .info-tip-bubble {
  opacity: 1;
  visibility: visible;
}
</style>
