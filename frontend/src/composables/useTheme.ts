// frontend/src/composables/useTheme.ts

import { watch } from 'vue'

import { useAppStore } from '@/stores/app'
import { isValidSeason, type Season } from '@/types/theme'

/**
 * Ключ в localStorage для выбранного пользователем сезона.
 *
 * Если ключа нет — сезон определяется по дате (см. detectSeasonByDate).
 * Пользователь выбирает сезон в меню в шапке; «Вернуть по дате» удаляет
 * ключ и возвращает автоматический режим.
 */
const OVERRIDE_KEY = 'themeOverride'

/**
 * Определить сезон по текущей дате.
 *
 * Границы (Прибайкалье):
 *   зима:   8 ноября — 7 марта
 *   весна:  8 марта — 24 мая
 *   лето:   25 мая — 31 августа
 *   осень:  1 сентября — 7 ноября
 *
 * Используем месяц (0–11) и день месяца. Високосность неважна:
 * границы заданы календарными датами, а не номером дня года.
 *
 * Месяцы в JS: 0=янв, 1=фев, ..., 11=дек.
 */
function detectSeasonByDate(): Season {
  const now = new Date()
  const month = now.getMonth() // 0–11
  const day = now.getDate() // 1–31

  // Зима: 8 ноября (месяц 10, день >= 8) — 7 марта (месяц 2, день <= 7).
  // Пересекает Новый год — поэтому несколько условий через ИЛИ.
  const isWinter =
    (month === 10 && day >= 8) || // ноябрь, с 8-го
    month === 11 || // декабрь
    month === 0 || // январь
    month === 1 || // февраль
    (month === 2 && day <= 7) // март, до 7-го

  if (isWinter) return 1

  // Весна: 8 марта (месяц 2, день >= 8) — 24 мая (месяц 4, день <= 24).
  const isSpring =
    (month === 2 && day >= 8) || // март, с 8-го
    month === 3 || // апрель
    (month === 4 && day <= 24) // май, до 24-го

  if (isSpring) return 2

  // Лето: 25 мая (месяц 4, день >= 25) — 31 августа (месяц 7, весь).
  const isSummer =
    (month === 4 && day >= 25) || // май, с 25-го
    month === 5 || // июнь
    month === 6 || // июль
    month === 7 // август

  if (isSummer) return 3

  // Осень: 1 сентября (месяц 8) — 7 ноября (месяц 10, день <= 7).
  // Сюда попадает всё, что не зима/весна/лето — по построению это осень.
  return 4
}

/**
 * Прочитать override из localStorage.
 * Возвращает Season или null, если override нет/невалиден.
 *
 * Побочный эффект: если в localStorage лежит мусор — удаляет ключ.
 * Это правильно: мусор не должен копиться и вводить в заблуждение.
 */
function readOverride(): Season | null {
  const raw = localStorage.getItem(OVERRIDE_KEY)
  if (raw === null) return null

  const num = Number(raw)
  if (isValidSeason(num)) {
    return num
  }

  // Мусор — чистим.
  localStorage.removeItem(OVERRIDE_KEY)
  return null
}

/**
 * Тема уже инициализирована в этой сессии страницы.
 *
 * `useTheme` вызывается в двух местах: один раз в App.vue (инициализация
 * и watcher) и из переключателя сезона в меню, которому нужны только
 * функции управления. Второй вызов не должен навешивать второй watcher
 * и заново читать localStorage.
 */
let initialized = false

/**
 * Composable темы. Инициализирует текущую тему и следит за ней.
 *
 * Вызывать ОДИН РАЗ — в App.vue, до первого рендера: этот вызов делает
 * всю работу. Повторные вызовы (например, из переключателя сезона)
 * ничего не навешивают и просто возвращают функции управления.
 *
 * Что делает первый вызов:
 *   1. Определяет начальную тему (override или по дате).
 *   2. Ставит data-theme на <html> — CSS пересчитывается.
 *   3. Watcher: при изменении currentTheme обновляет data-theme.
 *      Если значение невалидное (вписали через DevTools) — откатывает
 *      к теме по дате.
 *
 * Возвращает функции выбора сезона — ими пользуется переключатель в меню
 * шапки. Выбор уходит в data-theme (через store) и в localStorage, чтобы
 * не слетел при перезагрузке.
 */
export function useTheme() {
  const appStore = useAppStore()

  if (!initialized) {
    initialized = true

    // ─── инициализация ───
    const initial = readOverride() ?? detectSeasonByDate()
    appStore.setTheme(initial)

    // ─── watcher ───
    watch(
      () => appStore.currentTheme,
      (next) => {
        // Защита от мусора, вписанного через DevTools напрямую в state.
        if (!isValidSeason(next)) {
          // Откатываем к теме по дате. Это вызовет watcher повторно,
          // но уже с валидным значением — второй раз ветка не сработает.
          appStore.setTheme(detectSeasonByDate())
          return
        }

        // Всё валидно — применяем к <html>.
        document.documentElement.setAttribute('data-theme', String(next))
      },
      { immediate: true },
    )
  }

  /**
   * Выбрать сезон вручную.
   *
   * Сначала пишем в localStorage, потом в store: если запись в хранилище
   * не удалась (приватный режим, переполнение), состояние приложения
   * всё равно останется согласованным.
   *
   * Обратной операции («вернуть сезон по дате») нет намеренно: в сессию
   * входа она не нужна, а лишний путь в UI — лишний вопрос «а что будет,
   * если». Понадобится — это снятие ключа из localStorage плюс
   * detectSeasonByDate.
   */
  function setThemeOverride(season: Season) {
    localStorage.setItem(OVERRIDE_KEY, String(season))
    appStore.setTheme(season)
  }

  return { setThemeOverride }
}