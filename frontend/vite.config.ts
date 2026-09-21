import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
    VitePWA({
      // Свой SW через injectManifest — полный контроль над логикой обновления
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',

      // Не обновляем автоматически — рулим вручную через useSwUpdate
      registerType: 'prompt',

      // В dev PWA полностью выключена (никакого SW, никакого манифеста)
      devOptions: {
        enabled: false,
      },

      manifest: {
        id: '/',
        name: 'PeakHunter',
        short_name: 'PeakHunter',
        description: 'Социалка походников Прибайкалья: поиск попутчиков, анонсы походов, дневники.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#0b3d91',
        background_color: '#ffffff',
        lang: 'ru',
        categories: ['travel', 'sports', 'social'],
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },      

      injectManifest: {
        // Что кладём в precache при сборке
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    // HMR через проброшенный наружу порт — иначе WebSocket не подключается
    hmr: {
      clientPort: 5173,
    },
    watch: {
      // Windows + Docker: файловые события не всегда доходят, нужен polling
      usePolling: true,
      interval: 300,
    },
  },
})