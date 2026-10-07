import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
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

app.use(createPinia())
app.use(router)

app.mount('#app')
