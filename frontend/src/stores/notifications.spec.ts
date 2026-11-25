import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ConversationEvent } from '@/api/events'
import { useNotificationsStore } from '@/stores/notifications'
import type { AppNotification } from '@/types/notifications'

const { listNotifications, subscribeConversationEvents } = vi.hoisted(() => ({
  listNotifications: vi.fn(),
  subscribeConversationEvents: vi.fn(),
}))

vi.mock('@/api/notifications', () => ({ listNotifications, closeNotification: vi.fn() }))
vi.mock('@/api/events', () => ({ subscribeConversationEvents }))

function card(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: '1',
    kind: 'money_transfer',
    section: 'system',
    title: 'Денежный перевод',
    body: 'Анна перевела тебе 1 000 ₽',
    conversationId: '1268',
    tripId: '193',
    compensationId: '55',
    unreadCount: null,
    preview: [],
    createdAt: '2026-11-24T10:00:00.000Z',
    updatedAt: '2026-11-24T10:00:00.000Z',
    ...overrides,
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
  listNotifications.mockResolvedValue({
    system: [card()],
    personal: [card({ id: '2', kind: 'direct_chat', section: 'personal', title: 'Борис' })],
    systemCount: 1,
    personalCount: 1,
  })
  subscribeConversationEvents.mockReturnValue(() => undefined)
})

describe('стор уведомлений', () => {
  it('загружает две секции и считает счётчики по их длине', async () => {
    const store = useNotificationsStore()
    await store.refresh()

    expect(store.system).toHaveLength(1)
    expect(store.personal).toHaveLength(1)
    expect(store.systemCount).toBe(1)
    expect(store.personalCount).toBe(1)
    expect(store.total).toBe(2)
    expect(store.isLoading).toBe(false)
    expect(store.error).toBeNull()
  })

  /**
   * Порядок — правило клиента (25.11.2026): сервер отдаёт «свежие сверху»,
   * а панель ставит деньги выше альманаха, альманах выше чата; в личных
   * сначала непрочитанные. Список показывают две поверхности — сортировка
   * живёт в сторе, чтобы они не разошлись.
   */
  it('сортирует «Уведомления» по приоритету, а «Сообщения» — непрочитанные вперёд', async () => {
    listNotifications.mockResolvedValue({
      system: [
        card({ id: 'chat', kind: 'trip_chat' }),
        card({ id: 'almanac', kind: 'almanac' }),
        card({ id: 'money' }),
      ],
      personal: [
        card({
          id: 'read',
          kind: 'direct_chat',
          section: 'personal',
          unreadCount: 0,
          updatedAt: '2026-11-25T12:00:00.000Z',
        }),
        card({
          id: 'unread',
          kind: 'direct_chat',
          section: 'personal',
          unreadCount: 1,
          updatedAt: '2026-11-25T08:00:00.000Z',
        }),
      ],
      systemCount: 3,
      personalCount: 2,
    })

    const store = useNotificationsStore()
    await store.refresh()

    expect(store.system.map((item) => item.id)).toEqual(['money', 'almanac', 'chat'])
    expect(store.personal.map((item) => item.id)).toEqual(['unread', 'read'])
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
  it('кадр notifications перечитывает обе секции', async () => {
    const store = useNotificationsStore()
    await store.applyEvent(frame('notifications'))

    expect(listNotifications).toHaveBeenCalledTimes(1)
    expect(store.total).toBe(2)
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
