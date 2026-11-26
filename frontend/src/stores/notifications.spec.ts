import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ConversationEvent } from '@/api/events'
import { useNotificationsStore } from '@/stores/notifications'
import type { AppNotification, NotificationSectionDto } from '@/types/notifications'

const { listNotifications, readAllNotifications, subscribeConversationEvents } =
  vi.hoisted(() => ({
    listNotifications: vi.fn(),
    readAllNotifications: vi.fn(),
    subscribeConversationEvents: vi.fn(),
  }))

vi.mock('@/api/notifications', () => ({
  listNotifications,
  readAllNotifications,
  closeNotification: vi.fn(),
}))
vi.mock('@/api/events', () => ({ subscribeConversationEvents }))

function card(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: '1',
    kind: 'money_transfer',
    title: 'Денежный перевод',
    announce: 'Анна перевела тебе 1 000 ₽',
    body: 'Анна перевела тебе 1 000 ₽',
    conversationId: '1268',
    tripId: '193',
    compensationId: '55',
    unreadCount: null,
    viewerDeclined: null,
    preview: [],
    createdAt: '2026-11-24T10:00:00.000Z',
    updatedAt: '2026-11-24T10:00:00.000Z',
    ...overrides,
  }
}

function section(tripId: string, items: AppNotification[]): NotificationSectionDto {
  return {
    tripId,
    tripName: `Поход ${tripId}`,
    startsAt: null,
    items,
  }
}

function answer(sections: NotificationSectionDto[], personal: AppNotification[]) {
  return {
    sections,
    personal,
    tripCount: sections.length,
    personalCount: personal.length,
    total:
      sections.reduce((sum, item) => sum + item.items.length, 0) + personal.length,
  }
}

function frame(kind: ConversationEvent['kind']): ConversationEvent {
  return {
    conversationId: kind === 'notifications' ? '' : '1268',
    kind,
    actorId: '',
    at: '2026-11-24T10:00:00.000Z',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  listNotifications.mockResolvedValue(
    answer(
      [section('193', [card()]), section('810', [card({ id: '3', kind: 'trip_chat' })])],
      [card({ id: '2', kind: 'direct_chat', title: 'Борис', tripId: null })],
    ),
  )
  readAllNotifications.mockResolvedValue({ closed: 1, left: 1 })
  subscribeConversationEvents.mockReturnValue(() => undefined)
})

describe('стор уведомлений', () => {
  it('загружает секции и личные, считает счётчики по спискам', async () => {
    const store = useNotificationsStore()
    await store.refresh()

    expect(store.sections).toHaveLength(2)
    expect(store.personal).toHaveLength(1)
    expect(store.tripCount).toBe(2)
    // Счётчик треугольника — карточки, а не секции.
    expect(store.tripCards).toBe(2)
    expect(store.personalCount).toBe(1)
    expect(store.total).toBe(3)
    expect(store.isLoading).toBe(false)
    expect(store.error).toBeNull()
  })

  /**
   * Порядок секций и карточек — серверный (§1.1). Клиент его не трогает:
   * прежняя клиентская шкала приоритетов удалена, иначе два порядка
   * на одном экране разошлись бы при первой правке серверных приоритетов.
   */
  it('не пересортировывает секции и карточки', async () => {
    const store = useNotificationsStore()
    await store.refresh()

    expect(store.sections.map((item) => item.tripId)).toEqual(['193', '810'])
    expect(store.sections[0]?.items.map((item) => item.id)).toEqual(['1'])
  })

  it('«прочитать все» закрывает секцию похода и перечитывает панель', async () => {
    listNotifications
      .mockResolvedValueOnce(
        answer(
          [section('193', [card(), card({ id: '4', kind: 'almanac_changed' })])],
          [],
        ),
      )
      .mockResolvedValueOnce(answer([section('193', [card()])], []))

    const store = useNotificationsStore()
    await store.refresh()
    expect(store.tripCards).toBe(2)

    await store.readAll('193')

    expect(readAllNotifications).toHaveBeenCalledWith('193')
    // В секции остался только перевод — галочке больше нечего закрывать.
    expect(store.tripCards).toBe(1)
  })

  it('ошибку загрузки показывает текстом, а не пустым списком', async () => {
    listNotifications.mockRejectedValue(new Error('сеть'))

    const store = useNotificationsStore()
    await store.refresh()

    expect(store.error).toBe('Не удалось загрузить уведомления')
    expect(store.isLoading).toBe(false)
  })

  /**
   * Кадр `notifications` — сигнал, а не данные: DTO зависит от смотрящего
   * (`unreadCount`, `preview`), поэтому панель перечитывает ответ целиком.
   */
  it('кадр notifications перечитывает секции', async () => {
    const store = useNotificationsStore()
    await store.applyEvent(frame('notifications'))

    expect(listNotifications).toHaveBeenCalledTimes(1)
    expect(store.total).toBe(3)
  })

  it('кадры сообщений и прочтения панель не трогают', async () => {
    const store = useNotificationsStore()

    await store.applyEvent(frame('message'))
    await store.applyEvent(frame('read'))
    await store.applyEvent(frame('message_updated'))

    expect(listNotifications).not.toHaveBeenCalled()
  })

  /**
   * Соединение одно на приложение: панель и переписка делят поток, а не
   * заводят по своему (шесть соединений HTTP/1.1 — потолок браузера).
   */
  it('на двух подписчиках держит одну подписку на поток', () => {
    const store = useNotificationsStore()

    const releaseRail = store.hold()
    const releaseMobile = store.hold()

    expect(subscribeConversationEvents).toHaveBeenCalledTimes(1)

    releaseRail()
    expect(subscribeConversationEvents).toHaveBeenCalledTimes(1)

    releaseMobile()
    // Последний ушёл — подписка снята.
    expect(subscribeConversationEvents).toHaveBeenCalledTimes(1)
  })

  it('первый подписчик сразу перечитывает список', () => {
    const store = useNotificationsStore()

    const release = store.hold()

    expect(listNotifications).toHaveBeenCalledTimes(1)
    release()
  })
})
