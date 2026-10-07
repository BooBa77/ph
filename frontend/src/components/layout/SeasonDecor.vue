<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { useAppStore } from '@/stores/app'

interface Leaf {
  left: number
  duration: number
  delay: number
  size: number
  sway: number
  color: string
  spin: number
  direction: 1 | -1
  opacity: number
  blur: number
}

const AUTUMN_COLORS = ['#c4421a', '#d97b2b', '#a8621a', '#8f4b1f', '#c9a227']

const appStore = useAppStore()
const leaves = ref<Leaf[]>([])

const isAutumn = computed(() => appStore.currentTheme === 4)

function makeLeaves(): Leaf[] {
  const count = window.innerWidth < 640 ? 10 : 18

  return Array.from({ length: count }, () => {
    const duration = 45 + Math.random() * 45
    const isFar = Math.random() < 0.45

    return {
      left: Math.random() * 100,
      duration,
      delay: -Math.random() * duration,
      size: isFar ? 0.7 + Math.random() * 0.4 : 1 + Math.random() * 0.8,
      sway: 18 + Math.random() * 42,
      color:
        AUTUMN_COLORS[Math.floor(Math.random() * AUTUMN_COLORS.length)] ??
        AUTUMN_COLORS[0]!,
      spin: 0.5 + Math.random() * 1.5,
      direction: Math.random() < 0.5 ? -1 : 1,
      opacity: isFar ? 0.28 + Math.random() * 0.18 : 0.45 + Math.random() * 0.2,
      blur: isFar ? 1.2 : 0,
    }
  })
}

onMounted(() => {
  leaves.value = makeLeaves()
})
</script>

<template>
  <div v-if="isAutumn" class="leaves" aria-hidden="true">
    <span
      v-for="(leaf, index) in leaves"
      :key="index"
      class="leaf"
      :style="{
        '--left': `${leaf.left}%`,
        '--duration': `${leaf.duration}s`,
        '--delay': `${leaf.delay}s`,
        '--size': `${leaf.size}rem`,
        '--sway': `${leaf.sway}px`,
        '--color': leaf.color,
        '--opacity': String(leaf.opacity),
        '--blur': `${leaf.blur}px`,
        '--spin-duration': `${leaf.duration / leaf.spin}s`,
        '--direction': String(leaf.direction),
      }"
    >
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path
          d="M12 2c3.6 2.4 6.4 5.6 6.4 9.2 0 3.4-2.4 6.2-5.4 7.4V22a.9.9 0 0 1-1.8 0v-3.4C8.2 17.4 5.8 14.6 5.8 11.2 5.8 7.6 8.6 4.4 12 2Z"
        />
        <path
          d="M12 4v14M12 9l3.2-2.2M12 9 8.8 6.8M12 13.5l3.4-2.4M12 13.5l-3.4-2.4"
          stroke="rgba(0,0,0,.18)"
          stroke-width="1"
          fill="none"
        />
      </svg>
    </span>
  </div>
</template>

<style>
.leaves {
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  overflow: hidden;
}
.leaf {
  position: absolute;
  top: -5vh;
  left: var(--left);
  width: var(--size);
  height: var(--size);
  color: var(--color);
  will-change: transform;
  animation: season-leaf-fall var(--duration) linear var(--delay) infinite;
}
.leaf svg {
  display: block;
  width: 100%;
  height: 100%;
  opacity: var(--opacity);
  filter: blur(var(--blur));
  animation:
    season-leaf-sway calc(var(--duration) / 4) ease-in-out var(--delay) infinite alternate,
    season-leaf-spin var(--spin-duration) linear var(--delay) infinite;
  transform-origin: 50% 45%;
}
@keyframes season-leaf-fall {
  to {
    transform: translateY(110vh) rotate(360deg);
  }
}
@keyframes season-leaf-sway {
  from { margin-left: calc(var(--sway) / -2); }
  to   { margin-left: calc(var(--sway) / 2); }
}
@keyframes season-leaf-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(calc(360deg * var(--direction))); }
}
</style>