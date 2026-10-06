<!-- frontend/src/components/layout/AppHeader.vue -->

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import { logout } from '@/api/auth'
import { useAuthStore } from '@/stores/auth'
import { usePwaInstall } from '@/composables/usePwaInstall'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import ThemeSwitcher from '@/components/ui/ThemeSwitcher.vue'

const auth = useAuthStore()
const route = useRoute()
const { canInstall, promptInstall } = usePwaInstall()

const isLoggingOut = ref(false)

/** Меню открыто. */
const isMenuOpen = ref(false)

/** Корень шапки — по нему ловим клик «мимо меню». */
const headerRef = ref<HTMLElement | null>(null)

const user = computed(() => auth.user)

/**
 * Переход по роуту закрывает меню.
 *
 * Нужен в дополнение к обработчику кликов по ссылкам (см. разметку):
 * так закрывается переход, случившийся вообще без клика по шапке —
 * кнопка «назад» в браузере или программный `router.push`.
 *
 * Одного его мало: клик по ссылке на текущую же страницу перехода
 * не вызывает, и меню осталось бы висеть.
 */
watch(
  () => route.fullPath,
  () => {
    isMenuOpen.value = false
  },
)

/** Закрыть меню по клику на пункт. Используется в разметке. */
function closeMenu() {
  isMenuOpen.value = false
}

/**
 * Клик мимо меню закрывает меню.
 *
 * Слушатель на документе, а не на кнопке с blur: blur срабатывает
 * раньше клика по пункту меню, и меню закрывалось бы, не дав нажать.
 *
 * Проверяем, что клик был ВНЕ шапки целиком, а не вне меню: клик
 * по самой кнопке-аватарке обрабатывается её @click, и если считать
 * его «мимо», получится toggle с двойным закрытием.
 */
function onDocumentClick(event: MouseEvent) {
  if (!isMenuOpen.value) return
  const target = event.target as Node | null
  if (headerRef.value && target && !headerRef.value.contains(target)) {
    isMenuOpen.value = false
  }
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') isMenuOpen.value = false
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onDocumentKeydown)
})

onBeforeUnmount(() => {
  // Слушатели снимаем парно: шапки нет на /auth, и обработчики
  // на документе там висели бы впустую.
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onDocumentKeydown)
})

async function handleLogout() {
  isLoggingOut.value = true
  try {
    await logout()
  } catch {
    // Даже если бэк упал — локально всё равно разлогинимся.
    // Сессия на бэке отзовётся сама по TTL, если что.
  } finally {
    auth.clear()
    isLoggingOut.value = false
    window.location.assign('/auth')
  }
}

async function handleInstall() {
  isMenuOpen.value = false
  await promptInstall()
}
</script>

<template>
  <header
    ref="headerRef"
    class="relative flex items-center justify-between gap-2 border-b border-border bg-surface px-4 py-3"
  >
      <!--
        Логотип — и заголовок, и кнопка «домой»: ссылка на / приложения.
        Отдельная кнопка Home на мобиле не нужна, логотип и есть home.

        Текст прячем на очень узких экранах: с аватаркой и гамбургером
        «PeakHunter» перестаёт помещаться, а иконка остаётся узнаваемой.

        @click закрывает меню: если пользователь уже на главной, перехода
        не произойдёт, наблюдатель за роутом промолчит, и меню осталось бы
        висеть открытым поверх страницы.
      -->
    <RouterLink
      to="/"
      class="text-lg font-semibold text-text no-underline"
      aria-label="На главную"
      @click="closeMenu"
    >
      <span class="hidden min-[380px]:inline">PeakHunter</span>
      <span class="min-[380px]:hidden">PH</span>
    </RouterLink>

    <!--
      Меню одно на все размеры экрана: и аватарка, и гамбургер открывают
      его. Разные меню для мобилы и десктопа — это два места, где одна
      и та же логика разъедется.
    -->
    <div class="flex items-center gap-2">
      <button
        v-if="user"
        type="button"
        class="flex cursor-pointer items-center gap-2 rounded-full border border-border bg-bg py-1 pr-1 pl-1 text-sm text-text transition-colors hover:border-primary sm:pr-3"
        :aria-expanded="isMenuOpen"
        aria-haspopup="menu"
        :aria-label="user.displayName"
        @click="isMenuOpen = !isMenuOpen"
      >
        <UserAvatar :src="user.avatarUrl" :size="32" :alt="user.displayName" />
        <span class="hidden max-w-32 truncate sm:inline">
          {{ user.displayName }}
        </span>
      </button>

      <!--
        Гамбургер — только на мобиле. На десктопе меню открывает аватарка,
        и второй триггер рядом с ней был бы лишним.
      -->
      <button
        v-if="user"
        type="button"
        class="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-border text-text transition-colors hover:border-primary sm:hidden"
        :aria-expanded="isMenuOpen"
        aria-haspopup="menu"
        aria-label="Меню"
        @click="isMenuOpen = !isMenuOpen"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      <div
        v-if="isMenuOpen && user"
        class="absolute top-full right-2 z-40 mt-1 w-60 rounded-xl border border-border bg-surface py-1 shadow-lg"
        role="menu"
      >
        <div class="border-b border-border px-4 py-2">
          <div class="truncate text-sm font-medium text-text">
            {{ user.displayName }}
          </div>
          <div v-if="user.location" class="truncate text-xs text-muted">
            {{ user.location }}
          </div>
        </div>

        <RouterLink
          to="/profile"
          class="block px-4 py-2 text-sm text-text no-underline transition-colors hover:bg-bg"
          role="menuitem"
          @click="closeMenu"
        >
          Личный кабинет
        </RouterLink>

        <ThemeSwitcher />

        <button
          v-if="canInstall"
          type="button"
          class="block w-full cursor-pointer border-t border-border px-4 py-2 text-left text-sm text-text transition-colors hover:bg-bg"
          role="menuitem"
          @click="handleInstall"
        >
          Установить приложение
        </button>

        <button
          type="button"
          :disabled="isLoggingOut"
          class="block w-full cursor-pointer border-t border-border px-4 py-2 text-left text-sm text-text transition-colors hover:bg-bg disabled:cursor-not-allowed disabled:opacity-50"
          role="menuitem"
          @click="handleLogout"
        >
          {{ isLoggingOut ? 'Выходим…' : 'Выйти' }}
        </button>
      </div>
    </div>
  </header>
</template>
