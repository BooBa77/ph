import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { subscribeConversationEvents } from '@/api/events'
import type { ConversationEvent } from '@/api/events'
import { ApiError } from '@/api/errors'
import { listNotifications, readAllNotifications } from '@/api/notifications'
import type { AppNotification, NotificationSectionDto } from '@/types/notifications'

/** Как часто перечитывать уведомления, пока панель открыта. */
const REFRESH_MS = 60_000

/**
 * Уведомления правой панели — один стор на приложение (24.11.2026;
 * секции по походам — 26.11.2026).
 *
 * **Почему стор, а не запрос в компоненте.** Панель показывают двое:
 * колонка от `xl` (`RightRail.vue`) и мобильная панель
 * (`MobileMessages.vue`), и оба компонента всегда в разметке — прячет их
 * CSS по ширине. Два запроса в минуту там, где нужен один, и два счётчика,
 * которые могут разойтись. Со стором обе поверхности видят один список
 * по построению.
 *
 * **Порядок не пересортировывается.** Сервер отдаёт секции уже в нужном
 * порядке: идущие/предстоящие по возрастанию даты, прошедшие по убыванию,
 * без дат по имени; внутри секции — по приоритету и свежести (§1.1).
 * Прежняя клиентская шкала приоритетов удалена: два порядка на одном
 * экране разошлись бы при первой правке серверных приоритетов.
 *
 * **Счётчики считаются по спискам, а не берутся из ответа.** После закрытия
 * карточки список перечитывается, но счётчик — длина списка; одно правило
 * в двух местах разошлось бы. `tripCount` — число секций (для отладки
 * и заголовков), `tripCards` — сумма активных карточек по походам: именно
 * её показывает треугольник на мобиле и двойная галочка.
 *
 * **Живость — тот же поток, что у переписки.** Отдельного соединения нет:
 * в `GET /api/conversations/events` приходит вид `notifications`, и по нему
 * перечитывается весь ответ. Соединение общее с `stores/conversations.ts`
 * на уровне `api/events.ts`: два стора — одна подписка, а не две.
 */
export const useNotificationsStore = defineStore('notifications', () => {
  const sections = ref<NotificationSectionDto[]>([])
  const personal = ref<AppNotification[]>([])
  const isLoading = ref(true)
  const error = ref<string | null>(null)

  /** Сколько секций походов с карточками. */
  const tripCount = computed(() => sections.value.length)

  /** Счётчик «Сообщений»: активные карточки личных диалогов. */
  const personalCount = computed(() => personal.value.length)

  /** Сумма активных карточек по всем походам — счётчик треугольника. */
  const tripCards = computed(() =>
    sections.value.reduce((sum, section) => sum + section.items.length, 0),
  )

  /** Всего активных: по нему решается, закрывать ли пустую мобильную панель. */
  const total = computed(() => tripCards.value + personalCount.value)

  async function refresh(): Promise<void> {
    try {
      const data = await listNotifications()

      sections.value = data.sections
      personal.value = data.personal
      error.value = null
    } catch (problem) {
      error.value =
        problem instanceof ApiError ? problem.message : 'Не удалось загрузить уведомления'
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Двойная зелёная галочка секции похода (§1.3).
   *
   * Сервер закрывает всё, кроме `money_transfer` и `payment_request`,
   * и отвечает `{closed, left}`. Клиент не правит список локально:
   * после действия он перечитывает панель целиком — так же, как после
   * «ОК» у карточки, — иначе закрытые по одному месту карточки остались бы
   * в другом.
   */
  async function readAll(tripId: string): Promise<void> {
    try {
      await readAllNotifications(tripId)
      await refresh()
    } catch (problem) {
      error.value =
        problem instanceof ApiError ? problem.message : 'Не удалось закрыть уведомления'
    }
  }

  /**
   * Кадр `notifications` — перечитать секции целиком.
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
    sections,
    personal,
    isLoading,
    error,
    tripCount,
    tripCards,
    personalCount,
    total,
    refresh,
    readAll,
    applyEvent,
    hold,
  }
})
