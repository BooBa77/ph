import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

/**
 * Конфиг тестов фронтенда.
 *
 * Собран отдельно от `vite.config.ts`, а не через mergeConfig: в основном
 * конфиге висят PWA и vue-devtools, которые в тестах не нужны и только
 * добавляют шума. Здесь только то, что действительно требуется — плагин
 * Vue (чтобы компилировались .vue) и алиас `@`.
 */
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.spec.ts'],
  },
})
