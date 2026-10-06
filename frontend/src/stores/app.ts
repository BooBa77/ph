// frontend/src/stores/app.ts

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { isValidSeason, type Season } from '@/types/theme'

/**
 * Ключ в localStorage для последнего открытого раздела личного кабинета.
 *
 * Хранится локально, а не на сервере: это про удобство конкретного
 * браузера, а не про данные пользователя. В базе заводить колонку
 * «последняя страница ЛК» смысла нет.
 */
const LAST_PROFILE_PATH_KEY = 'ph.lastProfilePath'

/** Раздел личного кабинета по умолчанию. */
export const DEFAULT_PROFILE_PATH = '/profile/personal'

/**
 * Прочитать сохранённый путь.
 *
 * Проверяем, что это действительно раздел ЛК: в localStorage могло
 * попасть что угодно (ручная правка, старый формат, чужой ключ), а
 * подставлять это в ссылку «Профиль» нельзя — можно уехать на чужой
 * адрес.
 */
function readLastProfilePath(): string {
  try {
    const saved = localStorage.getItem(LAST_PROFILE_PATH_KEY)
    if (saved && saved.startsWith('/profile/')) return saved
  } catch {
    // Приватный режим или отключённое хранилище — не повод падать.
  }
  return DEFAULT_PROFILE_PATH
}

/**
 * Глобальный store приложения.
 *
 * Содержит:
 *   - isUserBusy — счётчик занятости пользователя (для PWA-обновления);
 *   - currentTheme — текущий сезон (1–4), влияет на CSS через data-theme.
 */
export const useAppStore = defineStore('app', () => {
  // ─── busy (PWA) ───

  /**
   * Счётчик занятости. Счётчик, а не bool, чтобы вложенные
   * компоненты (например, форма внутри модалки) не сбивали друг друга.
   */
  const busyCount = ref(0)

  /** Пользователь занят (заполняет форму, что-то вводит). */
  const isUserBusy = computed(() => busyCount.value > 0)

  /** Пометить занятость (true) или освободить (false). */
  function setBusy(busy: boolean) {
    if (busy) busyCount.value++
    else busyCount.value = Math.max(0, busyCount.value - 1)
  }

  /** Сбросить счётчик (аварийно). */
  function resetBusy() {
    busyCount.value = 0
  }

  // ─── theme ───

  /**
   * Текущий сезон. Инициализируется значением по умолчанию (зима),
   * реальное значение ставит useTheme при старте приложения.
   *
   * В store всегда лежит валидный Season — за этим следит setTheme.
   * Прямая запись через DevTools может положить туда что угодно,
   * но useTheme имеет watcher, который откатит невалидное значение.
   */
  const currentTheme = ref<Season>(1)

  /**
   * Установить тему. Валидирует значение — если пришло что-то
   * невалидное (например, из DevTools), бросает ошибку.
   *
   * Бросает, а не молча игнорирует: вызывающий код должен знать,
   * что тема не установилась. useTheme и detectSeasonByDate всегда
   * передают валидное значение, так что для них это не сработает.
   */
  function setTheme(theme: Season) {
    if (!isValidSeason(theme)) {
      throw new Error(`Невалидный сезон: ${String(theme)}`)
    }
    currentTheme.value = theme
  }

  // ─── личный кабинет ───

  /**
   * Последний открытый раздел ЛК.
   *
   * Клик по аватарке в шапке должен вести туда, откуда пользователь
   * ушёл, а не всегда в «Профиль». Значение переживает перезагрузку:
   * иначе после F5 память о разделе терялась бы и ссылка снова вела
   * в первый раздел.
   */
  const lastProfilePath = ref(readLastProfilePath())

  /** Запомнить раздел ЛК. Вызывается при переходах внутри кабинета. */
  function setLastProfilePath(path: string) {
    if (!path.startsWith('/profile/')) return
    if (path === lastProfilePath.value) return

    lastProfilePath.value = path
    try {
      localStorage.setItem(LAST_PROFILE_PATH_KEY, path)
    } catch {
      // Хранилище недоступно — в этой сессии ссылка всё равно работает,
      // просто не переживёт перезагрузку.
    }
  }

  return {
    // busy (PWA)
    busyCount,
    isUserBusy,
    setBusy,
    resetBusy,

    // theme
    currentTheme,
    setTheme,

    // личный кабинет
    lastProfilePath,
    setLastProfilePath,
  }
})