import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { useOfflineStore } from '@/stores/offline'
import { applySeasonTheme } from '@/composables/useTheme'
import '@/assets/styles/main.css'

/**
 * Тему ставим до монтирования приложения.
 *
 * Она уже выставлена инлайн-скриптом в index.html (чтобы не мигало
 * белым до первой отрисовки), но повторная установка здесь нужна:
 * атрибут на <html> — единственный источник оформления, и если он
 * по какой-то причине пропал (перерисовка, SPA-переход, чужой код),
 * приложение вернётся к дефолтной палитре в themes.css, а это зима.
 * Ровно так и выглядела жалоба «после выхода наступает зима».
 *
 * Функция идемпотентная: повторный вызов просто ставит тот же сезон.
 */
applySeasonTheme()

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)

/**
 * Офлайн-состояние читаем до первого перехода.
 *
 * Guard спрашивает у стора, какие походы сохранены; если не начать чтение
 * здесь, первый переход ждал бы IndexedDB в самом guard. Вызов не ждём:
 * guard дождётся итога через `offline.init()` — промис один и тот же.
 */
void useOfflineStore(pinia).init()

app.use(router)

app.mount('#app')
