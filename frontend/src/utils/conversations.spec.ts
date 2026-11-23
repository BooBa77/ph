import { describe, expect, it } from 'vitest'

import type { Conversation } from '@/types/conversations'
import {
  amountOf,
  byImportance,
  conversationHeading,
  conversationSubtitle,
  conversationTime,
  hasPendingAction,
  mutedConversations,
  unreadTotalOf,
  visibleConversations,
} from '@/utils/conversations'

/**
 * Правила ленты: порядок строк и подписи.
 *
 * Проверяются отдельно от компонентов, потому что лента теперь одна на
 * десктоп и мобилу: разойтись две копии правил уже не могут, но сломаться
 * в одном месте — могут.
 */

function message(id: string, body: string, createdAt = '2026-11-23T09:00:00.000Z') {
  return {
    id,
    senderId: 'peer',
    senderName: 'Анна',
    senderAvatarUrl: null,
    body,
    isSystem: false,
    createdAt,
    action: null,
  }
}

/** Денежная строка: ждёт ответа «получил / не получил». */
function moneyConversation(overrides: Partial<Conversation> = {}): Conversation {
  return conversation({
    id: '3',
    lastMessage: {
      ...message('30', 'Тебе перевели 1200 ₽', '2026-11-20T10:00:00.000Z'),
      action: {
        id: '77',
        kind: 'money_received',
        targetUserId: 'me',
        state: 'pending',
        payload: { amountRub: 1200 },
        canRespond: true,
        canRecheck: false,
        createdAt: '2026-11-20T10:00:00.000Z',
        respondedAt: null,
      },
    },
    ...overrides,
  })
}

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: '1',
    kind: 'direct',
    tripId: null,
    title: 'Анна',
    tripTitle: null,
    peer: { id: 'peer', displayName: 'Анна', avatarUrl: null },
    lastMessage: message('10', 'Привет'),
    unreadCount: 1,
    muted: false,
    peerLastReadAt: null,
    ...overrides,
  }
}

describe('utils/conversations', () => {
  it('ставит строку с неотвеченным переводом выше свежего сообщения', () => {
    const fresh = conversation({
      id: '2',
      lastMessage: message('20', 'Свежее сообщение', '2026-11-23T10:00:00.000Z'),
    })
    const urgent = moneyConversation()

    expect(hasPendingAction(urgent)).toBe(true)
    expect(hasPendingAction(fresh)).toBe(false)
    expect(amountOf(urgent)).toBe(1200)

    expect([fresh, urgent].sort(byImportance).map((row) => row.id)).toEqual(['3', '2'])
  })

  it('без срочных сортирует по времени последнего сообщения', () => {
    const older = conversation({ id: '1' })
    const newer = conversation({
      id: '2',
      lastMessage: message('21', 'Позже', '2026-11-23T12:00:00.000Z'),
    })

    expect([older, newer].sort(byImportance).map((row) => row.id)).toEqual(['2', '1'])
  })

  it('убирает заглушенные из ленты и не считает их в счётчике', () => {
    const rows = [
      conversation({ id: '1', unreadCount: 2 }),
      conversation({ id: '2', unreadCount: 5, muted: true }),
    ]

    expect(visibleConversations(rows).map((row) => row.id)).toEqual(['1'])
    expect(mutedConversations(rows).map((row) => row.id)).toEqual(['2'])
    expect(unreadTotalOf(rows)).toBe(2)
  })

  it('подписывает деньги суммой, личный диалог — именем, чат похода — походом', () => {
    expect(conversationHeading(moneyConversation())).toBe('Перевод 1\u00A0200 ₽')
    expect(conversationHeading(conversation())).toBe('Анна')

    const trip = conversation({
      id: '5',
      kind: 'trip_finance',
      tripId: '3',
      title: 'Чат бухгалтерии',
      tripTitle: 'Витязь',
      peer: null,
    })

    expect(conversationHeading(trip)).toBe('Чат бухгалтерии')
    expect(conversationSubtitle(trip)).toBe('Чат бухгалтерии · Витязь')
    expect(conversationSubtitle(conversation())).toBe('Привет')
  })

  it('показывает время только у сегодняшних, у старых — дату', () => {
    const today = new Date()
    today.setHours(14, 5, 0, 0)

    expect(conversationTime(today.toISOString())).toBe('14:05')
    expect(conversationTime('2026-11-12T10:00:00.000Z')).toMatch(/^\d{2}\.\d{2}$/)
    expect(conversationTime(undefined)).toBe('')
  })
})
