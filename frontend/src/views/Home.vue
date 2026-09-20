<script setup lang="ts">
import { useAppStore } from '@/stores/app'

const appStore = useAppStore()
</script>

<template>
  <div class="home">
    <h1>PeakHunter</h1>
    <p>Каркас живой. Pinia подключена.</p>
    <p>isUserBusy: {{ appStore.isUserBusy }}</p>
  </div>
</template>

<style scoped>
.home {
  padding: 2rem;
  font-family: sans-serif;
}
</style>