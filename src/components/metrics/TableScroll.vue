<template>
  <div class="table-wrap metrics-table-scroll"><slot /></div>
</template>

<style scoped>
.metrics-table-scroll {
  flex: 1;
  min-height: 0;
  margin-top: 1rem;
  overflow: auto;
  border: 1px solid #d8e4ef;
  border-radius: 12px;
}

.metrics-table-scroll :deep(table) {
  min-width: 620px;
}

.metrics-table-scroll :deep(thead th) {
  position: sticky;
  top: 0;
  z-index: 1;
}
</style>
