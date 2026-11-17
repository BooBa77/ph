import type { PresenceAction, TripParticipant } from '@/types/trips'

/**
 * Локальная отметка присутствия — то же, что сделает сервер (17.11.2026).
 *
 * Нужна без связи: человек нажал «Я вернулся», а сети нет — очередь отправит
 * отметку позже, но экран не должен показывать «не отметился» до появления
 * сети. Правила повторяют серверные один в один, чтобы после синхронизации
 * цифры не «прыгнули»:
 *
 * - `route` не переписывает первый выход, если он уже был;
 * - `returned` обязан иметь выход — он ставится, если его не было;
 * - `none` снимает обе отметки и авторство.
 *
 * Возвращается новый объект: в компонентах это ref-массив, и мутация
 * на месте не вызвала бы перерисовку.
 */
export function applyPresence(
  person: TripParticipant,
  action: PresenceAction,
  actorId: string,
  at: string = new Date().toISOString(),
): TripParticipant {
  if (action === 'none') {
    return {
      ...person,
      startedAt: null,
      returnedAt: null,
      presenceStatus: 'none',
      presenceUpdatedByUserId: null,
      presenceSource: null,
    }
  }

  const startedAt = person.startedAt ?? at
  const returnedAt = action === 'returned' ? at : null

  return {
    ...person,
    startedAt,
    returnedAt,
    presenceStatus: action,
    presenceUpdatedByUserId: actorId,
    presenceSource: actorId === person.userId ? 'self' : 'other',
  }
}
