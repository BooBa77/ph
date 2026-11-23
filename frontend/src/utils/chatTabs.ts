/**
 * Вкладка похода для вида чата: куда ведёт «Открыть чат» и ссылка на поход.
 *
 * Коды совпадают с `TripTabCode` в `TripView.vue` — там же их читает
 * `?tab=`, поэтому адрес открывается в нужную вкладку, а не в «Гостевую».
 *
 * Таблица жила в правой колонке (`RightRail.vue`). Когда появился экран
 * диалога, тому понадобилась та же самая — и вторая копия разошлась бы
 * при первом же новом виде чата: один список знал бы про «Ночёвки»,
 * другой нет.
 */
const TAB_BY_KIND: Record<string, string> = {
  trip_guest: 'guest',
  trip_members: 'members',
  trip_meals: 'meals',
  trip_transfer: 'transfer',
  trip_route: 'route',
  trip_gear: 'gear',
  trip_first_aid: 'firstAid',
  trip_finance: 'finance',
}

/** Вкладка похода для вида чата. `null` — вид чата неизвестен. */
export function tripTabOf(kind: string): string | null {
  return TAB_BY_KIND[kind] ?? null
}
