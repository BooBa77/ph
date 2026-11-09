import type { Checklist } from '@/types/checklists'

/**
 * «Аптечка» похода на фронте (09.11.2026).
 *
 * Две секции, как у «Снаряжения»: общественная и личная. Общественной нет,
 * пока в походе не назначен доктор, — сервер возвращает `shared: null`,
 * и экран не рисует секцию.
 */
export interface FirstAidSection {
  /** Список секции. Сервер заводит его при первом чтении вкладки. */
  checklist: Checklist | null
  /** Вес готовой аптечки. `null` — не взвешена; на экране цифры нет. */
  weightGrams: number | null
  /** Можно ли править список и вес. */
  canEdit: boolean
}

/** Область веса: общественная аптечка или личная. */
export const FIRST_AID_WEIGHT_SCOPES = ['shared', 'personal'] as const
export type FirstAidWeightScope = (typeof FIRST_AID_WEIGHT_SCOPES)[number]

/** Ответ `GET /api/trips/:id/first-aid` и `PATCH .../first-aid/weight`. */
export interface TripFirstAid {
  /** Доктор похода: ему едет общественная аптечка. `null` — не назначен. */
  doctorUserId: string | null
  /** Имя доктора для подписи секции. */
  doctorName: string | null
  /** Можно ли править общественную аптечку. */
  canEdit: boolean
  /** Общественная секция. `null` — доктора нет, секции тоже. */
  shared: FirstAidSection | null
  /** Личная секция смотрящего. */
  personal: FirstAidSection
  /** Вид чата вкладки — фиксирован сервером. */
  chatKind: 'trip_first_aid'
}
