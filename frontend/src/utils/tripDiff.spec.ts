import { describe, expect, it } from 'vitest'

import type { CreateTripRequest, Trip } from '@/types/trips'
import { buildTripPatch } from '@/utils/tripDiff'

/**
 * Тесты сборки патча.
 *
 * Здесь ловится самая дорогая ошибка страницы правки: отправка формы целиком.
 * `PATCH` различает «поля нет» и «`null`», поэтому лишнее поле не «просто
 * повторит значение», а затрёт то, чего человек не видел, — например,
 * варианты дат, которых нет в ответе API.
 */
const TRIP: Trip = {
  id: '1',
  organizerUserId: 'u-1',
  goalObjectId: '10',
  goalObject: { id: '10', name: 'Витязь', type: 'скальник', url: null },
  announcement: 'Идём на майские',
  routeText: 'Подход от станции',
  requirementsText: 'Свои кошки',
  hasGuitar: false,
  visibility: 'public',
  isRecruitmentClosed: false,
  activityTypeIds: [],
  status: 'decided',
  startsAt: '2027-05-05T01:00:00.000Z',
  endsAt: '2027-05-09T10:00:00.000Z',
  dateVariants: [],
  actualStartedAt: null,
  actualFinishedAt: null,
  isCommercial: false,
  isOfficial: false,
  priceRub: null,
  priceNote: null,
  cancelledAt: null,
  createdAt: '2026-10-14T10:00:00.000Z',
  updatedAt: '2026-10-14T10:00:00.000Z',
}

/** Форма, отданная «как есть»: ничего не менялось. */
const payload = (overrides: Partial<CreateTripRequest> = {}): CreateTripRequest => ({
  goalObjectId: 10,
  announcement: 'Идём на майские',
  routeText: 'Подход от станции',
  requirementsText: 'Свои кошки',
  hasGuitar: false,
  visibility: 'public',
  status: 'decided',
  startsAt: '2027-05-05T01:00:00.000Z',
  endsAt: '2027-05-09T10:00:00.000Z',
  isCommercial: false,
  isOfficial: false,
  priceRub: null,
  priceNote: null,
  dateVariants: [],
  ...overrides,
})

describe('buildTripPatch', () => {
  it('ничего не изменилось — пустой патч, а не вся форма', () => {
    expect(buildTripPatch(TRIP, payload())).toEqual({})
  })

  it('в патч попадает только изменённое поле', () => {
    const patch = buildTripPatch(TRIP, payload({ announcement: 'Перенесли на июнь' }))

    expect(patch).toEqual({ announcement: 'Перенесли на июнь' })
  })

  it('очистка приходит null-ом, а не пропуском поля', () => {
    const patch = buildTripPatch(TRIP, payload({ requirementsText: null }))

    expect(patch).toEqual({
      requirementsText: null,
    })
  })

  it('«будет гитара» — обычный boolean: в патч только при смене', () => {
    expect(buildTripPatch(TRIP, payload({ hasGuitar: true }))).toEqual({ hasGuitar: true })
    expect(buildTripPatch({ ...TRIP, hasGuitar: true }, payload({ hasGuitar: false }))).toEqual({
      hasGuitar: false,
    })
  })

  it('новая цель сравнивается как строка: в походе bigint, в форме число', () => {
    expect(buildTripPatch(TRIP, payload({ goalObjectId: 10 }))).toEqual({})
    expect(buildTripPatch(TRIP, payload({ goalObjectId: 11 }))).toEqual({ goalObjectId: 11 })
  })

  it('цена и признаки попадают в патч только при смене', () => {
    const patch = buildTripPatch(
      TRIP,
      payload({ isCommercial: true, priceRub: 25000, priceNote: null }),
    )

    expect(patch).toEqual({ isCommercial: true, priceRub: 25000 })
  })

  /**
   * Типы похода — множество: порядок чипсов в форме значит не больше, чем
   * порядок строк в связке `trip_types`. Сравнение «как есть» гнало бы
   * в патч неизменный список после каждого перещёлкивания того же набора.
   */
  describe('типы похода', () => {
    const withTypes: Trip = { ...TRIP, activityTypeIds: [19, 20] }

    it('тот же набор в другом порядке — не изменение', () => {
      expect(buildTripPatch(withTypes, payload({ activityTypeIds: [20, 19] }))).toEqual({})
    })

    it('новый тип уезжает списком', () => {
      expect(buildTripPatch(withTypes, payload({ activityTypeIds: [19, 20, 21] }))).toEqual({
        activityTypeIds: [19, 20, 21],
      })
    })

    it('снятый тип уезжает пустым списком, а не пропуском', () => {
      expect(buildTripPatch(withTypes, payload({ activityTypeIds: [] }))).toEqual({
        activityTypeIds: [],
      })
    })

    it('словарь не загрузился — типов в патче нет', () => {
      // `undefined` в теле значит «форма типов не видела»: стирать чужой
      // выбор из-за сетевой ошибки нельзя.
      const withoutTypes = payload()
      delete withoutTypes.activityTypeIds

      expect(buildTripPatch(withTypes, withoutTypes)).toEqual({})
    })
  })

  /**
   * Варианты дат — единственное поле, которого нет в ответе API. Правило
   * у него другое, и оно проверяется отдельно: иначе однажды кто-то
   * «упростит» код и сотрёт чужие прогнозы.
   */
  describe('варианты дат', () => {
    it('решённый поход остаётся решённым — варианты не трогаем', () => {
      expect(buildTripPatch(TRIP, payload()).dateVariants).toBeUndefined()
    })

    it('заполненные варианты уезжают списком', () => {
      const patch = buildTripPatch(
        TRIP,
        payload({ dateVariants: [{ year: 2027, month: 6, durationDays: 5 }] }),
      )

      expect(patch.dateVariants).toEqual([{ year: 2027, month: 6, durationDays: 5 }])
    })

    it('поход из прогноза становится решённым — старые варианты убираем', () => {
      const forecast: Trip = { ...TRIP, status: 'planning', startsAt: null, endsAt: null }
      const patch = buildTripPatch(forecast, payload())

      // Даты появились — значит прогноз больше не нужен, и пустой список
      // здесь означает «стереть», а не «не трогать».
      expect(patch.dateVariants).toEqual([])
      expect(patch.startsAt).toBe('2027-05-05T01:00:00.000Z')
    })
  })
})
