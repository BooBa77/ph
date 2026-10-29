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
 * **Тент — не палатка.** Кнопка «Добавить тент» стоит рядом с «Добавить свою
 * палатку», но пока ничего не делает: под тентом никто не ночует, места
 * в распределении у него нет (заказчик 29.10.2026: «пока просто кнопка»).
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
        class="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3"
        data-test="route-tent"
      >
        <header class="flex flex-col gap-0.5">
          <h4 class="text-base font-medium text-text" data-test="route-tent-title">
            {{ tentTitle(tent) }}
          </h4>

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
          <button
            v-if="joinStatus(tent) !== null"
            type="button"
            class="cursor-pointer rounded-xl border border-primary bg-primary px-3 py-1.5 text-sm text-white transition-opacity hover:opacity-90"
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

      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="cursor-pointer rounded-xl bg-emerald-600 px-3 py-2 text-sm text-white transition-opacity hover:opacity-90"
          data-test="route-tent-add"
          @click="openDialog"
        >
          Добавить свою палатку
        </button>

        <!--
          Тент — не палатка и не спальное место: под ним никто не ночует,
          поэтому в распределении его нет. Заказчик 29.10.2026: «пока просто
          кнопка», наполнение — вместе с описанием снаряжения в БД.
        -->
        <button
          type="button"
          class="cursor-pointer rounded-xl border border-border bg-field px-3 py-2 text-sm text-text transition-colors hover:border-emerald-600"
          data-test="route-tent-awning"
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
    </template>
  </section>
</template>
