<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { listGear, proposeTripGear, removeTripGear } from '@/api/gear'
import { ApiError } from '@/api/errors'
import {
  acceptRouteLodger,
  listParticipants,
  lodgeRoute,
  releaseRouteLodger,
} from '@/api/trips'
import { useAuthStore } from '@/stores/auth'
import TripGearManualModal from '@/components/gear/TripGearManualModal.vue'
import { GEAR_TYPE_CODES, TENT_TYPE_CODES } from '@/types/gear'
import type { GearItem, GearItemAttribute, TripGearItem } from '@/types/gear'
import type {
  RouteLodger,
  RouteLodgerStatus,
  RouteTraveler,
  Trip,
  TripParticipant,
  TripRoute,
} from '@/types/trips'
import { weightInGrams } from '@/utils/gearWeight'

/**
 * «Палатки» — распределение участников по палаткам (29.10.2026).
 *
 * Механика — как в «Трансфере» (заказчик: «смотри как пример на Трансфер»),
 * потому что задача та же: плашка-карточка, владелец, люди внутри,
 * «попроситься» и «уйти». Отличие одно: **распределение по палаткам
 * действует на все ночёвки сразу** — палатка у человека одна на поход.
 *
 * **Кто где живёт — на сервере** (31.10.2026). Раньше `TentMember` жил
 * в памяти компонента и пропадал при перезагрузке. Теперь источник — ответ
 * вкладки (`lodgers`, одна строка на человека на весь поход), а посадка,
 * принятие заявки и освобождение места — ручки `PUT/POST/DELETE
 * /route/lodgers/:userId`. Каждая отвечает вкладкой целиком, поэтому секция
 * не собирает состояние по кускам: получила ответ — отдала его родителю
 * (`emit('route')`), и «Палатки» перерисовались.
 *
 * **Снаряжение похода грузит родитель** (`TripRouteNights.vue`) и отдаёт
 * сюда готовым списком: таблице ночёвок палатки нужны для выпадающего
 * списка варианта «Палатка», и второй такой же запрос был бы лишним.
 * Добавили или убрали вещь — секция отдаёт новый список наверх (`emit('gear')`).
 *
 * **Типы вместо слов в названии** (30.10.2026, Stage B, часть 2). Секция
 * собрана из `TENT_TYPE_CODES`: `tent` — палатка, `shelter` — тент.
 * Раньше вид и тент угадывались по словам в названии, потому что типов
 * в базе не было; теперь оба типа есть в справочнике, и вещь приходит
 * с `typeCode`.
 *
 * - **палатка** (`tent`) — плашка с людьми и распределением;
 * - **тент** (`shelter`) — пилюля «Тент - 3000 гр. (Олег)», в распределении
 *   его нет: под тентом никто не ночует;
 * - **вместимость — значение характеристики `seats`** типа `tent`, а не
 *   число из диалога. Не заполнена — плашка честно подписывается хозяином
 *   и весом, без выдуманного «3-х местная».
 * - **добавить свою** — та же ручка, что «взять палатку в поход» на вкладке
 *   «Снаряжение» (`POST /api/trips/:id/gear`), поэтому палатка не исчезает
 *   при перезагрузке и её видит вся группа. Взяв палатку, человек сразу
 *   занимает в ней место: палатку берут, чтобы в ней спать.
 *
 * **Вместимость никого не останавливает.** Заказчик: «она идёт только для
 * информирования, нельзя блокировать добавление участников в заполненную
 * палатку. Производитель рекомендуют количество, но в реальности обычно
 * живут +1 человек». Поэтому здесь нет «мест нет»: есть строка
 * «живут 2 (Пётр, Анна)» и тихая пометка «сверх вместимости».
 *
 * **Заголовок плашки** — «{хозяин} {seats}-х местная {вес}гр.», например
 * «Анна 3-х местная 2400 гр.». Веса нет — нет и «гр.»; вместимости нет —
 * нет и числа.
 *
 * **Права.** Правят распределение хозяин палатки и тот, кто ведёт вкладку
 * (`canEdit` из ответа сервера, а не догадка фронта). Но **попроситься
 * и уйти может любой идущий**: это его собственное место, и сервер такое
 * разрешает. Себя в чужую палатку — заявкой (`requested`), принимает
 * хозяин; себя в свою или тому, кто ведёт вкладку, — сразу живёт.
 *
 * **Крестики — настоящий `DELETE`** (31.10.2026): ручка
 * `DELETE /api/trips/:id/gear/:gearId` убирает вещь из похода у владельца
 * и у организатора. Права проверяет сервер, ошибка (403) показывается
 * отдельной строкой и не прячет секцию.
 *
 * **«Указать вручную» (31.10.2026).** Последний пункт в диалогах палатки
 * и тента открывает `TripGearManualModal`: вещи в каталоге нет, а в поход
 * она нужна («кусок целлофана на тент»). Модалка одна на палатки, тент
 * и «Костровое», поэтому здесь только её вызов и приём результата: вещь
 * уходит в снаряжение похода, и секция пересобирается из общего списка.
 * Хозяин выбирается лишь организатором и только когда в походе есть люди
 * без аккаунта — вещь «для Дяди Вити» заводят именно так.
 */
const props = defineProps<{
  trip: Trip
  /** Снаряжение похода: палатки и тенты. Грузит родитель, чтобы не дважды. */
  gear: TripGearItem[]
  /** Ошибка загрузки снаряжения: секция объясняет пустоту, а не молчит. */
  gearError: string | null
  /** Кто где живёт — из ответа сервера, одно место на весь поход. */
  lodgers: RouteLodger[]
  /** Кого можно посадить: участники, которые идут. */
  travelers: RouteTraveler[]
  /** Правит ли смотрящий вкладку: от этого зависят чужие места. */
  canEdit: boolean
}>()

const emit = defineEmits<{
  /** Вкладка целиком после посадки: родитель берёт её как есть. */
  route: [TripRoute]
  /** Снаряжение похода изменилось: добавили или убрали вещь. */
  gear: [TripGearItem[]]
}>()

const auth = useAuthStore()

/** Код характеристики вместимости у типа `tent` (сид и справочник админа). */
const SEATS_ATTRIBUTE = 'seats'

/** Человек в палатке: живёт или ещё просится. */
interface TentPerson {
  userId: string
  displayName: string
  status: RouteLodgerStatus
}

/**
 * Плашка палатки. `tripGearId` — вещь в снаряжении похода, она же ключ:
 * две плашки одной палатки — это не две палатки, а непонимание.
 */
interface TentCard {
  tripGearId: string
  ownerUserId: string
  ownerName: string
  /**
   * Вместимость — значение характеристики `seats`. `null` — у вещи оно
   * не заполнено: число не выдумываем, плашка обойдётся без него.
   */
  capacity: number | null
  /** Вес вещи из каталога: его показываем в заголовке, если он известен. */
  weightGrams: number | null
}

/**
 * Тент в секции «Палатки» — вещь типа `shelter` из снаряжения похода.
 * В распределении тента нет: под ним никто не ночует, спальных мест он
 * не держит.
 */
interface AwningPill {
  /** Ключ строки — вещь снаряжения похода. */
  tripGearId: string
  /** Предмет каталога: по нему ищется, что уже взято в поход. */
  gearItemId: string
  /** Слово типа из справочника: «Тент». */
  typeName: string
  title: string
  weightGrams: number | null
  ownerUserId: string
  ownerName: string
}

const meId = computed(() => auth.user?.id ?? '')

/** Состав похода целиком: имена нужны и для палаток, и для людей без аккаунта. */
const people = ref<TripParticipant[]>([])

const isLoading = ref(true)
const error = ref<string | null>(null)

/**
 * Вместимость вещи: значение характеристики `seats`.
 *
 * Число приходит числом (`GearItemAttributeDto`), но старые данные могли
 * лечь строкой — поэтому смотрим на тип, а не на истинность: `0` и пустая
 * строка означают «не заполнено», а не «ноль мест».
 */
function seatsOf(item: { attributes?: GearItemAttribute[] }): number | null {
  const value = (item.attributes ?? []).find((row) => row.code === SEATS_ATTRIBUTE)?.value

  if (typeof value === 'number') return value > 0 ? value : null
  if (typeof value === 'string') {
    const parsed = Number(value)

    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }

  return null
}

function nameOf(userId: string): string {
  return people.value.find((person) => person.userId === userId)?.displayName ?? 'Участник'
}

function isMine(person: { userId: string }): boolean {
  return meId.value !== '' && person.userId === meId.value
}

/**
 * Плашки палаток — из снаряжения похода: только тип `tent` и только
 * «берём». «Не берём» (`declined`) в распределении не участвует.
 */
const tents = computed<TentCard[]>(() =>
  props.gear
    .filter((item) => item.typeCode === GEAR_TYPE_CODES.tent && item.status !== 'declined')
    .map((item) => ({
      tripGearId: item.id,
      ownerUserId: item.ownerUserId,
      ownerName: nameOf(item.ownerUserId),
      capacity: seatsOf(item),
      weightGrams: item.weightGrams,
    })),
)

/** Тенты — из тех же вещей похода: тип `shelter`, «не берём» не показываем. */
const awnings = computed<AwningPill[]>(() =>
  props.gear
    .filter((item) => item.typeCode === GEAR_TYPE_CODES.shelter && item.status !== 'declined')
    .map((item) => ({
      tripGearId: item.id,
      gearItemId: item.gearItemId,
      typeName: item.typeName,
      title: item.title,
      weightGrams: item.weightGrams,
      ownerUserId: item.ownerUserId,
      ownerName: nameOf(item.ownerUserId),
    })),
)

/** Может ли смотрящий править эту палатку: своя или право вкладки. */
function canManage(tent: TentCard): boolean {
  return isMine({ userId: tent.ownerUserId }) || props.canEdit
}

function isMyTent(tent: TentCard): boolean {
  return isMine({ userId: tent.ownerUserId })
}

/** Кто живёт в палатке — строки `lodgers`, а не память компонента. */
function lodgersOf(tent: TentCard): RouteLodger[] {
  return props.lodgers.filter((lodger) => lodger.tentGearId === tent.tripGearId)
}

function acceptedOf(tent: TentCard): TentPerson[] {
  return lodgersOf(tent).filter((lodger) => lodger.status === 'accepted')
}

function requestedOf(tent: TentCard): TentPerson[] {
  return lodgersOf(tent).filter((lodger) => lodger.status === 'requested')
}

/**
 * Заголовок плашки — формат заказчика 29.10.2026:
 * **«{хозяин} {основная характеристика} {вес}гр.»** — «Анна 3-х местная
 * 2400 гр.». Чего нет, того в заголовке нет: «Анна 2400 гр.» честнее, чем
 * «Анна 3-х местная» у палатки без заполненной вместимости.
 */
function capacityText(capacity: number): string {
  if (capacity === 1) return 'одноместная'
  if (capacity <= 4) return `${capacity}-х местная`

  return `${capacity}-местная`
}

function tentTitle(tent: TentCard): string {
  const parts = [tent.ownerName]

  if (tent.capacity !== null) parts.push(capacityText(tent.capacity))

  const weight = weightInGrams(tent.weightGrams)
  if (weight !== null) parts.push(weight)

  return parts.join(' ')
}

/** Сколько в палатке живёт и кто — словами, как «занято 4 из 4» у рейса. */
function membersText(tent: TentCard): string {
  const sleeping = acceptedOf(tent)

  if (sleeping.length === 0) return 'никого'

  const names = sleeping.map((person) => person.displayName).join(', ')
  const verb = sleeping.length === 1 ? 'живёт' : 'живут'

  return `${verb} ${sleeping.length} (${names})`
}

/** Пометка «народу больше, чем паспортных мест»: не запрет, а информация. */
function isOverCapacity(tent: TentCard): boolean {
  return tent.capacity !== null && acceptedOf(tent).length > tent.capacity
}

/** Кого ещё можно позвать в эту палатку: идущих и не занятых в ней. */
function outsiders(tent: TentCard): RouteTraveler[] {
  const inside = new Set(lodgersOf(tent).map((lodger) => lodger.userId))

  return props.travelers.filter((person) => !inside.has(person.userId))
}

/**
 * Что будет, если смотрящий попросится.
 *
 * Палатка — чужое личное имущество, поэтому место в ней не занимают сами:
 * человек **просится** (`requested`), а решает хозяин. В свою палатку
 * и тому, кто ведёт вкладку, сервер место даёт сразу — и подпись кнопки
 * честно говорит «Занять место». Уже внутри — `null`, кнопки нет.
 */
function joinStatus(tent: TentCard): RouteLodgerStatus | null {
  if (meId.value === '') return null
  if (!props.travelers.some((person) => person.userId === meId.value)) return null
  if (lodgersOf(tent).some((lodger) => lodger.userId === meId.value)) return null

  return isMyTent(tent) || props.canEdit ? 'accepted' : 'requested'
}

function joinLabel(tent: TentCard): string {
  return joinStatus(tent) === 'accepted' ? 'Занять место' : 'Попроситься'
}

/**
 * Кто ещё нигде не живёт. «Просится» тоже занят: человек уже в этой палатке
 * на экране, и предлагать его второй раз не нужно.
 */
const unassigned = computed(() => {
  const busy = new Set(props.lodgers.map((lodger) => lodger.userId))

  return props.travelers.filter((person) => !busy.has(person.userId))
})

/**
 * Есть ли у смотрящего где жить (29.10.2026). «Добавить свою палатку» —
 * цветная, пока человек ни в одной палатке, и белая, когда место уже есть:
 * цвет кнопки и есть ответ на вопрос «мне это ещё нужно?».
 */
const amUnassigned = computed(() => unassigned.value.some((person) => person.userId === meId.value))

const hasAwning = computed(() => awnings.value.length > 0)

// ───────────────────────────── загрузка ─────────────────────────────

/**
 * Секция догружает только состав похода: имена хозяев, людей без аккаунта
 * для формы «указать вручную» и проверку «идёт ли смотрящий».
 *
 * Снаряжение приходит пропсом: его уже загрузил родитель для выпадающего
 * списка «Палатка» в таблице ночёвок.
 */
async function load(): Promise<void> {
  isLoading.value = true
  error.value = null

  try {
    people.value = await listParticipants(props.trip.id)
  } catch (problem) {
    error.value =
      problem instanceof ApiError ? problem.message : 'Не удалось загрузить распределение'
  } finally {
    isLoading.value = false
  }
}

watch(() => props.trip.id, load, { immediate: true })

/** Ошибка снаряжения приходит сверху: показываем её вместо пустого списка. */
const shownError = computed(() => props.gearError ?? error.value)

// ───────────────────────────── посадка ─────────────────────────────

/** Идёт ли запрос распределения: кнопки не должны звать его дважды. */
const isLodging = ref(false)
const lodgingError = ref<string | null>(null)

/**
 * Общий путь всех посадок: ручка отвечает вкладкой целиком, поэтому
 * результат уходит родителю одним событием, а не правится здесь по кускам.
 */
async function applyLodging(action: () => Promise<TripRoute>): Promise<void> {
  if (isLodging.value) return

  isLodging.value = true
  lodgingError.value = null

  try {
    emit('route', await action())
  } catch (problem) {
    lodgingError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось изменить распределение'
  } finally {
    isLodging.value = false
  }
}

/**
 * Взять человека в палатку. Селект сбрасывается на пустой пункт — как
 * «взять на борт» в «Трансфере»: действие одно, а не выбранное состояние.
 */
function addMember(tent: TentCard, event: Event): void {
  const select = event.target as HTMLSelectElement
  const userId = select.value

  select.value = ''

  if (userId === '') return

  void applyLodging(() => lodgeRoute(props.trip.id, userId, tent.tripGearId))
}

/** Попроситься или занять место: заявку или сразу место решает сервер. */
function join(tent: TentCard): void {
  if (joinStatus(tent) === null) return

  void applyLodging(() => lodgeRoute(props.trip.id, meId.value, tent.tripGearId))
}

/** Выйти из палатки или отменить свою заявку: одно действие «убрать себя». */
function leave(person: TentPerson): void {
  void applyLodging(() => releaseRouteLodger(props.trip.id, person.userId))
}

/** Владелец принимает заявку: человек переходит из «просятся» в жильцы. */
function acceptRequest(person: TentPerson): void {
  void applyLodging(() => acceptRouteLodger(props.trip.id, person.userId))
}

/**
 * Убирать человека из палатки может он сам, хозяин палатки и тот, кто ведёт
 * вкладку. Хозяина из его собственной палатки не убираем: палатка уходит
 * из похода вместе с ним.
 */
function canRemoveMember(tent: TentCard, person: TentPerson): boolean {
  if (person.userId === tent.ownerUserId) return false

  return isMine(person) || canManage(tent)
}

// ───────────────────────────── крестик палатки ─────────────────────────────

/** Что сейчас убирается: повторное нажатие крестика не шлёт второй запрос. */
const removingGearId = ref<string | null>(null)

/**
 * Ошибка удаления — отдельно от ошибки загрузки.
 *
 * Ошибка загрузки заменяет секцию целиком, и это правильно: показывать
 * нечего. Упавшее удаление, наоборот, не должно прятать палатки — человек
 * нажал крестик, получил 403 и должен видеть и текст, и то, что осталось.
 */
const removalError = ref<string | null>(null)

/**
 * Убрать вещь из снаряжения похода — настоящим `DELETE`.
 *
 * Крестик у палатки и у тента делает одно и то же, поэтому общий помощник:
 * строка `trip_gear` удаляется на сервере, одноразовая вещь уходит вместе
 * с ней, вещь каталога остаётся у владельца. Права проверяет сервер: чужая
 * вещь без права на вкладку «Снаряжение» — 403, и его текст показывается
 * на экране, а не проглатывается.
 */
async function removeTripItem(tripGearId: string): Promise<boolean> {
  if (removingGearId.value !== null) return false

  removingGearId.value = tripGearId
  removalError.value = null

  try {
    await removeTripGear(props.trip.id, tripGearId)
    emit(
      'gear',
      props.gear.filter((row) => row.id !== tripGearId),
    )

    return true
  } catch (problem) {
    removalError.value =
      problem instanceof ApiError
        ? problem.message
        : 'Не удалось убрать вещь из похода'

    return false
  } finally {
    removingGearId.value = null
  }
}

/**
 * Крестик на плашке: палатка уходит из снаряжения похода (31.10.2026).
 *
 * Раньше действие жило в памяти, а организатор мог только предложить
 * убрать — ручки удаления не было. Теперь `DELETE` настоящий, и после
 * перезагрузки палатка не возвращается. Места в ней уходят каскадом.
 */
async function removeTent(tent: TentCard): Promise<void> {
  await removeTripItem(tent.tripGearId)
}

function removeTentHint(): string {
  return 'Убрать палатку из похода'
}

// ───────────────────────────── тент ─────────────────────────────

const isAwningDialogOpen = ref(false)
const isAwningLoading = ref(false)
const isAwningSaving = ref(false)
const awningError = ref<string | null>(null)

/** Тенты, которые можно взять: свои и ещё не взятые. */
const myAwnings = ref<GearItem[]>([])
const draftAwningId = ref('')

async function openAwningDialog(): Promise<void> {
  isAwningDialogOpen.value = true
  awningError.value = null
  draftAwningId.value = ''
  isAwningLoading.value = true

  try {
    const list = await listGear()
    const taken = new Set(props.gear.map((item) => item.gearItemId))

    myAwnings.value = list.items.filter(
      (item) => item.typeCode === GEAR_TYPE_CODES.shelter && !taken.has(item.id),
    )
  } catch (problem) {
    awningError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось загрузить снаряжение'
  } finally {
    isAwningLoading.value = false
  }
}

/**
 * Тент уходит в снаряжение похода той же ручкой, что палатка: с 30.10.2026
 * это настоящий тип `shelter`, и строка переживает перезагрузку.
 */
async function saveAwning(): Promise<void> {
  if (isAwningSaving.value || draftAwningId.value === '') return

  isAwningSaving.value = true
  awningError.value = null

  try {
    const item = await proposeTripGear(props.trip.id, draftAwningId.value)

    emit('gear', [...props.gear, item])
    isAwningDialogOpen.value = false
  } catch (problem) {
    // Ошибка — в модалке, а не строкой под затемнением (правило «Трансфера»).
    awningError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось добавить тент'
  } finally {
    isAwningSaving.value = false
  }
}

/** Строка выбора: «Тент 3×4 · 3000 гр.». */
function awningOptionText(item: GearItem): string {
  const weight = weightInGrams(item.weightGrams)

  return weight === null ? item.title : `${item.title} · ${weight}`
}

/** Пилюля тента в формате заказчика: «Тент - 3000 гр. (Олег)». */
function awningText(awning: AwningPill): string {
  const weight = weightInGrams(awning.weightGrams)
  const head = weight === null ? awning.typeName : `${awning.typeName} - ${weight}`

  return `${head} (${awning.ownerName})`
}

function canManageAwning(awning: AwningPill): boolean {
  return isMine({ userId: awning.ownerUserId }) || props.canEdit
}

async function removeAwning(awning: AwningPill): Promise<void> {
  await removeTripItem(awning.tripGearId)
}

// ───────────────────────────── своя палатка ─────────────────────────────

const isDialogOpen = ref(false)
const isGearLoading = ref(false)
const isSaving = ref(false)
const dialogError = ref<string | null>(null)

/** Мои палатки, которых ещё нет в снаряжении похода. */
const myTents = ref<GearItem[]>([])
const draftGearItemId = ref('')

/** Выбранная в форме палатка: у неё может не быть значения вместимости. */
const selectedTent = computed<GearItem | null>(
  () => myTents.value.find((item) => item.id === draftGearItemId.value) ?? null,
)

const selectedTentSeats = computed(() =>
  selectedTent.value === null ? null : seatsOf(selectedTent.value),
)

async function openDialog(): Promise<void> {
  isDialogOpen.value = true
  dialogError.value = null
  draftGearItemId.value = ''
  isGearLoading.value = true

  try {
    const list = await listGear()
    const inTrip = new Set(props.gear.map((item) => item.gearItemId))

    myTents.value = list.items.filter(
      (item) => item.typeCode === GEAR_TYPE_CODES.tent && !inTrip.has(item.id),
    )
  } catch (problem) {
    dialogError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось загрузить снаряжение'
  } finally {
    isGearLoading.value = false
  }
}

/**
 * Взяли свою палатку в поход — и сразу живём в ней: палатку берут, чтобы
 * в ней спать, а не чтобы она стояла в списке. Место занимает сервер, и
 * заявки тут быть не может: палатка своя. Человек, который не идёт, места
 * не получает — сервер такое отбивает, поэтому и не просим.
 */
async function placeOwnerInTent(tripGearId: string): Promise<void> {
  if (!props.travelers.some((person) => person.userId === meId.value)) return

  try {
    emit('route', await lodgeRoute(props.trip.id, meId.value, tripGearId))
  } catch (problem) {
    lodgingError.value =
      problem instanceof ApiError
        ? problem.message
        : 'Палатка добавлена, но место в ней занять не удалось'
  }
}

async function saveTent(): Promise<void> {
  if (isSaving.value || draftGearItemId.value === '') return

  isSaving.value = true
  dialogError.value = null

  try {
    const item = await proposeTripGear(props.trip.id, draftGearItemId.value)

    emit('gear', [...props.gear, item])
    isDialogOpen.value = false
    await placeOwnerInTent(item.id)
  } catch (problem) {
    // Ошибка — в модалке, а не строкой под затемнением (правило «Трансфера»).
    dialogError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось добавить палатку'
  } finally {
    isSaving.value = false
  }
}

// ───────────────────────────── «указать вручную» ─────────────────────────────

/** Тип, с которым откроется модалка: палатка из одного диалога, тент из другого. */
const manualTypeCode = ref<string>(GEAR_TYPE_CODES.tent)
const isManualOpen = ref(false)

/**
 * Комплект хозяев для вещи, заведённой вручную.
 *
 * Список есть только у организатора и только если в походе есть люди без
 * аккаунта: другому настоящему участнику вещь не добавляют (решение
 * заказчика 31.10.2026 — каждый добавляет своё сам), а если виртуальных
 * нет, выбирать не из кого. Первым идёт «я» — вещь себе.
 */
const manualOwnerOptions = computed(() => {
  if (meId.value === '' || props.trip.organizerUserId !== meId.value) return []

  const virtuals = people.value.filter((person) => person.isVirtual)
  if (virtuals.length === 0) return []

  return [
    { userId: meId.value, displayName: `${auth.user?.displayName ?? 'Я'} (я)` },
    ...virtuals.map((person) => ({
      userId: person.userId,
      displayName: `${person.displayName} (без аккаунта)`,
    })),
  ]
})

function openManual(typeCode: string): void {
  manualTypeCode.value = typeCode
  isDialogOpen.value = false
  isAwningDialogOpen.value = false
  isManualOpen.value = true
}

/**
 * Завели вещь вручную — кладём её в снаряжение похода и пересобираем секцию.
 *
 * Пересборка идёт из общего списка, а не «дорисовкой» одной плашки: модалка
 * позволяет выбрать и палатку, и тент, и вещь кострового типа — в какую
 * секцию она попадёт, решает её тип, а не диалог, из которого её открыли.
 */
function onManualCreated(item: TripGearItem): void {
  emit('gear', [...props.gear, item])
  isManualOpen.value = false
}
</script>

<template>
  <section class="flex flex-col gap-3" data-test="route-tents">
    <p class="text-sm text-text" data-test="route-tents-title">
      Распределение участников по палаткам
    </p>

    <p v-if="isLoading" class="text-sm text-muted" data-test="route-tents-loading">
      Загружаем палатки…
    </p>

    <p v-else-if="shownError" class="text-sm text-muted" data-test="route-tents-error">
      {{ shownError }}
    </p>

    <template v-else>
      <p
        v-if="removalError"
        class="text-sm text-red-600"
        data-test="route-tents-remove-error"
      >
        {{ removalError }}
      </p>

      <!--
        Ошибка посадки — отдельной строкой, как у удаления: упавшая заявка
        не должна прятать палатки, человеку нужно видеть и текст, и состав.
      -->
      <p
        v-if="lodgingError"
        class="text-sm text-red-600"
        data-test="route-tents-lodging-error"
      >
        {{ lodgingError }}
      </p>

      <p v-if="tents.length === 0" class="text-sm text-muted" data-test="route-tents-empty">
        Пока никто не взял палатку — добавьте свою из личного снаряжения.
      </p>

      <article
        v-for="tent in tents"
        :key="tent.tripGearId"
        class="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3"
        data-test="route-tent"
      >
        <header class="flex flex-col gap-0.5">
          <!--
            Заголовок и крестик — одной строкой: крестик убирает палатку
            из снаряжения похода настоящим DELETE. Виден владельцу
            и организатору; права окончательно проверяет сервер.
          -->
          <div class="flex items-start justify-between gap-2">
            <h4 class="text-base font-medium text-text" data-test="route-tent-title">
              {{ tentTitle(tent) }}
            </h4>

            <button
              v-if="canManage(tent)"
              type="button"
              :disabled="removingGearId !== null"
              class="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-base text-muted transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
              :title="removeTentHint()"
              :data-test="`route-tent-remove-${tent.tripGearId}`"
              @click="removeTent(tent)"
            >
              ×
            </button>
          </div>

          <span class="text-sm text-muted" data-test="route-tent-summary">
            {{ membersText(tent) }}
          </span>

          <!--
            Вместимость — не запрет: производитель рекомендует количество,
            а живут обычно +1. Поэтому вместо «мест нет» — тихая пометка.
          -->
          <span
            v-if="isOverCapacity(tent)"
            class="text-xs text-muted"
            data-test="route-tent-over"
          >
            сверх вместимости
          </span>
        </header>

        <div class="flex flex-wrap items-center gap-2" data-test="route-tent-members">
          <!--
            Люди — те же жёлтые пилюли, что пассажиры в «Трансфере»: человек
            один и тот же, и цвет у него один. Не `bg-field`, иначе пилюля
            читается как ещё один контрол.
          -->
          <span
            v-for="person in acceptedOf(tent)"
            :key="person.userId"
            class="flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-2 py-1 text-sm text-amber-900"
            data-test="route-tent-member"
          >
            {{ person.displayName }}
            <span v-if="isMine(person)" class="text-xs text-amber-700">(вы)</span>

            <!-- Владельца из его палатки не убрать: палатка уходит вместе с ним. -->
            <button
              v-if="canRemoveMember(tent, person)"
              type="button"
              :disabled="isLodging"
              class="cursor-pointer border-0 bg-transparent p-0 text-amber-700 transition-colors hover:text-amber-900 disabled:opacity-40"
              :data-test="`route-tent-leave-${person.userId}`"
              @click="leave(person)"
            >
              ×
            </button>
          </span>
        </div>

        <!-- Заявки на чужую палатку: принимает владелец -->
        <div
          v-if="requestedOf(tent).length > 0"
          class="flex flex-col gap-1 rounded-lg border border-dashed border-border p-2"
          data-test="route-tent-requests"
        >
          <span class="text-xs text-muted">Просятся</span>

          <span
            v-for="person in requestedOf(tent)"
            :key="person.userId"
            class="flex flex-wrap items-center gap-2 text-sm text-text"
          >
            {{ person.displayName }}

            <template v-if="canManage(tent)">
              <button
                type="button"
                :disabled="isLodging"
                class="cursor-pointer rounded-lg border border-primary bg-primary px-2 py-1 text-xs text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                :data-test="`route-tent-accept-${person.userId}`"
                @click="acceptRequest(person)"
              >
                Принять
              </button>
              <button
                type="button"
                :disabled="isLodging"
                class="cursor-pointer rounded-lg border border-border bg-field px-2 py-1 text-xs text-text transition-colors hover:border-primary disabled:opacity-40"
                :data-test="`route-tent-reject-${person.userId}`"
                @click="leave(person)"
              >
                Отклонить
              </button>
            </template>

            <!-- Свою заявку человек отменяет сам -->
            <button
              v-else-if="isMine(person)"
              type="button"
              :disabled="isLodging"
              class="cursor-pointer border-0 bg-transparent p-0 text-xs text-muted underline transition-colors hover:text-text disabled:opacity-40"
              :data-test="`route-tent-leave-${person.userId}`"
              @click="leave(person)"
            >
              Отменить заявку
            </button>
          </span>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <!--
            «Попроситься» — белая (29.10.2026): это не главное действие
            секции, а просьба, и цветная кнопка рядом с «взять в палатку»
            перетягивала внимание на себя. Цветная — только там, где
            человеку действительно есть что предложить.

            Подпись честная: в свою палатку и тому, кто ведёт вкладку,
            сервер даёт место сразу, поэтому «Занять место», а не «Попроситься».
          -->
          <button
            v-if="joinStatus(tent) !== null"
            type="button"
            :disabled="isLodging"
            class="cursor-pointer rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-text transition-colors hover:border-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
            data-test="route-tent-join"
            @click="join(tent)"
          >
            {{ joinLabel(tent) }}
          </button>

          <span
            v-else-if="isMyTent(tent)"
            class="text-xs text-muted"
            data-test="route-tent-owner-hint"
          >
            Ваша палатка — заявки принимаете вы
          </span>

          <!--
            «Мест нет» здесь не бывает: вместимость — характеристика для
            информации, и заполненная палатка не повод отказать человеку.
          -->
          <select
            v-if="canManage(tent) && outsiders(tent).length > 0"
            :disabled="isLodging"
            class="w-full rounded-xl border border-border bg-field px-2 py-1 text-base text-text transition-colors focus:border-primary focus:outline-none disabled:opacity-60 md:w-auto md:text-sm"
            data-test="route-tent-add-member"
            @change="addMember(tent, $event)"
          >
            <option value="">взять в палатку…</option>
            <option
              v-for="person in outsiders(tent)"
              :key="person.userId"
              :value="person.userId"
            >
              {{ person.displayName }}
            </option>
          </select>
        </div>
      </article>

      <!--
        Тенты — вещи типа `shelter` из снаряжения похода, пилюлями в формате
        «Тент - 3000 гр. (Олег)»: под тентом никто не ночует, поэтому
        в распределении его нет, но у вещи есть хозяин, вес и крестик
        с теми же правами, что у палаток.
      -->
      <div
        v-if="awnings.length > 0"
        class="flex flex-wrap items-center gap-2"
        data-test="route-awnings"
      >
        <span
          v-for="awning in awnings"
          :key="awning.tripGearId"
          class="flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-1 text-sm text-emerald-900"
          :title="awning.title"
          data-test="route-awning"
        >
          <span>{{ awningText(awning) }}</span>

          <button
            v-if="canManageAwning(awning)"
            type="button"
            :disabled="removingGearId !== null"
            class="cursor-pointer border-0 bg-transparent p-0 text-emerald-700 transition-colors hover:text-emerald-900 disabled:cursor-not-allowed disabled:opacity-40"
            title="Убрать тент из похода"
            :data-test="`route-awning-remove-${awning.tripGearId}`"
            @click="removeAwning(awning)"
          >
            ×
          </button>
        </span>
      </div>

      <!-- Кто ещё нигде не живёт -->
      <div v-if="unassigned.length > 0" class="flex flex-col gap-2">
        <hr class="border-border" />

        <div class="flex flex-wrap items-center gap-1" data-test="route-tents-unassigned">
          <span class="text-xs text-muted">Не распределены:</span>
          <span
            v-for="person in unassigned"
            :key="person.userId"
            class="rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted"
          >
            {{ person.displayName }}
          </span>
        </div>
      </div>

      <!--
        Цвет обеих кнопок — ответ на вопрос «мне это ещё нужно?» (29.10.2026):
        «Добавить свою палатку» цветная, пока смотрящий нигде не живёт,
        «Добавить тент» — пока тента в секции нет. Нажимать можно всегда:
        второй топор или второй тент тоже бывают.
      -->
      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="cursor-pointer rounded-xl px-3 py-2 text-sm transition-colors"
          :class="
            amUnassigned
              ? 'border border-emerald-600 bg-emerald-600 text-white hover:opacity-90'
              : 'border border-border bg-field text-text hover:border-emerald-600'
          "
          data-test="route-tent-add"
          @click="openDialog"
        >
          Добавить свою палатку
        </button>

        <!--
          Тент — не палатка и не спальное место: под ним никто не ночует.
          Это отдельный тип `shelter`, поэтому вещь уходит в снаряжение
          похода и живёт в секции наравне с палатками.
        -->
        <button
          type="button"
          class="cursor-pointer rounded-xl px-3 py-2 text-sm transition-colors"
          :class="
            hasAwning
              ? 'border border-border bg-field text-text hover:border-emerald-600'
              : 'border border-emerald-600 bg-emerald-600 text-white hover:opacity-90'
          "
          data-test="route-tent-awning"
          @click="openAwningDialog"
        >
          Добавить тент
        </button>
      </div>

      <!-- Одна форма на добавление: палатка из личного каталога -->
      <div
        v-if="isDialogOpen"
        class="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4"
        data-test="route-tent-dialog"
      >
        <div
          class="flex w-full max-w-md flex-col gap-2 rounded-xl border border-border bg-surface p-4"
        >
          <h3 class="text-base font-medium text-text">Своя палатка</h3>

          <label class="flex flex-col gap-1 text-sm text-muted">
            Палатка из снаряжения
            <select
              v-model="draftGearItemId"
              class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none md:text-sm"
              :disabled="isGearLoading"
              data-test="route-tent-gear"
            >
              <option value="">выберите…</option>
              <option v-for="item in myTents" :key="item.id" :value="item.id">
                {{ item.title }}
              </option>
            </select>
          </label>

          <p
            v-if="!isGearLoading && myTents.length === 0"
            class="text-xs text-muted"
            data-test="route-tent-no-gear"
          >
            Свободной палатки в личном снаряжении нет — заведите её в профиле,
            на вкладке «Снаряжение», или укажите вручную.
          </p>

          <!--
            «Указать вручную» — последний пункт выбора снаряжения: вещи нет
            в каталоге, а в поход она нужна. Открывает общую модалку с типом,
            характеристиками, весом и хозяином.
          -->
          <button
            type="button"
            class="cursor-pointer self-start border-0 bg-transparent p-0 text-sm text-primary underline transition-opacity hover:opacity-80"
            data-test="route-tent-manual"
            @click="openManual(GEAR_TYPE_CODES.tent)"
          >
            Указать вручную
          </button>

          <!--
            Вместимость не спрашиваем: это характеристика `seats` у вещи,
            и правят её в каталоге. Если она не заполнена — говорим словами,
            а не подставляем «3 места» за человека.
          -->
          <p
            v-if="selectedTent !== null && selectedTentSeats === null"
            class="text-xs text-muted"
            data-test="route-tent-no-capacity"
          >
            У этой палатки не заполнена вместимость — впишите её в профиле,
            на вкладке «Снаряжение». Пока плашка подпишется хозяином и весом.
          </p>

          <p class="text-xs text-muted">
            Вместимость — характеристика вещи для информации: производитель
            рекомендует количество, но в палатке часто живут на одного больше.
            Добавлять людей она не мешает.
          </p>

          <p v-if="dialogError" class="text-sm text-red-600" data-test="route-tent-error">
            {{ dialogError }}
          </p>

          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="cursor-pointer rounded-xl border border-primary bg-primary px-3 py-1.5 text-sm text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              :disabled="isSaving || draftGearItemId === ''"
              data-test="route-tent-save"
              @click="saveTent"
            >
              Добавить
            </button>

            <button
              type="button"
              class="cursor-pointer rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-text transition-colors hover:border-primary"
              :disabled="isSaving"
              data-test="route-tent-cancel"
              @click="isDialogOpen = false"
            >
              Отмена
            </button>
          </div>
        </div>
      </div>

      <!-- Тент: тот же путь, что у палатки — вещь уходит в снаряжение похода -->
      <div
        v-if="isAwningDialogOpen"
        class="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4"
        data-test="route-awning-dialog"
      >
        <div
          class="flex w-full max-w-md flex-col gap-2 rounded-xl border border-border bg-surface p-4"
        >
          <h3 class="text-base font-medium text-text">Тент</h3>

          <label class="flex flex-col gap-1 text-sm text-muted">
            Тент из снаряжения
            <select
              v-model="draftAwningId"
              class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none md:text-sm"
              :disabled="isAwningLoading"
              data-test="route-awning-gear"
            >
              <option value="">выберите…</option>
              <option v-for="item in myAwnings" :key="item.id" :value="item.id">
                {{ awningOptionText(item) }}
              </option>
            </select>
          </label>

          <p
            v-if="!isAwningLoading && myAwnings.length === 0"
            class="text-xs text-muted"
            data-test="route-awning-no-gear"
          >
            Тента в личном снаряжении нет — заведите вещь типа «Тент»
            в профиле, на вкладке «Снаряжение», или укажите вручную.
          </p>

          <button
            type="button"
            class="cursor-pointer self-start border-0 bg-transparent p-0 text-sm text-primary underline transition-opacity hover:opacity-80"
            data-test="route-awning-manual"
            @click="openManual(GEAR_TYPE_CODES.shelter)"
          >
            Указать вручную
          </button>

          <p v-if="awningError" class="text-sm text-red-600" data-test="route-awning-error">
            {{ awningError }}
          </p>

          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="cursor-pointer rounded-xl border border-primary bg-primary px-3 py-1.5 text-sm text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              :disabled="isAwningSaving || draftAwningId === ''"
              data-test="route-awning-save"
              @click="saveAwning"
            >
              Добавить
            </button>

            <button
              type="button"
              class="cursor-pointer rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-text transition-colors hover:border-primary"
              :disabled="isAwningSaving"
              data-test="route-awning-cancel"
              @click="isAwningDialogOpen = false"
            >
              Отмена
            </button>
          </div>
        </div>
      </div>

      <!--
        «Указать вручную» — одна модалка на палатки и тенты: тип выбирается
        из TENT_TYPE_CODES, поэтому вещь сама попадёт в свою секцию.
      -->
      <TripGearManualModal
        v-if="isManualOpen"
        :trip-id="trip.id"
        :type-codes="TENT_TYPE_CODES"
        :default-type-code="manualTypeCode"
        :owner-options="manualOwnerOptions"
        @created="onManualCreated"
        @close="isManualOpen = false"
      />
    </template>
  </section>
</template>
