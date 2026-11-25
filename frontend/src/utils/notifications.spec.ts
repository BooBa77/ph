import { beforeEach, describe, expect, it } from 'vitest'

import type { AppNotification } from '@/types/notifications'
import {
  NOTIFICATION_PREVIEW_CHARS,
  PERSONAL_SECTION_TITLE,
  SYSTEM_SECTION_TITLE,
  notificationPreview,
  notificationPriority,
  previewLine,
  readSectionOpen,
  sortPersonalNotifications,
  sortSystemNotifications,
  writeSectionOpen,
} from '@/utils/notifications'

/**
 * Правила панели уведомлений без монтирования (25.11.2026).
 *
 * Живой тест выявил три вещи, которые обязан держать этот слой: превью
 * не длиннее 75 символов, порядок денег выше альманаха, альманаха выше
 * чата, а «Сообщения» не смешиваются с «Уведомлениями» и ставят
 * непрочитанные вперёд. Секции сворачиваются независимо и помнят это.
 */

function card(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: '1',
    kind: 'almanac',
    section: 'system',
    title: 'Альманах «Пик Черского»',
    body: 'В походе «Пик Черского» новая редакция альманаха',
    conversationId: null,
    tripId: '810',
    compensationId: null,
    unreadCount: null,
    viewerDeclined: null,
    preview: [],
    createdAt: '2026-11-25T10:00:00.000Z',
    updatedAt: '2026-11-25T10:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('заголовки секций', () => {
  it('называются «Уведомления» и «Сообщения», а не «Системные/Личные»', () => {
    expect(SYSTEM_SECTION_TITLE).toBe('Уведомления')
    expect(PERSONAL_SECTION_TITLE).toBe('Сообщения')
  })
})

describe('шкала приоритета', () => {
  it('деньги и действие — 10, альманах и незнакомые — 5, чат похода — 1', () => {
    expect(notificationPriority('money_transfer')).toBe(10)
    expect(notificationPriority('trip_finance')).toBe(10)
    expect(notificationPriority('payment_request')).toBe(10)
    expect(notificationPriority('almanac')).toBe(5)
    expect(notificationPriority('trip_chat')).toBe(1)
    // Новый вид по умолчанию «средний», а не проваливается в конец.
    expect(notificationPriority('future_kind' as never)).toBe(5)
  })

  it('сортирует деньги → альманах → чат, внутри приоритета — свежие сверху', () => {
    const list = [
      card({ id: 'chat', kind: 'trip_chat', updatedAt: '2026-11-25T12:00:00.000Z' }),
      card({ id: 'old-almanac', updatedAt: '2026-11-25T09:00:00.000Z' }),
      card({ id: 'money', kind: 'money_transfer', updatedAt: '2026-11-25T08:00:00.000Z' }),
      card({ id: 'new-almanac', updatedAt: '2026-11-25T11:00:00.000Z' }),
      card({ id: 'finance', kind: 'trip_finance', updatedAt: '2026-11-25T10:00:00.000Z' }),
    ]

    expect(sortSystemNotifications(list).map((item) => item.id)).toEqual([
      'finance',
      'money',
      'new-almanac',
      'old-almanac',
      'chat',
    ])
  })

  it('не меняет исходный массив', () => {
    const list = [card({ id: 'a' }), card({ id: 'b', kind: 'trip_chat' })]
    const sorted = sortSystemNotifications(list)

    expect(sorted).not.toBe(list)
    expect(list.map((item) => item.id)).toEqual(['a', 'b'])
  })
})

describe('секция «Сообщения»', () => {
  it('сначала непрочитанные, затем по времени', () => {
    const list = [
      card({
        id: 'read-new',
        kind: 'direct_chat',
        section: 'personal',
        unreadCount: 0,
        updatedAt: '2026-11-25T12:00:00.000Z',
      }),
      card({
        id: 'unread-old',
        kind: 'direct_chat',
        section: 'personal',
        unreadCount: 3,
        updatedAt: '2026-11-25T08:00:00.000Z',
      }),
      card({
        id: 'unread-new',
        kind: 'direct_chat',
        section: 'personal',
        unreadCount: 1,
        updatedAt: '2026-11-25T10:00:00.000Z',
      }),
    ]

    expect(sortPersonalNotifications(list).map((item) => item.id)).toEqual([
      'unread-new',
      'unread-old',
      'read-new',
    ])
  })
})

describe('превью под заголовком', () => {
  it('режет по символам до 75 и добавляет «...» только при обрезке', () => {
    // 50 символов обрывали денежные тексты на середине фразы (замечание
    // заказчика 25.11.2026: «увеличим длину анонса до 75 символов»).
    expect(NOTIFICATION_PREVIEW_CHARS).toBe(75)
    expect(previewLine('  короткий   текст  ')).toBe('короткий текст')
    expect(previewLine('а'.repeat(75))).toHaveLength(75)
    expect(previewLine('а'.repeat(75))).not.toContain('...')
    // 76-й символ не влезает: 75 символов плюс многоточие.
    expect(previewLine('а'.repeat(76))).toBe(`${'а'.repeat(75)}...`)
  })

  it('у чата берёт последнее сообщение, у нечата — тело карточки', () => {
    const chat = card({
      kind: 'direct_chat',
      section: 'personal',
      body: 'старое',
      preview: [
        { id: '1', body: 'первое', senderId: 'x', senderName: 'Анна', createdAt: '2026-11-25T09:00:00.000Z' },
        { id: '2', body: 'последнее', senderId: 'x', senderName: 'Анна', createdAt: '2026-11-25T10:00:00.000Z' },
      ],
    })

    expect(notificationPreview(chat)).toBe('последнее')
    expect(notificationPreview(card())).toBe(
      'В походе «Пик Черского» новая редакция альманаха',
    )
  })
})

describe('свёрнутость секций', () => {
  it('по умолчанию обе развёрнуты', () => {
    expect(readSectionOpen('system')).toBe(true)
    expect(readSectionOpen('personal')).toBe(true)
  })

  it('состояние каждой секции своё и переживает перезагрузку', () => {
    writeSectionOpen('system', false)

    expect(readSectionOpen('system')).toBe(false)
    // Свернули «Уведомления» — «Сообщения» остались открытыми.
    expect(readSectionOpen('personal')).toBe(true)
    expect(window.localStorage.getItem('ph.notifications.section.system.open')).toBe('0')

    writeSectionOpen('system', true)
    expect(readSectionOpen('system')).toBe(true)
  })
})
