<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { listGear, listTripGear, proposeTripGear } from '@/api/gear'
import { ApiError } from '@/api/errors'
import { listParticipants } from '@/api/trips'
import { useAuthStore } from '@/stores/auth'
import type { GearItem, TripGearItem } from '@/types/gear'
import type { Trip, TripParticipant } from '@/types/trips'
import { weightInGrams } from '@/utils/gearWeight'

/**
 * «Палатки» — распределение участников по палаткам (29.10.2026).
 *
 * Механика — как в «Трансфере» (заказчик: «смотри как пример на Трансфер»),
 * потому что задача та же: плашка-карточка, владелец, люди внутри, «проситься»
 * и «уйти». Отличие одно: **распределение по палаткам действует на все
 * ночёвки сразу** — палатка у человека одна на поход, и делить её по ночам
 * не нужно.
 *
 * Что здесь настоящее, а что макет:
 *
 * - **люди** — участники похода (`GET /api/trips/:id/participants`), только
 *   «идёт»: место в палатке занимает решивший (заказчик 29.10.2026, строже
 *   карты вкладок, где распределялись и «50/50»);
 * - **палатки** — снаряжение похода (`GET /api/trips/:id/gear`, вид `tent`,
 *   кроме «не берём»): плашка палатки — это вещь, а не текст в ночёвках;
 * - **добавить свою** — та же ручка, что «взять палатку в поход» на вкладке
 *   «Снаряжение» (`POST /api/trips/:id/gear`), поэтому палатка не исчезает
 *   при перезагрузке и её видит вся группа;
 * - **кто в какой палатке живёт — в памяти компонента** и никуда не уходит:
 *   таблицы распределения ещё нет, это следующий шаг (NEXT.md §2–§3).
 *
 * **Вместимость никого не останавливает.** Заказчик: «она идёт только для
 * информирования, нельзя блокировать добавление участников в заполненную
 * палатку. Производитель рекомендуют количество, но в реальности обычно
 * живут +1 человек». Поэтому здесь нет «мест нет», как у рейса: есть строка
 * «живут 2 (Пётр, Анна)» и тихая пометка «сверх вместимости», когда народу
 * больше паспортного.
 *
 * **Заголовок плашки** — «{хозяин} {основная характеристика} {вес}гр.»,
 * например «Анна 3-х местная 2400 гр.» (29.10.2026). «Основная
 * характеристика» — будущее поле всей таблицы снаряжения (`gear.md` §8):
 * у палатки это число мест, и пока его играет вместимость из диалога.
 * Веса нет — нет и «гр.» в заголовке.
 *
 * **Тент — не палатка.** Кнопка «Добавить тент» открывает выбор из личного
 * каталога, но строка в снаряжение похода не пишется: вида «тент» в модели
 * нет, и пилюля живёт только на экране. Под тентом никто не ночует, места
 * в распределении у него нет (заказчик 29.10.2026: «пока просто кнопка» —
 * теперь кнопка хотя бы показывает формат пилюли и крестик).
 *
 * **Крестики — по правам на вещь** (29.10.2026): у владельца палатки или
 * тента крестик убирает его из секции, у организатора — только **предлагает**
 * убрать: подпись зачёркивается, пунктирная рамка, а решает владелец.
 * Повторное нажатие организатора отменяет предложение. Удаление пока
 * в памяти: ручки удаления вещи из похода нет.
 *
 * **Цвет кнопок — ответ на «мне это ещё нужно?»** (29.10.2026): «Добавить
 * свою палатку» цветная, пока смотрящий не распределён, «Добавить тент» —
 * пока тента в секции нет. «Попроситься» наоборот белая: это просьба,
 * а не главное действие.
 *
 * Права: владелец правит свою палатку, организатор — любую. Матрицу ролей
 * фронт не повторяет — здесь она и не нужна, потому что серверного ответа
 * по ночёвкам ещё нет.
 */
const props = defineProps<{ trip: Trip }>()

const auth = useAuthStore()

/** Вместимость, пока её не спросили: «3-х местная» — обычная палатка. */
const DEFAULT_CAPACITY = 3

/** Пределы поля вместимости: одна палатка — до восьми мест. */
const MIN_CAPACITY = 1
const MAX_CAPACITY = 8

type TentPersonStatus = 'accepted' | 'requested'

/** Человек в палатке: живёт или ещё просится. */
interface TentMember {
  userId: string
  displayName: string
  status: TentPersonStatus
}

/**
 * Плашка палатки. `tripGearId` — вещь в снаряжении похода, она же ключ:
 * две плашки одной палатки — это не две палатки, а непонимание.
 */
interface TentCard {
  tripGearId: string
  ownerUserId: string
  ownerName: string
  /** Основная характеристика палатки: сколько мест. */
  capacity: number
  /** Вес вещи из каталога: его показываем в заголовке, если он известен. */
  weightGrams: number | null
  members: TentMember[]
  /** Организатор предложил убрать палатку: заголовок зачёркнут, решает владелец. */
  removalProposed: boolean
}

/**
 * Тент в секции «Палатки» (29.10.2026).
 *
 * В снаряжении похода вида «тент» нет: `gear_items.kind` знает только
 * палатку, а тент — не спальное место, и под ним никто не ночует. Поэтому
 * тент пока **локальная пилюля**: его нельзя предложить серверу, зато видно
 * формат «Тент - 3000 гр. (Олег)» и крестик с теми же правами, что у вещей.
 * Серверная модель появится вместе с описанием снаряжения (`gear.md` §8).
 */
interface AwningPill {
  /** Ключ строки: предмет личного каталога, из которого взяли тент. */
  gearItemId: string
  title: string
  weightGrams: number | null
  ownerUserId: string
  ownerName: string
  removalProposed: boolean
}


const meId = computed(() => auth.user?.id ?? '')

/** Состав похода целиком: имена нужны и для палаток, и для «не распределены». */
const people = ref<TripParticipant[]>([])
const gear = ref<TripGearItem[]>([])

const isLoading = ref(true)
const error = ref<string | null>(null)

const tents = ref<TentCard[]>([])

/**
 * Вместимость по вещи снаряжения. Живёт отдельно от плашки, чтобы правка
 * перезагрузки не теряла число: плашки пересобираются из снаряжения,
 * а характеристика остаётся.
 */
const capacities = new Map<string, number>()

function capacityOf(tripGearId: string): number {
  return capacities.get(tripGearId) ?? DEFAULT_CAPACITY
}

/** Кого распределяем: только «идёт». */
const goingPeople = computed(() => people.value.filter((person) => person.status === 'going'))

function isMine(person: { userId: string }): boolean {
  return meId.value !== '' && person.userId === meId.value
}

function isMyTent(tent: TentCard): boolean {
  return isMine({ userId: tent.ownerUserId })
}

/**
 * Правит ли смотрящий палатку: своя — всегда, чужая — только организатору.
 * Роли вкладки здесь ни при чём: серверного ответа по ночёвкам ещё нет.
 */
function canManage(tent: TentCard): boolean {
  return isMyTent(tent) || (meId.value !== '' && props.trip.organizerUserId === meId.value)
}

function nameOf(userId: string): string {
  return people.value.find((person) => person.userId === userId)?.displayName ?? 'Участник'
}

/**
 * Заголовок плашки — формат заказчика 29.10.2026:
 * **«{хозяин} {основная характеристика} {вес}гр.»** — «Анна 3-х местная
 * 2400 гр.». Веса нет в каталоге — его нет и в заголовке: «Анна 3-х местная».
 *
 * «Основная характеристика» — будущее поле всей таблицы снаряжения
 * (`gear.md` §8). Пока его нет, у палатки эту роль играет вместимость.
 */
function capacityText(capacity: number): string {
  if (capacity === 1) return 'одноместная'
  if (capacity <= 4) return `${capacity}-х местная`

  return `${capacity}-местная`
}

function tentTitle(tent: TentCard): string {
  const base = `${tent.ownerName} ${capacityText(tent.capacity)}`
  const weight = weightInGrams(tent.weightGrams)

  return weight === null ? base : `${base} ${weight}`
}

/** Сколько в палатке живёт и кто — словами, как «занято 4 из 4» у рейса. */
function membersText(tent: TentCard): string {
  const sleeping = acceptedOf(tent)

  if (sleeping.length === 0) return 'никого'

  const names = sleeping.map((person) => person.displayName).join(', ')
  const verb = sleeping.length === 1 ? 'живёт' : 'живут'

  return `${verb} ${sleeping.length} (${names})`
}

function acceptedOf(tent: TentCard): TentMember[] {
  return tent.members.filter((person) => person.status === 'accepted')
}

function requestedOf(tent: TentCard): TentMember[] {
  return tent.members.filter((person) => person.status === 'requested')
}

/** Пометка «народу больше, чем паспортных мест»: не запрет, а информация. */
function isOverCapacity(tent: TentCard): boolean {
  return acceptedOf(tent).length > tent.capacity
}

/** Кого ещё можно позвать в эту палатку: идущих и не занятых в ней. */
function outsiders(tent: TentCard): TripParticipant[] {
  const inside = new Set(tent.members.map((person) => person.userId))

  return goingPeople.value.filter((person) => !inside.has(person.userId))
}

/**
 * Что будет, если смотрящий попросится.
 *
 * Палатка — чужое личное имущество, поэтому место в ней не занимают сами:
 * человек **просится** (`requested`), а решает хозяин — ровно как заявка
 * на чужое ТС в «Трансфере». Уже внутри — `null`, кнопки нет.
 *
 * Организатор не исключение: он может позвать себя селектом «взять
 * в палатку» — это прямое добавление, другое действие с другим правом.
 */
function joinStatus(tent: TentCard): 'requested' | null {
  if (meId.value === '') return null
  if (!goingPeople.value.some((person) => person.userId === meId.value)) return null
  if (tent.members.some((person) => person.userId === meId.value)) return null

  return 'requested'
}

/**
 * Кто ещё нигде не живёт. «Просится» тоже занят: человек уже в этой палатке
 * на экране, и предлагать его второй раз не нужно.
 */
const unassigned = computed(() => {
  const busy = new Set<string>()

  for (const tent of tents.value) {
    for (const person of tent.members) busy.add(person.userId)
  }

  return goingPeople.value.filter((person) => !busy.has(person.userId))
})

/**
 * Есть ли у смотрящего где жить (29.10.2026). «Добавить свою палатку» —
 * цветная, пока человек ни в одной палатке, и белая, когда место уже есть:
 * цвет кнопки и есть ответ на вопрос «мне это ещё нужно?».
 */
const amUnassigned = computed(() =>
  unassigned.value.some((person) => person.userId === meId.value),
)

/** Тенты: локальные пилюли секции, серверной модели ещё нет. */
const awnings = ref<AwningPill[]>([])

/** Как узнаём тент в личном каталоге: вида «тент» в `gear_items` нет. */
const AWNING_TITLE = /тент|tarp|навес|маркиз/i

const hasAwning = computed(() => awnings.value.length > 0)

// ───────────────────────────── загрузка ─────────────────────────────

/**
 * Плашки пересобираются из снаряжения, но живые (уже расставленные люди)
 * переживают перезагрузку: распределение в памяти, и терять его на каждом
 * обновлении списка палаток нельзя.
 */
function syncTents(items: TripGearItem[]): void {
  const inTrip = items.filter((item) => item.kind === 'tent' && item.status !== 'declined')
  const known = new Map(tents.value.map((tent) => [tent.tripGearId, tent]))

  tents.value = inTrip.map((item) => {
    const existing = known.get(item.id)
    if (existing !== undefined) return existing

    const ownerName = nameOf(item.ownerUserId)

    return {
      tripGearId: item.id,
      ownerUserId: item.ownerUserId,
      ownerName,
      capacity: capacityOf(item.id),
      weightGrams: item.weightGrams,
      /**
       * Владелец живёт в своей палатке, пока не сказал иначе: он её и несёт.
       * Если владельца нет среди идущих (уже не идёт), палатка остаётся
       * пустой — расставлять в неё людей будет организатор.
       */
      members: goingPeople.value.some((person) => person.userId === item.ownerUserId)
        ? [{ userId: item.ownerUserId, displayName: ownerName, status: 'accepted' }]
        : [],
      removalProposed: false,
    }
  })
}

async function load(): Promise<void> {
  isLoading.value = true
  error.value = null

  try {
    const [members, list] = await Promise.all([
      listParticipants(props.trip.id),
      listTripGear(props.trip.id),
    ])

    people.value = members
    gear.value = list.items
    syncTents(list.items)
  } catch (problem) {
    error.value =
      problem instanceof ApiError ? problem.message : 'Не удалось загрузить палатки'
  } finally {
    isLoading.value = false
  }
}

watch(() => props.trip.id, load, { immediate: true })

// ───────────────────────────── действия ─────────────────────────────

/**
 * Взять человека в палатку. Селект сбрасывается на пустой пункт — как
 * «взять на борт» в «Трансфере»: действие одно, а не «выбранное состояние».
 */
function addMember(tent: TentCard, event: Event): void {
  const select = event.target as HTMLSelectElement
  const userId = select.value

  select.value = ''

  if (userId === '') return

  const person = goingPeople.value.find((candidate) => candidate.userId === userId)
  if (person === undefined) return

  tent.members = [
    ...tent.members,
    { userId: person.userId, displayName: person.displayName, status: 'accepted' },
  ]
}

/** Выйти из палатки или отменить свою заявку: одно действие «убрать себя». */
function removeMember(tent: TentCard, person: TentMember): void {
  tent.members = tent.members.filter((member) => member.userId !== person.userId)
}

function join(tent: TentCard): void {
  const status = joinStatus(tent)
  if (status === null) return

  const me = goingPeople.value.find((person) => person.userId === meId.value)
  if (me === undefined) return

  tent.members = [
    ...tent.members,
    { userId: me.userId, displayName: me.displayName, status },
  ]
}

/** Владелец принимает заявку: человек переходит из «просятся» в жильцы. */
function acceptRequest(tent: TentCard, person: TentMember): void {
  tent.members = tent.members.map((member) =>
    member.userId === person.userId ? { ...member, status: 'accepted' } : member,
  )
}

// ───────────────────────────── крестик палатки ─────────────────────────────

/**
 * Крестик на плашке (29.10.2026): владелец убирает свою палатку из секции,
 * организатор чужую только **предлагает** убрать — заголовок зачёркивается,
 * а убирает владелец. Действие в памяти: ручки удаления вещи из похода нет,
 * она появится вместе с моделью ночёвок.
 */
function removeTent(tent: TentCard): void {
  if (isMyTent(tent)) {
    tents.value = tents.value.filter((card) => card.tripGearId !== tent.tripGearId)

    return
  }

  tent.removalProposed = !tent.removalProposed
}

function removeTentHint(tent: TentCard): string {
  if (isMyTent(tent)) return 'Убрать палатку из секции'

  return tent.removalProposed
    ? 'Вернуть палатку: предложение убрать отменено'
    : 'Предложить убрать палатку: решает владелец'
}

// ───────────────────────────── тент ─────────────────────────────

const isAwningDialogOpen = ref(false)
const isAwningLoading = ref(false)
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
    const taken = new Set(awnings.value.map((awning) => awning.gearItemId))

    myAwnings.value = list.items.filter(
      (item) => AWNING_TITLE.test(item.title) && !taken.has(item.id),
    )
  } catch (problem) {
    awningError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось загрузить снаряжение'
  } finally {
    isAwningLoading.value = false
  }
}

/**
 * Тент добавляется только на экране: вида «тент» в снаряжении похода нет,
 * и предложить вещь серверу значило бы показать её потом палаткой.
 */
function saveAwning(): void {
  const item = myAwnings.value.find((row) => row.id === draftAwningId.value)

  if (item === undefined) return

  awnings.value = [
    ...awnings.value,
    {
      gearItemId: item.id,
      title: item.title,
      weightGrams: item.weightGrams,
      ownerUserId: meId.value,
      ownerName: auth.user?.displayName ?? 'Участник',
      removalProposed: false,
    },
  ]

  isAwningDialogOpen.value = false
}

/** Строка выбора: «Тент 3×4 · 3000 гр.». */
function awningOptionText(item: GearItem): string {
  const weight = weightInGrams(item.weightGrams)

  return weight === null ? item.title : `${item.title} · ${weight}`
}

/** Пилюля тента в формате заказчика: «Тент - 3000 гр. (Олег)». */
function awningText(awning: AwningPill): string {
  const weight = weightInGrams(awning.weightGrams)
  const head = weight === null ? 'Тент' : `Тент - ${weight}`

  return `${head} (${awning.ownerName})`
}

function canManageAwning(awning: AwningPill): boolean {
  return (
    awning.ownerUserId === meId.value ||
    (meId.value !== '' && props.trip.organizerUserId === meId.value)
  )
}

function removeAwning(awning: AwningPill): void {
  if (awning.ownerUserId === meId.value) {
    awnings.value = awnings.value.filter((row) => row.gearItemId !== awning.gearItemId)

    return
  }

  awning.removalProposed = !awning.removalProposed
}


// ───────────────────────────── своя палатка ─────────────────────────────

const isDialogOpen = ref(false)
const isGearLoading = ref(false)
const isSaving = ref(false)
const dialogError = ref<string | null>(null)

/** Мои палатки, которых ещё нет в снаряжении похода. */
const myTents = ref<GearItem[]>([])
const draftGearItemId = ref('')
const draftCapacity = ref(String(DEFAULT_CAPACITY))

async function openDialog(): Promise<void> {
  isDialogOpen.value = true
  dialogError.value = null
  draftGearItemId.value = ''
  draftCapacity.value = String(DEFAULT_CAPACITY)
  isGearLoading.value = true

  try {
    const list = await listGear()
    const inTrip = new Set(gear.value.map((item) => item.gearItemId))

    myTents.value = list.items.filter(
      (item) => item.kind === 'tent' && !inTrip.has(item.id),
    )
  } catch (problem) {
    dialogError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось загрузить снаряжение'
  } finally {
    isGearLoading.value = false
  }
}

async function saveTent(): Promise<void> {
  if (isSaving.value || draftGearItemId.value === '') return

  const capacity = Number(draftCapacity.value)

  if (!Number.isInteger(capacity) || capacity < MIN_CAPACITY || capacity > MAX_CAPACITY) {
    dialogError.value = `Вместимость — целое число от ${MIN_CAPACITY} до ${MAX_CAPACITY}`
    return
  }

  isSaving.value = true
  dialogError.value = null

  try {
    const item = await proposeTripGear(props.trip.id, draftGearItemId.value)

    capacities.set(item.id, capacity)

    const me = goingPeople.value.find((person) => person.userId === meId.value)

    tents.value = [
      ...tents.value,
      {
        tripGearId: item.id,
        ownerUserId: item.ownerUserId,
        // Имя — из профиля смотрящего: его палатка, и он подписан на плашке.
        ownerName: auth.user?.displayName ?? nameOf(item.ownerUserId),
        capacity,
        weightGrams: item.weightGrams,
        members:
          me === undefined
            ? []
            : [{ userId: me.userId, displayName: me.displayName, status: 'accepted' }],
        removalProposed: false,
      },
    ]

    gear.value = [...gear.value, item]
    isDialogOpen.value = false
  } catch (problem) {
    // Ошибка — в модалке, а не строкой под затемнением (правило «Трансфера»).
    dialogError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось добавить палатку'
  } finally {
    isSaving.value = false
  }
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

    <p v-else-if="error" class="text-sm text-muted" data-test="route-tents-error">
      {{ error }}
    </p>

    <template v-else>
      <p v-if="tents.length === 0" class="text-sm text-muted" data-test="route-tents-empty">
        Пока никто не взял палатку — добавьте свою из личного снаряжения.
      </p>

      <article
        v-for="tent in tents"
        :key="tent.tripGearId"
        class="flex flex-col gap-2 rounded-xl border bg-surface p-3"
        :class="tent.removalProposed ? 'border-dashed border-emerald-400' : 'border-border'"
        data-test="route-tent"
      >
        <header class="flex flex-col gap-0.5">
          <!--
            Заголовок и крестик — одной строкой: крестик убирает палатку
            из секции. У владельца — сразу, у организатора — предложением
            (заголовок зачёркивается), как у костровых вещей.
          -->
          <div class="flex items-start justify-between gap-2">
            <h4
              class="text-base font-medium"
              :class="tent.removalProposed ? 'text-muted line-through' : 'text-text'"
              data-test="route-tent-title"
            >
              {{ tentTitle(tent) }}
            </h4>

            <button
              v-if="canManage(tent)"
              type="button"
              class="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-base text-muted transition-colors hover:text-text"
              :title="removeTentHint(tent)"
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
            Предложение организатора видно словами: зачёркнутый заголовок
            сам по себе можно принять за «палатка ушла», а решает владелец.
          -->
          <span
            v-if="tent.removalProposed"
            class="text-xs text-muted"
            data-test="route-tent-removal"
          >
            организатор предлагает убрать
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
              v-if="(isMine(person) || canManage(tent)) && person.userId !== tent.ownerUserId"
              type="button"
              class="cursor-pointer border-0 bg-transparent p-0 text-amber-700 transition-colors hover:text-amber-900"
              :data-test="`route-tent-leave-${person.userId}`"
              @click="removeMember(tent, person)"
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
                class="cursor-pointer rounded-lg border border-primary bg-primary px-2 py-1 text-xs text-white transition-opacity hover:opacity-90"
                :data-test="`route-tent-accept-${person.userId}`"
                @click="acceptRequest(tent, person)"
              >
                Принять
              </button>
              <button
                type="button"
                class="cursor-pointer rounded-lg border border-border bg-field px-2 py-1 text-xs text-text transition-colors hover:border-primary"
                :data-test="`route-tent-reject-${person.userId}`"
                @click="removeMember(tent, person)"
              >
                Отклонить
              </button>
            </template>

            <!-- Свою заявку человек отменяет сам -->
            <button
              v-else-if="isMine(person)"
              type="button"
              class="cursor-pointer border-0 bg-transparent p-0 text-xs text-muted underline transition-colors hover:text-text"
              :data-test="`route-tent-leave-${person.userId}`"
              @click="removeMember(tent, person)"
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
          -->
          <button
            v-if="joinStatus(tent) !== null"
            type="button"
            class="cursor-pointer rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-text transition-colors hover:border-emerald-600"
            data-test="route-tent-join"
            @click="join(tent)"
          >
            Попроситься
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
            class="w-full rounded-xl border border-border bg-field px-2 py-1 text-base text-text transition-colors focus:border-primary focus:outline-none md:w-auto md:text-sm"
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
        Тенты — локальные пилюли в формате «Тент - 3000 гр. (Олег)»: под
        тентом никто не ночует, поэтому в распределении его нет, но у вещи
        есть хозяин, вес и крестик с теми же правами, что у палаток.
      -->
      <div
        v-if="awnings.length > 0"
        class="flex flex-wrap items-center gap-2"
        data-test="route-awnings"
      >
        <span
          v-for="awning in awnings"
          :key="awning.gearItemId"
          class="flex items-center gap-1 rounded-full border px-2 py-1 text-sm"
          :class="
            awning.removalProposed
              ? 'border-dashed border-emerald-400 bg-transparent text-emerald-800'
              : 'border-emerald-300 bg-emerald-50 text-emerald-900'
          "
          :title="awning.title"
          data-test="route-awning"
        >
          <span :class="awning.removalProposed ? 'line-through' : ''">
            {{ awningText(awning) }}
          </span>

          <button
            v-if="canManageAwning(awning)"
            type="button"
            class="cursor-pointer border-0 bg-transparent p-0 text-emerald-700 transition-colors hover:text-emerald-900"
            :title="
              awning.ownerUserId === meId
                ? 'Убрать тент из секции'
                : 'Предложить убрать тент: решает владелец'
            "
            :data-test="`route-awning-remove-${awning.gearItemId}`"
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
          Вида «тент» в снаряжении похода нет, поэтому пилюля живёт только
          на экране; серверная модель — вместе с описанием снаряжения.
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

      <!-- Одна форма на добавление: палатка из личного каталога + вместимость -->
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
            на вкладке «Снаряжение».
          </p>

          <label class="flex flex-col gap-1 text-sm text-muted">
            Вместимость, мест
            <input
              v-model="draftCapacity"
              type="number"
              :min="MIN_CAPACITY"
              :max="MAX_CAPACITY"
              inputmode="numeric"
              class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none md:text-sm"
              data-test="route-tent-capacity"
            />
          </label>

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

      <!--
        Тент: выбор из личного каталога, но строка в поход не пишется.
        Вида «тент» в снаряжении похода нет — вещь с тем же видом «палатка»
        показалась бы потом палаткой, а не тентом.
      -->
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
            Тента в личном снаряжении нет — заведите вещь со словом «тент»
            в названии, в профиле на вкладке «Снаряжение».
          </p>

          <p v-if="awningError" class="text-sm text-red-600" data-test="route-awning-error">
            {{ awningError }}
          </p>

          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="cursor-pointer rounded-xl border border-primary bg-primary px-3 py-1.5 text-sm text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              :disabled="draftAwningId === ''"
              data-test="route-awning-save"
              @click="saveAwning"
            >
              Добавить
            </button>

            <button
              type="button"
              class="cursor-pointer rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-text transition-colors hover:border-primary"
              data-test="route-awning-cancel"
              @click="isAwningDialogOpen = false"
            >
              Отмена
            </button>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>
