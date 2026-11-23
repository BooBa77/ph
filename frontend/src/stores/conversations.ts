// frontend/src/stores/conversations.ts

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { listConversations, markConversationRead } from '@/api/conversations'
import { ApiError } from '@/api/errors'
import type { Conversation } from '@/types/conversations'
import { mutedConversations, unreadTotalOf, visibleConversations } from '@/utils/conversations'

/** Как часто обновлять ленту, пока вкладка открыта. */
const REFRESH_MS = 60_000

/**
 * Лента сообщений — одна на всё приложение.
 *
 * **Почему стор, а не запрос в каждом компоненте.** Ленту показывают двое:
 * правая колонка от `xl` (`RightRail.vue`) и мобильная панель
 * (`MobileMessages.vue`, 23.11.2026). Оба компонента живут в разметке
 * всегда, а прячет их CSS по ширине экрана — значит, два запроса на каждую
 * минуту и два таймера там, где нужен один. Со стором лента запрашивается
 * один раз, а счётчик непрочитанного на мобиле и в колонке показывает одно
 * и то же число по построению, а не по совпадению.
 *
 * **Прочитал в одном месте — прочитано везде.** `markRead` меняет строку
 * в сторе, а не копию у компонента: иначе на мобиле бейдж погас бы только
 * после следующего обновления.
 *
 * **Живость без SSE.** Пока лента кому-то нужна, стор сам обновляет её по
 * фокусу окна и раз в минуту. Поток на каждого человека — отдельная сессия
 * ([`NEXT.md`](../../../../docs/ph/NEXT.md)), здесь его нет.
 */
export const useConversationsStore = defineStore('conversations', () => {
  const rows = ref<Conversation[]>([])
  const isLoading = ref(true)
  const error = ref<string | null>(null)

  /** Лента: незаглушенные, деньги сверху. */
  const visible = computed(() => visibleConversations(rows.value))

  /** Заглушенные: их возвращают вручную. */
  const muted = computed(() => mutedConversations(rows.value))

  /** Счётчик непрочитанного без заглушенных. */
  const unreadTotal = computed(() => unreadTotalOf(rows.value))

  async function refresh(): Promise<void> {
    try {
      const data = await listConversations()

      rows.value = data.conversations
      error.value = null
    } catch (problem) {
      error.value =
        problem instanceof ApiError ? problem.message : 'Не удалось загрузить сообщения'
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Отметить диалог прочитанным.
   *
   * Сначала сервер, потом счётчик: если запрос не прошёл, бейдж честно
   * остаётся. Ошибку глотаем — отметка прочтения не повод не показывать
   * переписку, и следующий `refresh` всё поправит.
   */
  async function markRead(row: Conversation): Promise<void> {
    if (row.unreadCount === 0) return

    try {
      await markConversationRead(row.id)
      row.unreadCount = 0
    } catch {
      // См. комментарий выше.
    }
  }

  /**
   * Держать ленту живой, пока она кому-то видна.
   *
   * Счётчик подписчиков, а не флаг: подписчиков двое (колонка и мобильная
   * панель), и уход одного не должен гасить обновления другого. Таймер
   * и подписка на фокус заводятся на первом подписчике и снимаются на
   * последнем. Возвращает функцию «я больше не смотрю».
   */
  let holders = 0
  let timer: ReturnType<typeof setInterval> | null = null

  function onFocus(): void {
    void refresh()
  }

  function hold(): () => void {
    holders += 1

    if (holders === 1) {
      void refresh()
      window.addEventListener('focus', onFocus)
      timer = setInterval(() => {
        // Скрытая вкладка не тратит запросы: человек всё равно не увидит,
        // что там пришло, а счётчик прочтёт при возврате — по фокусу.
        if (document.visibilityState === 'visible') void refresh()
      }, REFRESH_MS)
    }

    let released = false

    return () => {
      // Один подписчик — один возврат: двойной вызов не должен снимать
      // чужие подписки и глушить ленту.
      if (released) return
      released = true
      holders -= 1

      if (holders > 0) return

      window.removeEventListener('focus', onFocus)
      if (timer !== null) clearInterval(timer)
      timer = null
    }
  }

  return {
    rows,
    isLoading,
    error,
    visible,
    muted,
    unreadTotal,
    refresh,
    markRead,
    hold,
  }
})
