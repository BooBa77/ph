import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'

const app = createApp(App)

app.use(createPinia())
app.use(router)

app.mount('#app')

// ВРЕМЕННО, для проверки bootstrap. Убрать после.
import { useAuthStore } from '@/stores/auth'
const auth = useAuthStore()
auth.bootstrap().then(() => {
  console.log('[bootstrap]', {
    isBootstrapped: auth.isBootstrapped,
    isAuthenticated: auth.isAuthenticated,
    accessToken: auth.accessToken,
    user: auth.user,
  })
})