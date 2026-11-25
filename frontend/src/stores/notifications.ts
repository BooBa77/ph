import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { subscribeConversationEvents } from '@/api/events'
import type { ConversationEvent } from '@/api/events'
import { ApiError } from '@/api/errors'
import { listNotifications } from '@/api/notifications'
import type { AppNotification } from '@/types/notifications'
import {
  sortPersonalNotifications,
  sortSystemNotifications,
} from '@/utils/notifications'

/** Как часто перечитывать уведомления, пока панель открыта. */
const REFRESH_MS = 60_000

/**
 * Уведомления правой панели — один стор на приложение (24.11.2026).
 *
 * **Почему стор, а не запрос в компоненте.** Панель показывают двое:
 * колонка от `xl` (`RightRail.vue`) и мобильная панель
 * (`MobileMessages.vue`), и оба компонента всегда в разметке — прячет их
 * CSS по ширине. Два запроса в минуту там, где нужен один, и два счётчика,
 * которые могут разойтись. Со стором обе поверхности видят один список
 * по построению.
 *
 * **Почему здесь нет `rows`/`visible`/`muted`.** Панель больше не лента
 * диалогов (§14.1): пустых строк чатов нет, заглушение осталось настройкой
 * диалога и на панель не влияет. Два списка приходят готовыми, а порядок
 * задаёт клиент: «Уведомления» — по шкале приоритета (`utils/notifications`),
 * «Сообщения» — непрочитанные, затем свежие. Сортировка живёт в сторе,
 * а не в каждой секции: список показывают и колонка, и мобильная панель.
 *
 * **Живость — тот же поток, что у переписки.** Отдельного соединения нет:
 * в `GET /api/conversations/events` приходит вид `notifications`, и по нему
 * перечитывается весь ответ. Соединение общее с `stores/conversations.ts`
 * на уровне `api/events.ts`: два стора — одна подписка, а не две.
 */
export const useNotificationsStore = defineStore('notifications', () => {
  const system = ref<AppNotification[]>([])
  const personal = ref<AppNotification[]>([])
  const isLoading = ref(true)
  const error = ref<string | null>(null)

  /** Счётчик секции: активные карточки, а не непрочитанные сообщения. */
  const systemCount = computed(() => system.value.length)
  const personalCount = computed(() => personal.value.length)

  /** Всего активных: по нему решается, нужна ли мобильная иконка. */
  const total = computed(() => system.value.length + personal.value.length)

  async function refresh(): Promise<void> {
    try {
      const data = await listNotifications()

      system.value = sortSystemNotifications(data.system)
      personal.value = sortPersonalNotifications(data.personal)
      error.value = null
    } catch (problem) {
      error.value =
        problem instanceof ApiError ? problem.message : 'Не удалось загрузить уведомления'
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Кадр `notifications` — перечитать обе секции целиком.
   *
   * DTO в кадре нет намеренно (он зависит от смотрящего: `unreadCount`
   * и `preview`), а секции маленькие — один `GET /notifications` дешевле
   * любых локальных правок. Своё действие здесь тоже применяется: `actorId`
   * пуст, потому что карточку изменила система, а не человек; закрывший её
   * должен увидеть исчезновение сразу.
   */
  async function applyEvent(event: ConversationEvent): Promise<void> {
    if (event.kind !== 'notifications') return

    await refresh()
  }

  /**
   * Держать панель живой, пока она кому-то видна.
   *
   * Счётчик подписчиков, а не флаг: подписчиков двое (колонка и мобильная
   * панель), и уход одного не должен гасить обновления другого. Таймер,
   * фокус и поток заводятся на первом и снимаются на последнем — так же,
   * как у стора переписки.
   */
  let holders = 0
  let timer: ReturnType<typeof setInterval> | null = null
  let stopEvents: (() => void) | null = null

  function onFocus(): void {
    void refresh()
  }

  function hold(): () => void {
    holders += 1

    if (holders === 1) {
      void refresh()
      window.addEventListener('focus', onFocus)
      timer = setInterval(() => {
        // Скрытая вкладка не тратит запросы: счётчик прочтётся по фокусу.
        if (document.visibilityState === 'visible') void refresh()
      }, REFRESH_MS)

      stopEvents = subscribeConversationEvents((event) => {
        void applyEvent(event)
      })
    }

    let released = false

    return () => {
      // Один подписчик — один возврат: двойной вызов не должен глушить
      // обновления второму.
      if (released) return
      released = true
      holders -= 1

      if (holders > 0) return

      window.removeEventListener('focus', onFocus)
      if (timer !== null) clearInterval(timer)
      timer = null

      if (stopEvents !== null) {
        stopEvents()
        stopEvents = null
      }
    }
  }

  return {
    system,
    personal,
    isLoading,
    error,
    systemCount,
    personalCount,
    total,
    refresh,
    applyEvent,
    hold,
  }
})
