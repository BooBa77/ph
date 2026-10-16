import type { CreateTripRequest, Trip, UpdateTripRequest } from '@/types/trips'

/**
 * Патч из формы: только то, что человек действительно изменил.
 *
 * **Почему не отправляем форму целиком.** `PATCH` различает «поля нет» и
 * «`null`»: без поля значение остаётся как было, `null` его стирает. Форма
 * знает не все поля похода — вариантов дат в ответе API нет вовсе, — и
 * отправка её целиком означала бы «стереть то, чего я не видел». Поэтому
 * сравниваем с исходным походом и шлём разницу.
 *
 * Функция чистая и поэтому проверяемая: правила тут неочевидные, а цена
 * ошибки — молча затёртые данные.
 */
export function buildTripPatch(initial: Trip, payload: CreateTripRequest): UpdateTripRequest {
  const patch: UpdateTripRequest = {}

  /** Записать поле, только если значение в самом деле поменялось. */
  const set = <K extends keyof UpdateTripRequest>(
    field: K,
    before: unknown,
    after: UpdateTripRequest[K],
  ) => {
    // `?? null` — чтобы `undefined` и `null` считались одним и тем же
    // «пусто»: иначе форма каждый раз «меняла» бы пустое поле на пустое.
    if (JSON.stringify(before ?? null) === JSON.stringify(after ?? null)) return
    patch[field] = after
  }

  /**
   * Цель сравниваем строками: в походе это `bigint` и приезжает строкой
   * («10»), а форма отправляет число (10). Сравнение «как есть» всегда
   * находило бы разницу и гнало в патч неизменную цель.
   */
  if (String(initial.goalObjectId) !== String(payload.goalObjectId)) {
    patch.goalObjectId = payload.goalObjectId
  }

  set('announcement', initial.announcement, payload.announcement ?? null)
  set('routeText', initial.routeText, payload.routeText ?? '')
  set('requirementsText', initial.requirementsText, payload.requirementsText ?? null)
  set('meetingPlace', initial.meetingPlace, payload.meetingPlace ?? null)
  set('meetingAt', initial.meetingAt, payload.meetingAt ?? null)
  set('transferText', initial.transferText, payload.transferText ?? null)
  set('visibility', initial.visibility, payload.visibility)
  set('status', initial.status, payload.status)
  set('startsAt', initial.startsAt, payload.startsAt ?? null)
  set('endsAt', initial.endsAt, payload.endsAt ?? null)
  set('isCommercial', initial.isCommercial, payload.isCommercial)
  set('isSport', initial.isSport, payload.isSport)
  set('priceRub', initial.priceRub, payload.priceRub ?? null)
  set('priceNote', initial.priceNote, payload.priceNote ?? null)

  /**
   * Варианты дат — единственное поле, которого нет в исходном походе:
   * `GET /api/trips/:id` отдаёт решение по датам, а прогноз живёт отдельной
   * таблицей и наружу не выходит. Значит, сравнивать не с чем, и правило
   * другое:
   *
   * - в форме есть варианты → человек их заполнил, отправляем списком
   *   (он заменяет прежний целиком — так устроен `PATCH`);
   * - поход был без дат (прогноз) → список отправляем даже пустым: пустой
   *   список и означает «прогноза больше нет», иначе старые варианты
   *   остались бы жить при решённом походе;
   * - поход был решённым и остался решённым → не трогаем: в форме вариантов
   *   нет по построению, и отправка `[]` стёрла бы чужие прогнозы, которых
   *   мы просто не видели.
   */
  const wasForecast = initial.startsAt === null && initial.endsAt === null
  const isForecast = (payload.startsAt ?? null) === null && (payload.endsAt ?? null) === null

  if (payload.dateVariants?.length || wasForecast || isForecast) {
    patch.dateVariants = payload.dateVariants ?? []
  }

  return patch
}
