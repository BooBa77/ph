<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { ApiError } from '@/api/errors'
import {
  addTransferPassenger,
  createTransferCar,
  createTransferLeg,
  fetchTripTransfer,
  removeTransferCar,
  removeTransferLeg,
  removeTransferPassenger,
  returnTransferLeg,
  seatTransferPassenger,
  updateTransferCar,
  updateTransferLeg,
} from '@/api/trips'
import { useAuthStore } from '@/stores/auth'
import {
  TRANSFER_CAR_OWNERSHIPS,
  TRANSFER_CAR_OWNERSHIP_LABELS,
  TRANSFER_MODES,
  TRANSFER_MODE_LABELS,
  type TransferCarOwnership,
  type TransferMode,
  type Trip,
  type TripTransfer,
  type TripTransferCar,
  type TripTransferLeg,
  type TripTransferPassenger,
} from '@/types/trips'
import { tripMeetingText } from '@/utils/tripDisplay'
import TripChat from '@/views/trips/TripChat.vue'

/**
 * Вкладка «Трансфер»: строки заброски, машины и пассажиры.
 *
 * **Строка — это заброска, машина — её часть.** У поезда машины нет, но
 * пассажиры и места нужны те же, поэтому строка отвечает на «когда, откуда,
 * куда, на чём», а машины живут внутри строки. Из этого следует и
 * «вернуться так же»: копия строки с обратными точками, а не общая машина
 * на весь поход.
 *
 * **Пассажиры — это состав строки, а не машины.** Человек сначала «едет
 * этой строкой», потом получает место; `carId: null` — «едет, но места
 * нет», и на экране это подписано «без машины», потому что это работа для
 * людей, а не ошибка.
 *
 * **Права считает бэкенд**, и здесь они только читаются:
 * `plan.canEdit` — можно править строки и заводить наёмные машины,
 * `car.canEdit` — можно править эту машину (свою водитель правит сам),
 * «снять себя» доступно всегда — это и есть «пассажир может отказаться».
 *
 * **Любая правка возвращает вкладку целиком**, поэтому состояние на экране
 * не собирается по кусочкам: места в машине и «без машины» — числа от двух
 * таблиц, и частичный ответ однажды разошёлся бы с ними.
 *
 * Чат трансфера — часть вкладки, как у «Питания»: чат — тема вкладки.
 */
const props = defineProps<{ trip: Trip }>()

const auth = useAuthStore()

const plan = ref<TripTransfer | null>(null)
const isLoading = ref(true)
const isSaving = ref(false)
const error = ref<string | null>(null)
const actionError = ref<string | null>(null)

const meId = computed(() => auth.user?.id ?? '')
const legs = computed(() => plan.value?.legs ?? [])
const travelers = computed(() => plan.value?.travelers ?? [])
const canEdit = computed(() => plan.value?.canEdit ?? false)

/**
 * Место сбора живёт в походе (`trips.meeting_place`), а не в строке:
 * у него нет ни даты, ни вида, ни машины. Показываем отдельной строкой
 * сверху, правит его организатор в форме похода — поэтому здесь только
 * показ и подсказка.
 */
const meetingText = computed(
  () => plan.value?.meetingPlace ?? tripMeetingText(props.trip),
)

async function load() {
  isLoading.value = true
  error.value = null

  try {
    plan.value = await fetchTripTransfer(props.trip.id)
  } catch (problem) {
    error.value =
      problem instanceof ApiError ? problem.message : 'Не удалось загрузить трансфер'
    plan.value = null
  } finally {
    isLoading.value = false
  }
}

watch(() => props.trip.id, load, { immediate: true })

/**
 * Одна обёртка на все действия: сервер отвечает вкладкой целиком, поэтому
 * после любого действия достаточно заменить состояние его ответом.
 */
async function run(action: () => Promise<TripTransfer>): Promise<boolean> {
  if (isSaving.value) return false

  isSaving.value = true
  actionError.value = null

  try {
    plan.value = await action()
    return true
  } catch (problem) {
    actionError.value =
      problem instanceof ApiError
        ? problem.message
        : 'Не получилось — попробуйте ещё раз'
    return false
  } finally {
    isSaving.value = false
  }
}

// ───────────────────────────── места и люди ─────────────────────────────

function carPassengers(
  leg: TripTransferLeg,
  car: TripTransferCar,
): TripTransferPassenger[] {
  return leg.passengers.filter((passenger) => passenger.carId === car.id)
}

/** Места не указаны (`null`) — не потолок: «пятиместная» уточнят позже. */
function hasFreeSeat(car: TripTransferCar): boolean {
  return car.seats === null || car.occupied < car.seats
}

function seatsText(car: TripTransferCar): string {
  return car.seats === null ? 'места не указаны' : `${car.occupied} из ${car.seats}`
}

function unassigned(leg: TripTransferLeg): TripTransferPassenger[] {
  return leg.passengers.filter((passenger) => passenger.carId === null)
}

/** Кого ещё нет в строке — их и предлагаем добавить. */
function outsiders(leg: TripTransferLeg) {
  return travelers.value.filter(
    (traveler) => !leg.passengers.some((passenger) => passenger.userId === traveler.userId),
  )
}

/** Под машинами показываем «без машины», у остальных строк — весь состав. */
function rowPeople(leg: TripTransferLeg): TripTransferPassenger[] {
  return leg.mode === 'car' ? unassigned(leg) : leg.passengers
}

function carLabel(leg: TripTransferLeg, carId: string): string {
  const car = leg.cars.find((item) => item.id === carId)
  return car ? car.driverName : 'машина'
}

/**
 * Право управлять людьми строки: право на вкладку или машина в этой строке
 * (водитель выбирает пассажиров). Себя человек сажает и снимает сам —
 * отдельной кнопкой «я еду этой строкой» на телефоне.
 */
function canManagePeople(leg: TripTransferLeg): boolean {
  return canEdit.value || leg.cars.some((car) => car.canEdit)
}

function canRemovePassenger(
  leg: TripTransferLeg,
  passenger: TripTransferPassenger,
): boolean {
  return canManagePeople(leg) || passenger.userId === meId.value
}

/**
 * Снять себя из машины человек вправе всегда, даже если его посадил
 * водитель: это и есть «пассажир может отказаться». Посадить себя сам
 * он не может — место в машине даёт водитель.
 */
function canUnseat(car: TripTransferCar, passenger: TripTransferPassenger): boolean {
  return car.canEdit || passenger.userId === meId.value
}

function isInLeg(leg: TripTransferLeg): boolean {
  return leg.passengers.some((passenger) => passenger.userId === meId.value)
}

function departureText(iso: string | null): string {
  if (!iso) return 'время уточняется'

  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const canAddMyCar = computed(
  () => travelers.value.some((traveler) => traveler.userId === meId.value),
)

// ───────────────────────────── действия ─────────────────────────────

const seatFromRow = (leg: TripTransferLeg, passenger: TripTransferPassenger, event: Event) => {
  const select = event.target as HTMLSelectElement
  const carId = select.value === '' ? null : select.value
  select.value = ''

  if (carId !== null) {
    void run(() => seatTransferPassenger(props.trip.id, leg.id, passenger.userId, carId))
  }
}

const seatFromCar = (leg: TripTransferLeg, car: TripTransferCar, event: Event) => {
  const select = event.target as HTMLSelectElement
  const userId = select.value
  select.value = ''

  if (userId !== '') {
    void run(() => seatTransferPassenger(props.trip.id, leg.id, userId, car.id))
  }
}

const addFromSelect = (leg: TripTransferLeg, event: Event) => {
  const select = event.target as HTMLSelectElement
  const userId = select.value
  select.value = ''

  if (userId !== '') {
    void run(() => addTransferPassenger(props.trip.id, leg.id, userId))
  }
}

const addMe = (leg: TripTransferLeg) =>
  void run(() => addTransferPassenger(props.trip.id, leg.id, meId.value))

const unseat = (leg: TripTransferLeg, passenger: TripTransferPassenger) =>
  void run(() => seatTransferPassenger(props.trip.id, leg.id, passenger.userId, null))

const removePassenger = (leg: TripTransferLeg, passenger: TripTransferPassenger) =>
  void run(() => removeTransferPassenger(props.trip.id, leg.id, passenger.userId))

const removeCar = (leg: TripTransferLeg, car: TripTransferCar) =>
  void run(() => removeTransferCar(props.trip.id, car.id))

const removeLeg = (leg: TripTransferLeg) =>
  void run(() => removeTransferLeg(props.trip.id, leg.id))

const returnSameWay = (leg: TripTransferLeg) =>
  void run(() => returnTransferLeg(props.trip.id, leg.id))

// ───────────────────────────── строка: диалог ─────────────────────────────

interface LegDraft {
  id: string | null
  mode: TransferMode
  fromPlace: string
  toPlace: string
  departsAt: string
  note: string
}

const legDraft = ref<LegDraft | null>(null)
const legError = ref<string | null>(null)

/** `datetime-local` ждёт местное «YYYY-MM-DDTHH:mm», а храним мы ISO. */
function toLocalInput(iso: string | null): string {
  if (!iso) return ''

  const date = new Date(iso)
  const pad = (value: number) => String(value).padStart(2, '0')

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null
}

function openLegDialog(leg: TripTransferLeg | null) {
  legError.value = null
  legDraft.value = leg
    ? {
        id: leg.id,
        mode: leg.mode,
        fromPlace: leg.fromPlace,
        toPlace: leg.toPlace,
        departsAt: toLocalInput(leg.departsAt),
        note: leg.note ?? '',
      }
    : { id: null, mode: 'car', fromPlace: '', toPlace: '', departsAt: '', note: '' }
}

async function saveLeg() {
  const draft = legDraft.value
  if (!draft) return

  const fromPlace = draft.fromPlace.trim()
  const toPlace = draft.toPlace.trim()

  if (!fromPlace || !toPlace) {
    legError.value = 'Нужны обе точки: откуда и куда'
    return
  }

  const input = {
    mode: draft.mode,
    fromPlace,
    toPlace,
    departsAt: fromLocalInput(draft.departsAt),
    note: draft.note.trim() || null,
  }

  const ok =
    draft.id === null
      ? await run(() => createTransferLeg(props.trip.id, input))
      : await run(() => updateTransferLeg(props.trip.id, draft.id as string, input))

  if (ok) legDraft.value = null
}

// ───────────────────────────── машина: диалог ─────────────────────────────

interface CarDraft {
  /** `null` — новая машина; иначе правим существующую. */
  carId: string | null
  legId: string
  ownership: TransferCarOwnership
  driverUserId: string
  driverName: string
  driverPhone: string
  /**
   * Мест может быть числом или пустой строкой: `<input type="number">`
   * с `v-model` отдаёт число, а очищенное поле — строку.
   */
  seats: string | number
}

const carDraft = ref<CarDraft | null>(null)
const carError = ref<string | null>(null)

/** Наёмную машину заводит только тот, кому роль дала вкладку. */
const ownershipOptions = computed<TransferCarOwnership[]>(() =>
  canEdit.value ? [...TRANSFER_CAR_OWNERSHIPS] : ['own'],
)

/** Свою машину участник заводит сам — водитель здесь он и только он. */
const driverOptions = computed(() =>
  canEdit.value ? travelers.value : travelers.value.filter((person) => person.userId === meId.value),
)

function openCarDialog(leg: TripTransferLeg, car: TripTransferCar | null = null) {
  carError.value = null
  carDraft.value = {
    carId: car?.id ?? null,
    legId: leg.id,
    ownership: car?.ownership ?? 'own',
    driverUserId: car?.driverUserId ?? meId.value,
    driverName: car?.ownership === 'hired' ? car.driverName : '',
    driverPhone: car?.driverPhone ?? '',
    seats: car?.seats ?? '',
  }
}

async function saveCar() {
  const draft = carDraft.value
  if (!draft) return

  const rawSeats = String(draft.seats).trim()
  const seats = rawSeats === '' ? null : Number(rawSeats)

  if (seats !== null && (!Number.isInteger(seats) || seats < 1)) {
    carError.value = 'Мест — целое число, и хотя бы одно'
    return
  }

  let driverUserId: string | null = null
  let driverName: string | null = null

  if (draft.ownership === 'own') {
    const driver = driverOptions.value.find((person) => person.userId === draft.driverUserId)
    if (!driver) {
      carError.value = 'Выберите водителя из участников'
      return
    }
    driverUserId = driver.userId
  } else {
    driverName = draft.driverName.trim()
    if (!driverName) {
      carError.value = 'У наёмной машины нужно имя водителя'
      return
    }
  }

  /**
   * `ownership` при правке не отправляем: «своя стала наёмной» — это не
   * правка поля, а другая машина с другим водителем.
   */
  const ok =
    draft.carId === null
      ? await run(() =>
          createTransferCar(props.trip.id, draft.legId, {
            ownership: draft.ownership,
            driverUserId,
            driverName,
            driverPhone: draft.driverPhone.trim() || null,
            seats,
          }),
        )
      : await run(() =>
          updateTransferCar(props.trip.id, draft.carId as string, {
            driverUserId: draft.ownership === 'own' ? driverUserId : undefined,
            driverName: draft.ownership === 'hired' ? driverName : undefined,
            driverPhone: draft.driverPhone.trim() || null,
            seats,
          }),
        )

  if (ok) carDraft.value = null
}
</script>

<template>
  <section class="flex flex-col gap-4" data-test="trip-transfer">
    <p v-if="isLoading" class="text-muted" data-test="transfer-loading">Загружаем трансфер…</p>

    <p v-else-if="error" class="text-muted" data-test="transfer-error">{{ error }}</p>

    <template v-else>
      <p v-if="actionError" class="text-sm text-red-600" data-test="transfer-action-error">
        {{ actionError }}
      </p>

      <!-- Место сбора: строка похода, отдельно от строк заброски -->
      <div
        class="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-xl border border-border bg-surface p-3"
        data-test="transfer-meeting"
      >
        <span class="text-sm text-muted">Место сбора</span>
        <span class="text-base text-text" data-test="transfer-meeting-text">
          {{ meetingText || 'не указано' }}
        </span>
        <span v-if="!meetingText && canEdit" class="text-xs text-muted">
          — заполняется в форме похода
        </span>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-sm text-muted">Заброска · идут {{ travelers.length }}</h2>

        <button
          v-if="canEdit"
          type="button"
          class="cursor-pointer rounded-xl border border-primary bg-primary px-3 py-2 text-sm text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          :disabled="isSaving"
          data-test="transfer-add-leg"
          @click="openLegDialog(null)"
        >
          Строка заброски
        </button>
      </div>

      <p v-if="legs.length === 0" class="text-sm text-muted" data-test="transfer-empty">
        Строк пока нет. Первая — «туда»: откуда, куда, на чём и во сколько.
      </p>

      <article
        v-for="leg in legs"
        :key="leg.id"
        class="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4"
        data-test="transfer-leg"
      >
        <header class="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div class="flex min-w-0 flex-col gap-0.5">
            <span class="text-base font-medium text-text" data-test="transfer-leg-mode">
              {{ TRANSFER_MODE_LABELS[leg.mode] }} · {{ departureText(leg.departsAt) }}
            </span>
            <span class="text-sm text-text" data-test="transfer-leg-places">
              {{ leg.fromPlace }} → {{ leg.toPlace }}
            </span>
            <span v-if="leg.note" class="text-xs text-muted">{{ leg.note }}</span>
          </div>

          <div v-if="canEdit" class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="cursor-pointer rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-text transition-colors hover:border-primary disabled:opacity-60"
              :disabled="isSaving"
              data-test="transfer-return"
              @click="returnSameWay(leg)"
            >
              Вернуться так же
            </button>
            <button
              type="button"
              class="cursor-pointer rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-text transition-colors hover:border-primary disabled:opacity-60"
              :disabled="isSaving"
              data-test="transfer-edit-leg"
              @click="openLegDialog(leg)"
            >
              Править
            </button>
            <button
              type="button"
              class="cursor-pointer rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-muted transition-colors hover:border-primary hover:text-text disabled:opacity-60"
              :disabled="isSaving"
              data-test="transfer-remove-leg"
              @click="removeLeg(leg)"
            >
              Убрать
            </button>
          </div>
        </header>

        <!-- Машины: только у авто. У поезда и автобуса мест не распределишь -->
        <div v-if="leg.mode === 'car'" class="flex flex-col gap-2">
          <div
            v-for="car in leg.cars"
            :key="car.id"
            class="flex flex-col gap-2 rounded-xl border border-border bg-field p-3"
            data-test="transfer-car"
          >
            <div class="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
              <span class="text-sm text-text" data-test="transfer-car-driver">
                <span class="font-medium">{{ TRANSFER_CAR_OWNERSHIP_LABELS[car.ownership] }}</span>
                · {{ car.driverName }}
                <template v-if="car.driverPhone"> · {{ car.driverPhone }}</template>
              </span>
              <span class="text-xs text-muted" data-test="transfer-car-seats">
                {{ seatsText(car) }}
              </span>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <span
                v-for="passenger in carPassengers(leg, car)"
                :key="passenger.userId"
                class="flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-1 text-sm text-text"
              >
                {{ passenger.displayName }}
                <button
                  v-if="canUnseat(car, passenger)"
                  type="button"
                  class="cursor-pointer border-0 bg-transparent p-0 text-muted transition-colors hover:text-text disabled:opacity-60"
                  :disabled="isSaving"
                  :data-test="`transfer-unseat-${passenger.userId}`"
                  @click="unseat(leg, passenger)"
                >
                  ×
                </button>
              </span>

              <span v-if="carPassengers(leg, car).length === 0" class="text-sm text-muted">
                пока никого
              </span>

              <select
                v-if="car.canEdit && unassigned(leg).length > 0 && hasFreeSeat(car)"
                class="w-full rounded-xl border border-border bg-surface px-2 py-1 text-base text-text transition-colors focus:border-primary focus:outline-none md:w-auto md:text-sm"
                :data-test="`transfer-seat-in-${car.id}`"
                @change="seatFromCar(leg, car, $event)"
              >
                <option value="">посадить…</option>
                <option v-for="person in unassigned(leg)" :key="person.userId" :value="person.userId">
                  {{ person.displayName }}
                </option>
              </select>

              <span
                v-else-if="car.canEdit && unassigned(leg).length > 0"
                class="text-xs text-muted"
                data-test="transfer-car-full"
              >
                мест нет
              </span>
            </div>

            <div v-if="car.canEdit" class="flex flex-wrap gap-2">
              <button
                type="button"
                class="cursor-pointer rounded-xl border border-border bg-surface px-3 py-1.5 text-sm text-text transition-colors hover:border-primary disabled:opacity-60"
                :disabled="isSaving"
                :data-test="`transfer-edit-car-${car.id}`"
                @click="openCarDialog(leg, car)"
              >
                Править
              </button>
              <button
                type="button"
                class="cursor-pointer rounded-xl border border-border bg-surface px-3 py-1.5 text-sm text-muted transition-colors hover:border-primary hover:text-text disabled:opacity-60"
                :disabled="isSaving"
                :data-test="`transfer-remove-car-${car.id}`"
                @click="removeCar(leg, car)"
              >
                Убрать машину
              </button>
            </div>
          </div>

          <button
            v-if="canEdit || canAddMyCar"
            type="button"
            class="cursor-pointer self-start rounded-xl border border-border bg-field px-3 py-2 text-sm text-text transition-colors hover:border-primary disabled:opacity-60"
            :disabled="isSaving"
            data-test="transfer-add-car"
            @click="openCarDialog(leg)"
          >
            Машина
          </button>
        </div>

        <!-- Состав строки: у авто — кто остался без машины, у остальных — все -->
        <div class="flex flex-col gap-2">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-xs text-muted">
              {{ leg.mode === 'car' ? 'Без машины' : 'Кто едет' }}
            </span>

            <span
              v-for="passenger in rowPeople(leg)"
              :key="passenger.userId"
              class="flex items-center gap-1 rounded-full border border-border bg-field px-2 py-1 text-sm text-text"
              data-test="transfer-passenger"
            >
              {{ passenger.displayName }}
              <span v-if="passenger.carId !== null" class="text-xs text-muted">
                · {{ carLabel(leg, passenger.carId) }}
              </span>

              <!-- Нераспределённого сажают в машину: водитель или ведущий -->
              <select
                v-if="leg.mode === 'car' && passenger.carId === null && canManagePeople(leg) && leg.cars.length > 0"
                class="rounded-lg border border-border bg-surface px-1 py-0.5 text-base text-text md:text-xs"
                :data-test="`transfer-choose-car-${passenger.userId}`"
                @change="seatFromRow(leg, passenger, $event)"
              >
                <option value="">в машину</option>
                <option
                  v-for="car in leg.cars"
                  :key="car.id"
                  :value="car.id"
                  :disabled="!hasFreeSeat(car)"
                >
                  {{ car.driverName }}
                </option>
              </select>

              <button
                v-if="canRemovePassenger(leg, passenger)"
                type="button"
                class="cursor-pointer border-0 bg-transparent p-0 text-muted transition-colors hover:text-text disabled:opacity-60"
                :disabled="isSaving"
                :data-test="`transfer-drop-${passenger.userId}`"
                @click="removePassenger(leg, passenger)"
              >
                ×
              </button>
            </span>

            <span v-if="rowPeople(leg).length === 0" class="text-sm text-muted" data-test="transfer-no-people">
              {{ leg.mode === 'car' ? 'все по машинам' : 'пока никто' }}
            </span>

            <!-- Себя человек ставит в строку сам: «я еду этой заброской» -->
            <button
              v-if="!isInLeg(leg)"
              type="button"
              class="cursor-pointer rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-text transition-colors hover:border-primary disabled:opacity-60"
              :disabled="isSaving"
              data-test="transfer-add-me"
              @click="addMe(leg)"
            >
              Я еду этой строкой
            </button>

            <select
              v-if="canManagePeople(leg) && outsiders(leg).length > 0"
              class="w-full rounded-xl border border-border bg-field px-2 py-1 text-base text-text transition-colors focus:border-primary focus:outline-none md:w-auto md:text-sm"
              data-test="transfer-add-passenger"
              @change="addFromSelect(leg, $event)"
            >
              <option value="">добавить участника…</option>
              <option v-for="person in outsiders(leg)" :key="person.userId" :value="person.userId">
                {{ person.displayName }}
              </option>
            </select>
          </div>
        </div>
      </article>

      <!-- Строка: создать или поправить. Одна форма на оба случая -->
      <div
        v-if="legDraft"
        class="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4"
        data-test="transfer-leg-dialog"
      >
        <div class="flex w-full max-w-md flex-col gap-2 rounded-xl border border-border bg-surface p-4">
          <h3 class="text-base font-medium text-text">
            {{ legDraft.id === null ? 'Новая строка заброски' : 'Строка заброски' }}
          </h3>

          <label class="flex flex-col gap-1 text-sm text-muted">
            Вид
            <select
              v-model="legDraft.mode"
              class="rounded-xl border border-border bg-field px-3 py-2 text-base text-text focus:border-primary focus:outline-none"
              data-test="transfer-leg-mode-input"
            >
              <option v-for="mode in TRANSFER_MODES" :key="mode" :value="mode">
                {{ TRANSFER_MODE_LABELS[mode] }}
              </option>
            </select>
          </label>

          <label class="flex flex-col gap-1 text-sm text-muted">
            Откуда
            <input
              v-model="legDraft.fromPlace"
              type="text"
              maxlength="200"
              class="rounded-xl border border-border bg-field px-3 py-2 text-base text-text focus:border-primary focus:outline-none"
              data-test="transfer-from-input"
            />
          </label>

          <label class="flex flex-col gap-1 text-sm text-muted">
            Куда
            <input
              v-model="legDraft.toPlace"
              type="text"
              maxlength="200"
              class="rounded-xl border border-border bg-field px-3 py-2 text-base text-text focus:border-primary focus:outline-none"
              data-test="transfer-to-input"
            />
          </label>

          <label class="flex flex-col gap-1 text-sm text-muted">
            Выезд — можно не заполнять
            <input
              v-model="legDraft.departsAt"
              type="datetime-local"
              class="rounded-xl border border-border bg-field px-3 py-2 text-base text-text focus:border-primary focus:outline-none"
              data-test="transfer-departure-input"
            />
          </label>

          <label class="flex flex-col gap-1 text-sm text-muted">
            Заметка
            <input
              v-model="legDraft.note"
              type="text"
              maxlength="500"
              class="rounded-xl border border-border bg-field px-3 py-2 text-base text-text focus:border-primary focus:outline-none"
              data-test="transfer-note-input"
            />
          </label>

          <p v-if="legError" class="text-sm text-red-600" data-test="transfer-leg-error">{{ legError }}</p>

          <div class="mt-2 flex justify-end gap-2">
            <button
              type="button"
              class="cursor-pointer rounded-xl border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:text-text"
              data-test="transfer-leg-cancel"
              @click="legDraft = null"
            >
              Отмена
            </button>
            <button
              type="button"
              class="cursor-pointer rounded-xl border border-primary bg-primary px-3 py-1.5 text-sm text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              :disabled="isSaving"
              data-test="transfer-leg-save"
              @click="saveLeg"
            >
              Сохранить
            </button>
          </div>
        </div>
      </div>

      <!-- Машина: своя — водитель из состава, наёмная — имя и телефон -->
      <div
        v-if="carDraft"
        class="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4"
        data-test="transfer-car-dialog"
      >
        <div class="flex w-full max-w-md flex-col gap-2 rounded-xl border border-border bg-surface p-4">
          <h3 class="text-base font-medium text-text">
            {{ carDraft.carId === null ? 'Машина' : 'Машина в строке' }}
          </h3>

          <label v-if="carDraft.carId === null" class="flex flex-col gap-1 text-sm text-muted">
            Чья
            <select
              v-model="carDraft.ownership"
              class="rounded-xl border border-border bg-field px-3 py-2 text-base text-text focus:border-primary focus:outline-none"
              data-test="transfer-ownership-input"
            >
              <option v-for="value in ownershipOptions" :key="value" :value="value">
                {{ TRANSFER_CAR_OWNERSHIP_LABELS[value] }}
              </option>
            </select>
          </label>

          <!-- Своя не становится наёмной: это другая машина с другим водителем -->
          <p v-else class="text-sm text-muted" data-test="transfer-ownership-fixed">
            {{ TRANSFER_CAR_OWNERSHIP_LABELS[carDraft.ownership] }} — вид машины не меняется
          </p>

          <label v-if="carDraft.ownership === 'own'" class="flex flex-col gap-1 text-sm text-muted">
            Водитель
            <select
              v-model="carDraft.driverUserId"
              class="rounded-xl border border-border bg-field px-3 py-2 text-base text-text focus:border-primary focus:outline-none"
              data-test="transfer-driver-input"
            >
              <option v-for="person in driverOptions" :key="person.userId" :value="person.userId">
                {{ person.displayName }}
              </option>
            </select>
          </label>

          <template v-else>
            <label class="flex flex-col gap-1 text-sm text-muted">
              Как зовут водителя
              <input
                v-model="carDraft.driverName"
                type="text"
                maxlength="100"
                class="rounded-xl border border-border bg-field px-3 py-2 text-base text-text focus:border-primary focus:outline-none"
                data-test="transfer-driver-name-input"
              />
            </label>

            <label class="flex flex-col gap-1 text-sm text-muted">
              Телефон — чтобы найти друг друга в день выезда
              <input
                v-model="carDraft.driverPhone"
                type="tel"
                maxlength="40"
                class="rounded-xl border border-border bg-field px-3 py-2 text-base text-text focus:border-primary focus:outline-none"
                data-test="transfer-driver-phone-input"
              />
            </label>
          </template>

          <label class="flex flex-col gap-1 text-sm text-muted">
            Всего мест, включая водителя — можно не заполнять
            <input
              v-model="carDraft.seats"
              type="number"
              min="1"
              max="60"
              class="rounded-xl border border-border bg-field px-3 py-2 text-base text-text focus:border-primary focus:outline-none"
              data-test="transfer-seats-input"
            />
          </label>

          <p v-if="carError" class="text-sm text-red-600" data-test="transfer-car-error">{{ carError }}</p>

          <div class="mt-2 flex justify-end gap-2">
            <button
              type="button"
              class="cursor-pointer rounded-xl border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:text-text"
              data-test="transfer-car-cancel"
              @click="carDraft = null"
            >
              Отмена
            </button>
            <button
              type="button"
              class="cursor-pointer rounded-xl border border-primary bg-primary px-3 py-1.5 text-sm text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              :disabled="isSaving"
              data-test="transfer-car-save"
              @click="saveCar"
            >
              Сохранить
            </button>
          </div>
        </div>
      </div>

      <!-- Чат трансфера — часть вкладки, как у «Питания» -->
      <TripChat :trip-id="trip.id" kind="trip_transfer" />
    </template>
  </section>
</template>
