// frontend/src/composables/useTheme.ts

import { watch } from 'vue'

import { useAppStore } from '@/stores/app'
import { isValidSeason, type Season } from '@/types/theme'

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
 *
 * Логика продублирована инлайн-скриптом в index.html (защита от FOUC:
 * тему надо поставить до первой отрисовки, а на голом JS из TS не
 * импортируешь). Меняешь границы — правь в двух местах.
 */
export function detectSeasonByDate(): Season {
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
 * Поставить сезонную тему на `<html>`.
 *
 * Единственная точка записи атрибута: и старт приложения (`main.ts`),
 * и реакция на смену сезона идут через неё. Так не бывает двух
 * источников правды об одном атрибуте.
 *
 * Функция идемпотентная — повторный вызов ставит тот же сезон.
 */
export function applySeasonTheme(): void {
  if (typeof document === 'undefined') return

  document.documentElement.setAttribute(
    'data-theme',
    String(detectSeasonByDate()),
  )
}

/**
 * Следить за тем, чтобы тема оставалась на месте.
 *
 * Зачем: была жалоба «после выхода из аккаунта наступает зима». Зима —
 * это не какая-то ветка логики, а палитра из `:root` в themes.css,
 * которая применяется, когда атрибута `data-theme` на `<html>` нет
 * вовсе. Значит его что-то снимает, и я не смог это воспроизвести.
 *
 * Наблюдение решает задачу с двух сторон: возвращает атрибут, если он
 * пропал, и пишет в консоль, что именно это сделало, — по этим записям
 * причину будет видно, а не придётся угадывать. Заодно это страховка
 * на будущее: снежинки летом посыпались бы ровно по той же причине.
 *
 * Вызывается один раз из App.vue.
 */
export function watchSeasonTheme(): void {
  if (typeof document === 'undefined') return

  let lastValue = document.documentElement.getAttribute('data-theme')

  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.attributeName !== 'data-theme') continue

      const current = document.documentElement.getAttribute('data-theme')

      // Ничего не изменилось — например, повторная установка того же.
      if (current === lastValue) continue

      const outsideApply = current === null || !isValidSeason(Number(current))
      lastValue = current

      if (outsideApply) {
        // Здесь важно понять, откуда ноги растут. В консоли будет видно,
        // в какой момент и с каким стеком атрибут пропал.
        console.warn(
          '[тема] data-theme изменён извне:',
          current,
          new Error('источник изменения').stack,
        )
        applySeasonTheme()
        lastValue = document.documentElement.getAttribute('data-theme')
      }
    }
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
}

/**
 * Composable темы. Ставит сезон по календарю и следит за его применением.
 *
 * Тема — ТОЛЬКО автоматическая. Выбора сезона вручную нет намеренно:
 * сезон в проекте привязан к календарю Прибайкалья, и «переключить на
 * лето в декабре» — это не настройка, а поломка замысла. Если однажды
 * появится дробление по месяцам, менять надо здесь и в themes.css.
 *
 * Вызывать ОДИН раз — в App.vue, до первого рендера. Сам атрибут ставит
 * `applySeasonTheme`, а не этот код: так запись в атрибут одна на всё
 * приложение, и наблюдение за ним не путается с собственными записями.
 */
export function useTheme() {
  const appStore = useAppStore()

  // ─── инициализация ───
  appStore.setTheme(detectSeasonByDate())

  // ─── реакция на смену сезона ───
  watch(
    () => appStore.currentTheme,
    (next) => {
      // Защита от мусора, вписанного через DevTools напрямую в state.
      if (!isValidSeason(next)) {
        // Откатываем к сезону по дате. Это вызовет watcher повторно,
        // но уже с валидным значением — второй раз ветка не сработает.
        appStore.setTheme(detectSeasonByDate())
        return
      }

      document.documentElement.setAttribute('data-theme', String(next))
    },
  )

  watchSeasonTheme()
}
