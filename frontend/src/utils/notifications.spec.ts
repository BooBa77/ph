import { beforeEach, describe, expect, it } from 'vitest'

import type { AppNotification } from '@/types/notifications'
import {
  NOTIFICATION_PREVIEW_CHARS,
  PERSONAL_SECTION_KEY,
  PERSONAL_SECTION_TITLE,
  canReadAllSection,
  chatTabOf,
  notificationPreview,
  openAlmanacSection,
  previewLine,
  readSectionOpen,
  shoppingRoute,
  tripSectionKey,
  tripSectionTitle,
  tripTabLabel,
  tripTabOf,
  writeSectionOpen,
} from '@/utils/notifications'

/**
 * Правила панели уведомлений без монтирования (25.11.2026; секции
 * по походам — 26.11.2026).
 *
 * Здесь то, что обязано работать без браузера: анонс 75 символов из
 * отдельного поля, заголовок «поход {цель}», независимая свёрнутость
 * по походам и переходы по вкладкам. Порядок секций и карточек — правило
 * сервера, клиент его не держит вовсе.
 */

function card(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: '1',
    kind: 'almanac_changed',
    title: 'Альманах «Пик Черского»',
    announce: 'В походе «Пик Черского» новая редакция альманаха',
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
  it('у похода — «поход {цель}», а имя без цели не получает второй префикс', () => {
    expect(tripSectionTitle('Пик Черского')).toBe('поход Пик Черского')
    expect(tripSectionTitle('поход #5')).toBe('поход #5')
    expect(PERSONAL_SECTION_TITLE).toBe('Сообщения')
  })
})

describe('анонс под заголовком', () => {
  it('режет по символам до 75 и добавляет «...» только при обрезке', () => {
    expect(NOTIFICATION_PREVIEW_CHARS).toBe(75)
    expect(previewLine('  короткий   текст  ')).toBe('короткий текст')
    expect(previewLine('а'.repeat(75))).toHaveLength(75)
    expect(previewLine('а'.repeat(75))).not.toContain('...')
    // 76-й символ не влезает: 75 символов плюс многоточие.
    expect(previewLine('а'.repeat(76))).toBe(`${'а'.repeat(75)}...`)
  })

  /**
   * 26.11.2026: анонс — отдельное поле `announce`, а не обрезанный `body`.
   * У чата сервер уже положил туда «автор: текст последнего сообщения».
   */
  it('берёт announce, а не body; пустой announce откатывается на body', () => {
    const almanac = card({
      announce: 'Короткий анонс',
      body: 'Очень длинное содержимое раскрытой карточки, которое не должно стать подписью',
    })
    expect(notificationPreview(almanac)).toBe('Короткий анонс')

    const chat = card({
      kind: 'trip_chat',
      announce: 'Анна: собираемся в шесть',
      body: 'собираемся в шесть',
    })
    expect(notificationPreview(chat)).toBe('Анна: собираемся в шесть')

    const legacy = card({ announce: '', body: 'Только тело' })
    expect(notificationPreview(legacy)).toBe('Только тело')
  })
})

describe('двойная галочка', () => {
  it('есть что закрывать, только если в секции не одни деньги к действию', () => {
    expect(canReadAllSection([card()])).toBe(true)
    expect(canReadAllSection([card({ kind: 'trip_chat' })])).toBe(true)
    expect(canReadAllSection([card({ kind: 'money_transfer' })])).toBe(false)
    expect(
      canReadAllSection([card({ kind: 'payment_request' }), card({ kind: 'money_transfer' })]),
    ).toBe(false)
    expect(canReadAllSection([])).toBe(false)
  })
})

describe('свёрнутость секций', () => {
  it('по умолчанию развёрнуты', () => {
    expect(readSectionOpen(tripSectionKey('810'))).toBe(true)
    expect(readSectionOpen(PERSONAL_SECTION_KEY)).toBe(true)
  })

  it('у каждого похода свой ключ, у «Сообщений» — прежний', () => {
    writeSectionOpen(tripSectionKey('810'), false)

    expect(readSectionOpen(tripSectionKey('810'))).toBe(false)
    expect(readSectionOpen(tripSectionKey('193'))).toBe(true)
    expect(readSectionOpen(PERSONAL_SECTION_KEY)).toBe(true)
    expect(window.localStorage.getItem('ph.notifications.trip.810.open')).toBe('0')

    writeSectionOpen(PERSONAL_SECTION_KEY, false)
    expect(window.localStorage.getItem('ph.notifications.section.personal.open')).toBe('0')
  })

  it('старый ключ system больше не читается', () => {
    window.localStorage.setItem('ph.notifications.section.system.open', '0')

    expect(readSectionOpen(tripSectionKey('810'))).toBe(true)
    expect(readSectionOpen(PERSONAL_SECTION_KEY)).toBe(true)
  })
})

describe('переходы по вкладкам', () => {
  it('вид уведомления ведёт на свою вкладку похода', () => {
    expect(tripTabOf('transfer_seat')).toBe('transfer')
    expect(tripTabOf('transfer_lost')).toBe('transfer')
    expect(tripTabOf('tent_lost')).toBe('route')
    expect(tripTabOf('meals_layout')).toBe('meals')
    expect(tripTabOf('participant_joined')).toBe('members')
    expect(tripTabOf('role_assigned')).toBe('members')
    expect(tripTabOf('trip_expense')).toBe('finance')
    expect(tripTabOf('trip_deposit')).toBe('finance')
    expect(tripTabOf('almanac_changed')).toBe('guest')
    // У чатов вкладку задаёт вид диалога, а не вид уведомления.
    expect(tripTabOf('trip_chat')).toBeNull()
    expect(tripTabOf('direct_chat')).toBeNull()
  })

  it('«Текущий список общих продуктов» — «Питание» с модалкой закупки', () => {
    expect(shoppingRoute('810')).toEqual({
      path: '/trips/810',
      query: { tab: 'meals', modal: 'shopping' },
    })
  })

  /**
   * 26.11.2026: заказчик называет кнопку вкладкой, а не «Перейти» (§8).
   * Подпись — одна таблица на карточку и тесты.
   */
  it('подпись кнопки — название вкладки, а не «Перейти»', () => {
    expect(tripTabLabel('transfer')).toBe('Трансфер')
    expect(tripTabLabel('route')).toBe('Ночёвки')
    expect(tripTabLabel('meals')).toBe('Питание')
    expect(tripTabLabel('members')).toBe('Участники')
    expect(tripTabLabel('finance')).toBe('Бухгалтерия')
    expect(tripTabLabel('guest')).toBe('Перейти')
    expect(tripTabLabel('unknown')).toBe('Перейти')
  })

  it('чат похода ведёт на вкладку по виду диалога', () => {
    expect(chatTabOf('trip_first_aid')).toBe('firstAid')
    expect(chatTabOf('trip_meals')).toBe('meals')
    expect(chatTabOf('trip_finance')).toBe('finance')
    expect(chatTabOf('unknown')).toBeNull()
  })

  it('«Перейти» из альманаха раскрывает секцию, не затирая чат', () => {
    window.localStorage.setItem(
      'ph.tripGuestView.open.810',
      JSON.stringify({ chat: false }),
    )

    openAlmanacSection('810')

    expect(window.localStorage.getItem('ph.tripGuestView.open.810')).toBe(
      JSON.stringify({ chat: false, almanac: true }),
    )
  })
})
