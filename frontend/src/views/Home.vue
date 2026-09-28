<!-- frontend/src/views/Home.vue -->

<script setup lang="ts">
import { ref } from 'vue'

import { logout } from '@/api/auth'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

const isLoggingOut = ref(false)
const errorMessage = ref<string | null>(null)

async function handleLogout() {
  errorMessage.value = null
  isLoggingOut.value = true
  try {
    await logout()
  } catch {
    // Даже если бэк упал — локально всё равно разлогинимся.
    // Сессия на бэке отзовётся сама по TTL, если что.
    // Не показываем ошибку: юзер хотел выйти — он вышел.
  } finally {
    auth.clear()
    isLoggingOut.value = false
    window.location.assign('/auth')
  }
}
</script>

<template>
  <main class="home">
    <h1>PeakHunter</h1>

    <p v-if="auth.user">
      Привет, <strong>{{ auth.user.displayName }}</strong>!
    </p>

    <button
      type="button"
      :disabled="isLoggingOut"
      class="home__logout"
      @click="handleLogout"
    >
      {{ isLoggingOut ? 'Выходим…' : 'Выйти' }}
    </button>
  </main>
</template>

<style scoped>
.home {
  max-width: 640px;
  margin: 4rem auto;
  padding: 1.5rem;
  font-family: system-ui, sans-serif;
}
.home__logout {
  margin-top: 1rem;
  padding: 0.5rem 1rem;
  font-size: 0.9rem;
  background: #eee;
  color: #333;
  border: 1px solid #ccc;
  border-radius: 6px;
  cursor: pointer;
}
.home__logout:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>