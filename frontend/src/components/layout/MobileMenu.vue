<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import SidebarIcon from '@/components/ui/SidebarIcon.vue'
import TripTabIcon from '@/components/trips/TripTabIcon.vue'
import { SITE_SECTIONS, type SiteIconName } from '@/components/layout/site-sections'
import { useLogout } from '@/composables/useLogout'
import { useMobileMenuStore, type MobileMenuEntry } from '@/stores/mobileMenu'
import { useAuthStore } from '@/stores/auth'
import type { TripTabCode } from '@/types/trips'

/**
 * Мобильное меню-гамбургер.
 *
 * Решение заказчика 26.10.2026: полосы ярлыков сверху больше нет, все
 * разделы открываются гамбургером в шапке. Гамбургер при этом **один на
 * два меню**: на странице похода он открывает вкладки похода, на остальных
 * страницах — разделы сайта. Что показать, решает не адрес, а контекст,
 * который положила страница (`useMobileMenuStore`).
 *
 * Панель выезжает справа — там же, где кнопка: палец остаётся на месте,
 * а левый верхний угол занят знаком-«домой».
 */
const menu = useMobileMenuStore()
const auth = useAuthStore()
const route = useRoute()
const { isConfirming, isLoggingOut, ask, cancel, confirm } = useLogout()

/** Панель: нужен фокус после открытия. */
const panel = ref<HTMLElement | null>(null)

const title = computed(() => menu.context?.title ?? 'Разделы сайта')

/** Разделы сайта или контекст страницы (вкладки похода). */
const entries = computed<MobileMenuEntry[]>(() => {
  if (menu.context) return menu.context.items
  return SITE_SECTIONS.map((section) => ({
    key: section.to,
    label: section.label,
    icon: section.icon,
    to: section.to,
  }))
})

/** Меню разделов сайта — единственное, где есть выход из аккаунта. */
const isSiteMenu = computed(() => menu.context === null)

/**
 * Имена иконок двух наборов в шаблоне одного типа. Приведение типов живёт
 * здесь, а не в шаблоне: `<TripTabIcon>` принимает только коды вкладок, а
 * `<SidebarIcon>` — имена меню, и путать их должен только этот компонент.
 */
function asSiteIcon(name: string): SiteIconName {
  return name as SiteIconName
}

function asTripIcon(name: string): TripTabCode {
  return name as TripTabCode
}

/** Вкладка похода: переключает содержимое и закрывает панель. */
function select(entry: MobileMenuEntry) {
  if (entry.available === false) return
  entry.onSelect?.()
  menu.close()
}

/** Escape закрывает панель: оверлей без выхода с клавиатуры — ловушка. */
function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  closedByKeyboard = true
  menu.close()
}

/**
 * Фокус возвращаем на кнопку **только после Escape**.
 *
 * Программный `focus()` браузер считает «фокусом с клавиатуры» и рисует
 * вокруг гамбургера кольцо. После тапа по подложке или по пункту меню это
 * кольцо висит до следующего касания и читается как «кнопка залипла».
 * С клавиатуры возврат фокуса обязателен — иначе человек оказывается
 * в начале документа; с пальцем он и так никуда не делся.
 */
let closedByKeyboard = false

/**
 * Прокрутка страницы под открытой панелью.
 *
 * Без этого жест по панели прокручивает страницу под ней — на телефоне это
 * читается как «меню прилипло и не слушается».
 */
let savedOverflow = ''

watch(
  () => menu.isOpen,
  async (isOpen) => {
    if (typeof document === 'undefined') return

    if (isOpen) {
      savedOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      window.addEventListener('keydown', onKeydown)
      await nextTick()
      panel.value?.focus()
      return
    }

    document.body.style.overflow = savedOverflow
    window.removeEventListener('keydown', onKeydown)
    isConfirming.value = false

    if (closedByKeyboard) {
      closedByKeyboard = false
      document.getElementById('site-menu-button')?.focus()
    }
  },
)

// Переход закрывает панель: она оверлей, и поверх новой страницы ей не место.
watch(
  () => route.fullPath,
  () => menu.close(),
)

onUnmounted(() => {
  if (typeof document === 'undefined') return
  window.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = savedOverflow
})
</script>

<template>
  <Transition name="menu">
    <!-- `md:hidden` на всей панели: на десктопе меню живёт колонкой слева,
         и второй способ открыть те же разделы там только путал бы. -->
    <div v-if="menu.isOpen" class="fixed inset-0 z-50 md:hidden" data-test="mobile-menu">
      <div
        class="absolute inset-0 bg-black/40"
        data-test="mobile-menu-backdrop"
        @click="menu.close()"
      />

      <div
        id="site-mobile-menu"
        ref="panel"
        class="menu__panel absolute inset-y-0 right-0 flex w-80 max-w-[85vw] flex-col border-l border-border bg-surface shadow-2xl outline-none"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
        tabindex="-1"
      >
        <div class="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <span class="text-sm font-medium text-text" data-test="mobile-menu-title">
            {{ title }}
          </span>

          <button
            type="button"
            class="cursor-pointer rounded-full p-2 text-muted transition-colors hover:bg-bg hover:text-text"
            aria-label="Закрыть меню"
            @click="menu.close()"
          >
            <span class="block h-5 w-5"><SidebarIcon name="close" /></span>
          </button>
        </div>

        <nav class="flex-1 overflow-y-auto p-2" :aria-label="title">
          <template v-for="entry in entries" :key="entry.key">
            <RouterLink
              v-if="entry.to"
              :to="entry.to"
              class="flex min-h-11 items-center gap-3 rounded px-2.5 text-base text-muted no-underline transition-colors hover:bg-bg hover:text-text"
              active-class="bg-bg font-medium text-primary"
              data-test="mobile-menu-link"
            >
              <span class="h-5 w-5 shrink-0"><SidebarIcon :name="asSiteIcon(entry.icon)" /></span>
              <span class="truncate">{{ entry.label }}</span>
            </RouterLink>

            <button
              v-else
              type="button"
              class="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded px-2.5 text-base transition-colors hover:bg-bg disabled:cursor-not-allowed"
              :class="
                entry.active
                  ? 'bg-bg font-medium text-primary'
                  : entry.available === false
                    ? 'text-muted opacity-45'
                    : 'text-muted hover:text-text'
              "
              :disabled="entry.available === false"
              :aria-current="entry.active ? 'page' : undefined"
              data-test="mobile-menu-tab"
              @click="select(entry)"
            >
              <span class="h-5 w-5 shrink-0"><TripTabIcon :name="asTripIcon(entry.icon)" /></span>
              <span class="min-w-0 flex-1 truncate text-left">{{ entry.label }}</span>
              <span v-if="entry.available === false" class="shrink-0 text-xs text-muted">
                скоро
              </span>
            </button>
          </template>
        </nav>

        <!-- Выход — только в меню разделов сайта: во вкладках похода его нет. -->
        <div v-if="isSiteMenu" class="border-t border-border p-2">
          <button
            v-if="!isConfirming"
            type="button"
            class="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded px-2.5 text-base text-muted transition-colors hover:bg-bg hover:text-text"
            @click="ask()"
          >
            <span class="h-5 w-5 shrink-0"><SidebarIcon name="logout" /></span>
            <span>Выйти</span>
          </button>

          <div v-else class="flex flex-col gap-1 px-2.5 py-2">
            <span class="text-xs text-muted">Выйти из аккаунта?</span>
            <div class="flex gap-1">
              <button
                type="button"
                :disabled="isLoggingOut"
                class="flex-1 cursor-pointer rounded border border-border bg-surface px-2 py-1 text-xs text-text transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
                @click="confirm()"
              >
                {{ isLoggingOut ? '…' : 'Да' }}
              </button>
              <button
                type="button"
                :disabled="isLoggingOut"
                class="flex-1 cursor-pointer rounded border border-border px-2 py-1 text-xs text-muted transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
                @click="cancel()"
              >
                Нет
              </button>
            </div>
          </div>

          <!-- Подпись под меню: на мобиле шапка показывает только знак
               (подпись «PeakHunter» скрыта), и место для неё есть здесь. -->
          <p v-if="auth.user" class="px-2.5 pt-2 text-xs text-muted">
            {{ auth.user.displayName }}
          </p>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* Панель выезжает справа, подложка проявляется. Длительности короткие:
   меню — служебная вещь, задерживать человека на анимации незачем. */
.menu-enter-active,
.menu-leave-active {
  transition: opacity 0.18s ease;
}

.menu-enter-active .menu__panel,
.menu-leave-active .menu__panel {
  transition: transform 0.2s ease;
}

.menu-enter-from,
.menu-leave-to {
  opacity: 0;
}

.menu-enter-from .menu__panel,
.menu-leave-to .menu__panel {
  transform: translateX(100%);
}

@media (prefers-reduced-motion: reduce) {
  .menu-enter-active,
  .menu-leave-active,
  .menu-enter-active .menu__panel,
  .menu-leave-active .menu__panel {
    transition: none;
  }
}
</style>
