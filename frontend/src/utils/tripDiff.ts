import type { CreateTripRequest, Trip, UpdateTripRequest } from '@/types/trips'

/**
 * Патч из формы: только то, что человек действительно изменил.
 *
 * **Почему не отправляем форму целиком.** `PATCH` различает «поля нет» и
 * «`null`»: без поля значение остаётся как было, `null` его стирает. Форма
 * правит не всё (например, «набор закрыт» переключается в самом походе) и
 * нормализует значения по-своему, поэтому в тело уходит только то, что
 * человек в самом деле поменял: непомеченное поле не может ни затереть
 * данные, которых форма не показывает, ни переписать чужую нормализацию.
 * Правило у вариантов дат своё — ниже.
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
  set('hasGuitar', initial.hasGuitar, payload.hasGuitar ?? false)
  set('visibility', initial.visibility, payload.visibility)
  set('status', initial.status, payload.status)
  set('startsAt', initial.startsAt, payload.startsAt ?? null)
  set('endsAt', initial.endsAt, payload.endsAt ?? null)
  set('isCommercial', initial.isCommercial, payload.isCommercial)
  set('isOfficial', initial.isOfficial, payload.isOfficial)
  // Открытое участие: умолчание — включено, как в базе. Форма всегда знает
  // ответ (чек-бокс), поэтому правило то же, что у прочих флагов.
  set('openParticipation', initial.openParticipation, payload.openParticipation ?? true)
  set('priceRub', initial.priceRub, payload.priceRub ?? null)
  set('priceNote', initial.priceNote, payload.priceNote ?? null)
  // Залог: пустое поле формы и `null` в походе — одно и то же «залога нет».
  set('depositRub', initial.depositRub, payload.depositRub ?? null)

  /**
   * Типы похода сравниваются **как множество, а не как список**.
   *
   * В базе это связка `trip_types`, порядок в ней ничего не значит, и API
   * отдаёт id по возрастанию. Форма хранит выбранные чипсы в порядке
   * нажатий, поэтому сравнение «как есть» находило бы разницу там, где
   * человек ничего не менял, и гнало бы в патч неизменный список.
   *
   * `undefined` в теле — «форма типов не видела» (словарь не загрузился):
   * сравнивать не с чем, и стирать типы из-за сетевой ошибки нельзя.
   */
  if (payload.activityTypeIds !== undefined) {
    const before = [...initial.activityTypeIds].sort((a, b) => a - b)
    const after = [...payload.activityTypeIds].sort((a, b) => a - b)

    if (JSON.stringify(before) !== JSON.stringify(after)) {
      patch.activityTypeIds = after
    }
  }

  /**
   * Варианты дат приходят в ответе похода (`dateVariants`) и предзаполняют
   * блок формы, но правило у них своё. Форма шлёт их списком, где каждый
   * прокликанный месяц — отдельная запись, а у решённого похода — пустым;
   * сравнение «как есть» тут ничего не даёт. Поэтому решает сценарий:
   *
   * - в форме есть варианты → человек их заполнил, отправляем списком
   *   (он заменяет прежний целиком — так устроен `PATCH`);
   * - поход был без дат (прогноз) → список отправляем даже пустым: пустой
   *   список и означает «прогноза больше нет», иначе старые варианты
   *   остались бы жить при решённом походе;
   * - поход был решённым и остался решённым → пустой список не отправляем:
   *   прогноз, которого форма не показывает, иначе бы стёрся.
   */
  const wasForecast = initial.startsAt === null && initial.endsAt === null
  const isForecast = (payload.startsAt ?? null) === null && (payload.endsAt ?? null) === null

  if (payload.dateVariants?.length || wasForecast || isForecast) {
    patch.dateVariants = payload.dateVariants ?? []
  }

  return patch
}
