<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'

import { requestCode, verifyCode } from '@/api/auth'
import { ApiError } from '@/api/errors'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

// Шаг формы: 'email' — ввод email, 'code' — ввод кода.
const step = ref<'email' | 'code'>('email')

const email = ref('')
const code = ref('')

// Общее состояние запроса.
const isLoading = ref(false)
const errorMessage = ref<string | null>(null)

// Кулдаун на повторную отправку кода (секунды).
const resendAfter = ref(0)
let resendTimer: ReturnType<typeof setInterval> | null = null

const canSubmitEmail = computed(
  () => email.value.trim().length > 0 && !isLoading.value,
)

const canSubmitCode = computed(
  () => code.value.trim().length > 0 && !isLoading.value,
)

const canResend = computed(() => resendAfter.value === 0 && !isLoading.value)

function startResendTimer(seconds: number) {
  resendAfter.value = seconds
  if (resendTimer) clearInterval(resendTimer)
  resendTimer = setInterval(() => {
    resendAfter.value -= 1
    if (resendAfter.value <= 0 && resendTimer) {
      clearInterval(resendTimer)
      resendTimer = null
    }
  }, 1000)
}

onUnmounted(() => {
  if (resendTimer) clearInterval(resendTimer)
})

/** Достать сообщение из ошибки: ApiError → .message, иначе общий текст. */
function humanizeError(e: unknown): string {
  if (e instanceof ApiError) return e.message
  return 'Не удалось связаться с сервером'
}

async function handleRequestCode() {
  errorMessage.value = null
  isLoading.value = true
  try {
    const res = await requestCode(email.value.trim())
    step.value = 'code'
    startResendTimer(res.resendAfterSeconds)
  } catch (e) {
    errorMessage.value = humanizeError(e)
  } finally {
    isLoading.value = false
  }
}

async function handleVerifyCode() {
  errorMessage.value = null
  isLoading.value = true
  try {
    const res = await verifyCode(email.value.trim(), code.value.trim())
    // auth.ts не знает про Pinia — кладём в store здесь, в компоненте.
    auth.setAuth(res.user, res.accessToken)
    // Редирект на / сделает router guard: он увидит isAuthenticated = true
    // и … нет, guard сработает только при переходе. Сделаем переход явно.
    // Но: в этот момент мы на /auth, а после setAuth isAuthenticated = true —
    // нужно куда-то уйти. Перекинем на /.
    window.location.assign('/')
  } catch (e) {
    errorMessage.value = humanizeError(e)
  } finally {
    isLoading.value = false
  }
}

function backToEmail() {
  step.value = 'email'
  code.value = ''
  errorMessage.value = null
  if (resendTimer) {
    clearInterval(resendTimer)
    resendTimer = null
  }
  resendAfter.value = 0
}
</script>

<template>
  <main class="auth">
    <h1>PeakHunter</h1>

    <form
      v-if="step === 'email'"
      class="auth__form"
      @submit.prevent="handleRequestCode"
    >
      <label class="auth__label">
        Email
        <input
          v-model="email"
          type="email"
          autocomplete="email"
          required
          :disabled="isLoading"
          class="auth__input"
        />
      </label>

      <button
        type="submit"
        :disabled="!canSubmitEmail"
        class="auth__submit"
      >
        {{ isLoading ? 'Отправляем…' : 'Получить код' }}
      </button>
    </form>

    <form
      v-else
      class="auth__form"
      @submit.prevent="handleVerifyCode"
    >
      <p class="auth__hint">
        Код отправлен на <strong>{{ email }}</strong>
      </p>

      <label class="auth__label">
        Код из письма
        <input
          v-model="code"
          type="text"
          inputmode="numeric"
          autocomplete="one-time-code"
          required
          :disabled="isLoading"
          class="auth__input"
        />
      </label>

      <button
        type="submit"
        :disabled="!canSubmitCode"
        class="auth__submit"
      >
        {{ isLoading ? 'Проверяем…' : 'Войти' }}
      </button>

      <div class="auth__actions">
        <button
          type="button"
          :disabled="!canResend"
          class="auth__link"
          @click="handleRequestCode"
        >
          {{ resendAfter > 0 ? `Повторно через ${resendAfter} с` : 'Отправить ещё раз' }}
        </button>

        <button
          type="button"
          class="auth__link"
          @click="backToEmail"
        >
          Изменить email
        </button>
      </div>
    </form>

    <p v-if="errorMessage" class="auth__error">{{ errorMessage }}</p>
  </main>
</template>

<style scoped>
/*
  Здесь единственное место в проекте со своими CSS-классами вместо
  Tailwind-утилит — страница входа осталась с самого начала. Поэтому
  цвета берём из тех же переменных темы, что и остальное приложение:
  иначе страница входа не подхватывает сезонную палитру и выглядит
  чужой (синяя кнопка на осеннем фоне).
*/
.auth {
  max-width: 360px;
  margin: 4rem auto;
  padding: 1.5rem;
  color: var(--theme-text);
}
.auth__form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-top: 1rem;
}
.auth__label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.9rem;
  color: color-mix(in srgb, var(--theme-text) 75%, transparent);
}
.auth__input {
  padding: 0.5rem 0.75rem;
  font-size: 1rem;
  font-family: inherit;
  border: 1px solid var(--theme-border);
  border-radius: 6px;
  /*
    Непрозрачный фон — не косметика. Поле лежало прозрачным поверх
    сезонного декора, и сквозь него были видны падающие листья:
    читаемость ввода страдала, а выглядело это как забытый стиль.
    Берём фон страницы из темы, а не white: на цветных темах
    (весна, лето, осень) белый прямоугольник выбивался бы.
  */
  background-color: var(--theme-bg);
  color: var(--theme-text);
}
.auth__input:focus {
  outline: 2px solid var(--theme-primary);
  outline-offset: -1px;
}
.auth__input:focus-visible {
  outline: 2px solid var(--theme-primary);
}
.auth__submit {
  padding: 0.6rem 1rem;
  font-size: 1rem;
  font-family: inherit;
  background: var(--theme-primary);
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}
.auth__submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.auth__actions {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
}
.auth__link {
  background: none;
  border: none;
  color: var(--theme-primary);
  cursor: pointer;
  padding: 0;
  font-family: inherit;
  font-size: 0.85rem;
  text-decoration: underline;
}
.auth__link:disabled {
  color: var(--theme-muted);
  cursor: not-allowed;
  text-decoration: none;
}
.auth__hint {
  margin: 0;
  font-size: 0.9rem;
  color: color-mix(in srgb, var(--theme-text) 80%, transparent);
}
.auth__error {
  margin-top: 1rem;
  padding: 0.5rem 0.75rem;
  /* Красный — фиксированный: сигнал об ошибке не должен зависеть
     от сезона и сливаться с фоном летней или весенней темы. */
  background: #fdecea;
  color: #b3261e;
  border-radius: 6px;
  font-size: 0.9rem;
}
</style>