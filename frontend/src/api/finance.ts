import { apiFetch } from '@/api/client'
import type {
  CreateTripCompensationInput,
  DepositDecision,
  SaveTripExpenseInput,
  TripFinance,
} from '@/types/finance'

/**
 * «Бухгалтерия» похода: чтение, расходы, компенсации (12.11.2026).
 *
 * **Все изменения возвращают вкладку целиком** — так решил бэкенд, и здесь
 * то же самое: баланс, доли и подсказки считаются из всех записей сразу,
 * поэтому «вернуть одну строку» значило бы заставить экран считать
 * арифметику второй раз и разойтись с сервером.
 *
 * Ручки повторяют `backend/src/trips/trip-finance.controller.ts`. Права
 * (автор расхода, получатель компенсации) проверяет сервер: `canEdit`,
 * `canConfirm` и `canCancel` приходят в ответе, и экран рисует кнопки
 * по ним, а не по своей копии правил.
 */

/** GET /api/trips/:id/finance — расходы, компенсации, балансы и подсказки. */
export async function getTripFinance(tripId: string): Promise<TripFinance> {
  return apiFetch<TripFinance>(`/trips/${tripId}/finance`)
}

/** POST /api/trips/:id/finance/expenses — добавить расход (я — плательщик). */
export async function createTripExpense(
  tripId: string,
  data: SaveTripExpenseInput,
): Promise<TripFinance> {
  return apiFetch<TripFinance>(`/trips/${tripId}/finance/expenses`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

/** PATCH /api/trips/:id/finance/expenses/:expenseId — поправить расход. */
export async function updateTripExpense(
  tripId: string,
  expenseId: string,
  data: SaveTripExpenseInput,
): Promise<TripFinance> {
  return apiFetch<TripFinance>(`/trips/${tripId}/finance/expenses/${expenseId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

/** DELETE /api/trips/:id/finance/expenses/:expenseId — удалить расход (автор). */
export async function deleteTripExpense(
  tripId: string,
  expenseId: string,
): Promise<TripFinance> {
  return apiFetch<TripFinance>(`/trips/${tripId}/finance/expenses/${expenseId}`, {
    method: 'DELETE',
  })
}

/** POST /api/trips/:id/finance/compensations — «я перевёл тебе столько». */
export async function createTripCompensation(
  tripId: string,
  data: CreateTripCompensationInput,
): Promise<TripFinance> {
  return apiFetch<TripFinance>(`/trips/${tripId}/finance/compensations`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

/** POST …/compensations/:id/confirm — «Получено», только у получателя. */
export async function confirmTripCompensation(
  tripId: string,
  compensationId: string,
): Promise<TripFinance> {
  return apiFetch<TripFinance>(
    `/trips/${tripId}/finance/compensations/${compensationId}/confirm`,
    { method: 'POST' },
  )
}

/** DELETE …/compensations/:id — отменить ожидающую (только отправитель). */
export async function deleteTripCompensation(
  tripId: string,
  compensationId: string,
): Promise<TripFinance> {
  return apiFetch<TripFinance>(
    `/trips/${tripId}/finance/compensations/${compensationId}`,
    { method: 'DELETE' },
  )
}

/**
 * PUT /api/trips/:id/finance/deposit/:userId — решение по залогу (18.11.2026).
 *
 * Ставит организатор или соорганизатор; сумма залога живёт в походе
 * и правится в «Правке похода», а здесь решается судьба залога одного
 * человека: вернуть, удержать или снять решение. «Сдал» руками больше
 * не ставится — это подтверждение перевода получателем.
 */
export async function setTripDepositStatus(
  tripId: string,
  userId: string,
  status: DepositDecision,
): Promise<TripFinance> {
  return apiFetch<TripFinance>(`/trips/${tripId}/finance/deposit/${userId}`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  })
}

/**
 * POST /api/trips/:id/finance/deposit/transfer — «Перевести залог» (18.11.2026).
 *
 * Создаёт ожидающий перевод организатору: подтверждение — кнопкой
 * «Получено», как у компенсации. Сумма произвольная (v3): по умолчанию
 * недостача `dueRub`, но её можно изменить, в том числе в бо́льшую сторону.
 * `fromUserId` — за человека без аккаунта, которого ведёт смотрящий.
 */
export async function transferTripDeposit(
  tripId: string,
  recipientUserId: string,
  amountRub: number,
  fromUserId?: string,
): Promise<TripFinance> {
  return apiFetch<TripFinance>(`/trips/${tripId}/finance/deposit/transfer`, {
    method: 'POST',
    body: JSON.stringify(
      fromUserId === undefined
        ? { recipientUserId, amountRub }
        : { recipientUserId, amountRub, fromUserId },
    ),
  })
}
