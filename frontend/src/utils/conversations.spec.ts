import { describe, expect, it } from 'vitest'

import type { Conversation } from '@/types/conversations'
import {
  amountOf,
  byImportance,
  conversationHeading,
  conversationSubtitle,
  conversationTime,
  firstUnreadIndex,
  hasPendingAction,
  hasRowAction,
  isPaymentRequest,
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

/** Просьба организатора о платеже: кнопка «Перейти», отвечать нечем. */
function paymentConversation(): Conversation {
  return conversation({
    id: '4',
    lastMessage: {
      ...message('40', 'Организатор запросил платёж по походу «Витязь».'),
      action: {
        id: '88',
        kind: 'payment_request',
        targetUserId: 'me',
        state: 'pending',
        payload: { tripId: '3', tripTitle: 'Витязь' },
        canRespond: false,
        canRecheck: false,
        createdAt: '2026-11-24T09:00:00.000Z',
        respondedAt: null,
      },
    },
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
    myLastReadAt: null,
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

  it('просьбу о платеже раскрывает, но задачей с ответом не считает', () => {
    const request = paymentConversation()

    // Кнопка «Перейти» — в раскрытии строки, как у перевода.
    expect(hasRowAction(request)).toBe(true)
    expect(isPaymentRequest(request)).toBe(true)

    // А в счётчик срочности и в подписи «Перевод …» она не попадает:
    // это уведомление, а не вопрос, на который ждут «да / нет».
    expect(hasPendingAction(request)).toBe(false)
    expect(amountOf(request)).toBeNull()
    expect(conversationHeading(request)).toBe('Анна')

    expect(hasRowAction(conversation())).toBe(false)
    expect(isPaymentRequest(conversation())).toBe(false)
  })

  /**
   * Приоритет действия — на сервере, но лента обязана читать именно поле
   * диалога (24.11.2026). Просьба о платеже, пришедшая после перевода,
   * лежит в `lastMessage.action`, а «Подтверждаю» — в `action`.
   */
  it('действие диалога важнее действия последнего сообщения', () => {
    const transfer = moneyConversation().lastMessage?.action
    const request = paymentConversation().lastMessage?.action

    const row = conversation({
      id: '6',
      action: transfer ?? null,
      lastMessage: {
        ...message('60', 'Организатор запросил платёж по походу «Витязь».'),
        action: request ?? null,
      },
    })

    // Строка остаётся денежной: просьба её не перекрывает.
    expect(hasPendingAction(row)).toBe(true)
    expect(isPaymentRequest(row)).toBe(false)
    expect(amountOf(row)).toBe(1200)
    expect(conversationHeading(row)).toBe('Перевод 1\u00A0200 ₽')
  })

  it('после подтверждения перевода показывается просьба о платеже', () => {
    const request = paymentConversation().lastMessage?.action

    const row = conversation({
      id: '7',
      action: request ?? null,
      lastMessage: message('70', 'Организатор запросил платёж по походу «Витязь».'),
    })

    expect(hasPendingAction(row)).toBe(false)
    expect(isPaymentRequest(row)).toBe(true)
    expect(hasRowAction(row)).toBe(true)
    expect(conversationHeading(row)).toBe('Анна')
  })

  /**
   * Чужая просьба о платеже лежит действием последнего сообщения, но
   * адресована не мне: сервер вернул `action: null`, и кнопки быть не должно.
   */
  it('не показывает чужую просьбу о платеже по lastMessage.action', () => {
    const request = paymentConversation().lastMessage?.action

    const row = conversation({
      id: '8',
      action: null,
      lastMessage: {
        ...message('80', 'Организатор запросил платёж по походу «Витязь».'),
        action: request ?? null,
      },
    })

    expect(hasRowAction(row)).toBe(false)
    expect(isPaymentRequest(row)).toBe(false)
    expect(hasPendingAction(row)).toBe(false)
  })

  /**
   * Разделитель «Новые сообщения» (25.11.2026): граница — моя метка
   * прочтения из диалога, снятая до `POST /read`.
   */
  describe('firstUnreadIndex', () => {
    const own = (id: string, createdAt: string) => ({
      ...message(id, 'моё', createdAt),
      senderId: 'me',
    })
    const system = (id: string, createdAt: string) => ({
      ...message(id, 'служебное', createdAt),
      senderId: null,
      isSystem: true,
    })

    it('ставит разделитель перед первым чужим после границы', () => {
      const list = [
        message('1', 'старое', '2026-11-23T09:00:00.000Z'),
        message('2', 'тоже старое', '2026-11-23T09:05:00.000Z'),
        message('3', 'новое', '2026-11-23T10:00:00.000Z'),
        message('4', 'ещё новее', '2026-11-23T10:05:00.000Z'),
      ]

      expect(firstUnreadIndex(list, '2026-11-23T09:30:00.000Z', 'me')).toBe(2)
    })

    it('не считает своими и системными: свои сообщения и служебные строки не новые', () => {
      const list = [
        message('1', 'старое', '2026-11-23T09:00:00.000Z'),
        own('2', '2026-11-23T10:00:00.000Z'),
        system('3', '2026-11-23T10:01:00.000Z'),
        message('4', 'новое', '2026-11-23T10:02:00.000Z'),
      ]

      expect(firstUnreadIndex(list, '2026-11-23T09:30:00.000Z', 'me')).toBe(3)
    })

    it('без границы считает новым первое чужое сообщение', () => {
      const list = [own('1', '2026-11-23T09:00:00.000Z'), message('2', 'привет')]

      expect(firstUnreadIndex(list, null, 'me')).toBe(1)
    })

    it('когда непрочитанных больше страницы — разделитель над первым показанным', () => {
      const list = [
        message('1', 'первое на странице', '2026-11-23T10:00:00.000Z'),
        message('2', 'второе', '2026-11-23T10:05:00.000Z'),
      ]

      expect(firstUnreadIndex(list, '2026-11-22T09:00:00.000Z', 'me')).toBe(0)
    })

    it('новых нет — null', () => {
      const list = [
        own('1', '2026-11-23T09:00:00.000Z'),
        message('2', 'прочитанное', '2026-11-23T09:10:00.000Z'),
      ]

      expect(firstUnreadIndex(list, '2026-11-23T09:30:00.000Z', 'me')).toBeNull()
      expect(firstUnreadIndex([], '2026-11-23T09:30:00.000Z', 'me')).toBeNull()
    })
  })
})
