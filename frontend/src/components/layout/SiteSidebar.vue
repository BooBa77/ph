<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import { logout } from '@/api/auth'
import { useAuthStore } from '@/stores/auth'
import SidebarIcon from '@/components/ui/SidebarIcon.vue'

/**
 * Меню сайта: разделы и выход.
 *
 * Одно меню на всё приложение — и на главной, и в кабинете. Раньше
 * «Профиль, Календарь, Спорт, Настройки» жили внутри личного кабинета,
 * а на главной меню не было вовсе; второго меню не заводим: разделы сайта
 * и разделы аккаунта — один список, и место у него одно.
 *
 * Адаптив: на десктопе это колонка слева со всеми пунктами, на мобиле —
 * полоса сверху. В полосу влезают не все разделы, поэтому первые
 * `FAVOURITES_LIMIT` остаются ярлыками, а остальное (и «Выйти») уезжает
 * в гамбургер.
 */
const FAVOURITES_LIMIT = 5

/** Разделы сайта. Порядок = порядок в меню и на мобильной полосе. */
const SECTIONS = [
  { to: '/', label: 'Главная', icon: 'home' },
  { to: '/profile/personal', label: 'Профиль', icon: 'profile' },
  { to: '/profile/calendar', label: 'Календарь', icon: 'calendar' },
  { to: '/profile/sport', label: 'Спорт', icon: 'sport' },
  { to: '/profile/settings', label: 'Настройки', icon: 'settings' },
] as const

const favourites = computed(() => SECTIONS.slice(0, FAVOURITES_LIMIT))
const rest = computed(() => SECTIONS.slice(FAVOURITES_LIMIT))

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

/** Открыта ли панель «всё остальное» (только на мобиле). */
const isMenuOpen = ref(false)

/** Спрашиваем подтверждение перед выходом. */
const isConfirmingLogout = ref(false)
const isLoggingOut = ref(false)

/**
 * Закрыть панель. Вызывается и по переходу: панель — оверлей, и если
 * оставить её открытой, пользователь увидит её поверх новой страницы.
 */
function closeMenu() {
  isMenuOpen.value = false
  isConfirmingLogout.value = false
}

/** Escape закрывает панель: оверлей без выхода с клавиатуры — ловушка. */
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeMenu()
}

watch(isMenuOpen, (open) => {
  if (open) window.addEventListener('keydown', onKeydown)
  else window.removeEventListener('keydown', onKeydown)
})

// Переход закрывает панель.
watch(
  () => route.fullPath,
  () => closeMenu(),
)

onUnmounted(() => window.removeEventListener('keydown', onKeydown))

/**
 * Выход.
 *
 * Порядок: сначала очищаем состояние, потом уходим. Переход делает
 * `useAuthRedirect` — он следит за `isAuthenticated` на уровне
 * приложения. Дублируем его вызовом `router.push`, чтобы уход не зависел
 * от того, успел ли сработать наблюдатель.
 */
async function confirmLogout() {
  isLoggingOut.value = true
  try {
    await logout()
  } catch {
    // Даже если бэк упал — локально всё равно разлогинимся.
    // Сессия на бэке отзовётся сама по TTL.
  } finally {
    auth.clear()
    isLoggingOut.value = false
    closeMenu()
    await router.push({ name: 'auth' })
  }
}
</script>

<template>
  <nav
    class="flex items-stretch gap-1 overflow-x-auto md:flex-col md:gap-0 md:overflow-visible"
    aria-label="Разделы сайта"
  >
    <!--
      Ярлыки. На мобиле это вся полоса (кроме гамбургера), на десктопе —
      начало колонки: разницы в разметке нет, только в раскладке.
    -->
    <RouterLink
      v-for="section in favourites"
      :key="section.to"
      :to="section.to"
      class="flex flex-1 items-center justify-center gap-2 rounded px-3 py-2 text-sm text-muted no-underline transition-colors hover:bg-bg hover:text-text md:flex-none md:justify-start md:rounded-none md:px-4 md:hover:bg-surface"
      active-class="bg-bg font-medium text-primary md:bg-surface"
      :aria-label="section.label"
    >
      <span class="h-5 w-5 shrink-0"><SidebarIcon :name="section.icon" /></span>
      <span class="hidden md:inline">{{ section.label }}</span>
    </RouterLink>

    <!--
      Разделы сверх избранных: на десктопе они тут же в колонке, на мобиле
      их показывает гамбургер (этот список скрыт до `md`).
    -->
    <RouterLink
      v-for="section in rest"
      :key="section.to"
      :to="section.to"
      class="hidden md:flex md:flex-none md:items-center md:justify-start md:gap-2 md:rounded-none md:px-4 md:py-2 md:text-sm md:text-muted md:no-underline md:transition-colors md:hover:bg-surface md:hover:text-text"
      active-class="md:bg-surface md:font-medium md:text-primary"
      :aria-label="section.label"
    >
      <span class="h-5 w-5 shrink-0"><SidebarIcon :name="section.icon" /></span>
      <span class="hidden md:inline">{{ section.label }}</span>
    </RouterLink>

    <!-- Гамбургер: то, что не влезло в полосу ярлыков -->
    <button
      type="button"
      class="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded px-3 py-2 text-sm text-muted transition-colors hover:bg-bg hover:text-text md:hidden"
      :aria-expanded="isMenuOpen"
      aria-label="Все разделы"
      @click="isMenuOpen = !isMenuOpen"
    >
      <span class="h-5 w-5 shrink-0">
        <SidebarIcon :name="isMenuOpen ? 'close' : 'menu'" />
      </span>
    </button>

    <!-- Выход: на десктопе отделён чертой, на мобиле живёт в гамбургере -->
    <div class="hidden md:mt-3 md:block md:border-t md:border-border md:pt-3">
      <button
        v-if="!isConfirmingLogout"
        type="button"
        class="flex w-full cursor-pointer items-center justify-start gap-2 rounded-none px-4 py-2 text-sm text-muted transition-colors hover:bg-surface hover:text-text"
        @click="isConfirmingLogout = true"
      >
        <span class="h-5 w-5 shrink-0"><SidebarIcon name="logout" /></span>
        <span>Выйти</span>
      </button>

      <div v-else class="flex flex-col gap-1 px-4 py-2">
        <span class="text-xs text-muted">Выйти из аккаунта?</span>
        <div class="flex gap-1">
          <button
            type="button"
            :disabled="isLoggingOut"
            class="flex-1 cursor-pointer rounded border border-border bg-surface px-2 py-1 text-xs text-text transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
            @click="confirmLogout"
          >
            {{ isLoggingOut ? '…' : 'Да' }}
          </button>
          <button
            type="button"
            :disabled="isLoggingOut"
            class="flex-1 cursor-pointer rounded border border-border px-2 py-1 text-xs text-muted transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
            @click="isConfirmingLogout = false"
          >
            Нет
          </button>
        </div>
      </div>
    </div>

    <!--
      Панель «всё остальное». Оверлей на весь экран с подложкой: без неё
      нажатие мимо панели не закрывало бы её, и это читается как поломка.
    -->
    <div v-if="isMenuOpen" class="fixed inset-0 z-40 md:hidden">
      <div
        class="absolute inset-0 bg-black/30"
        @click="closeMenu"
      />

      <div
        class="absolute inset-x-0 top-0 rounded-b-2xl border-b border-border bg-surface p-4 shadow-lg"
      >
        <div class="mb-2 flex items-center justify-between">
          <span class="text-sm font-medium text-text">Все разделы</span>
          <button
            type="button"
            class="cursor-pointer rounded px-2 py-1 text-sm text-muted transition-colors hover:text-text"
            @click="closeMenu"
          >
            Закрыть
          </button>
        </div>

        <RouterLink
          v-for="section in rest"
          :key="section.to"
          :to="section.to"
          class="flex items-center gap-3 rounded px-2 py-2 text-sm text-muted no-underline transition-colors hover:bg-bg hover:text-text"
          active-class="bg-bg font-medium text-primary"
        >
          <span class="h-5 w-5 shrink-0">
            <SidebarIcon :name="section.icon" />
          </span>
          {{ section.label }}
        </RouterLink>

        <button
          v-if="!isConfirmingLogout"
          type="button"
          class="mt-1 flex w-full cursor-pointer items-center gap-3 rounded px-2 py-2 text-sm text-muted transition-colors hover:bg-bg hover:text-text"
          @click="isConfirmingLogout = true"
        >
          <span class="h-5 w-5 shrink-0"><SidebarIcon name="logout" /></span>
          <span>Выйти</span>
        </button>

        <div v-else class="mt-1 flex flex-col gap-1 px-2 py-2">
          <span class="text-xs text-muted">Выйти из аккаунта?</span>
          <div class="flex gap-1">
            <button
              type="button"
              :disabled="isLoggingOut"
              class="flex-1 cursor-pointer rounded border border-border bg-surface px-2 py-1 text-xs text-text transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
              @click="confirmLogout"
            >
              {{ isLoggingOut ? '…' : 'Да' }}
            </button>
            <button
              type="button"
              :disabled="isLoggingOut"
              class="flex-1 cursor-pointer rounded border border-border px-2 py-1 text-xs text-muted transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
              @click="isConfirmingLogout = false"
            >
              Нет
            </button>
          </div>
        </div>
      </div>
    </div>
  </nav>
</template>
