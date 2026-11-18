<script setup>
import Plazas from '../components/Plazas.vue'
</script>

<template>
  <section class="view-page">
    <header class="view-header">
      <p class="view-kicker">Cliente · Banco Ganadero</p>
      <h1 class="view-title">Yolopago</h1>
      <p class="view-description">Las plazas del banco. Cada departamento es una plaza que agrupa sus municipios, hasta que uno de ellos se convierte en plaza propia (como Riberalta).</p>
    </header>

    <div class="panel-card">
      <Plazas />
    </div>
  </section>
</template>
