<script setup lang="ts">
import { computed, ref } from 'vue'

import { useAuthStore } from '@/stores/auth'
import {
  TRANSFER_CAR_OWNERSHIPS,
  TRANSFER_CAR_OWNERSHIP_LABELS,
  TRANSFER_MODES,
  TRANSFER_MODE_LABELS,
  type TransferCarOwnership,
  type TransferMode,
  type Trip,
  type TripTransferCar,
  type TripTransferLeg,
  type TripTransferPassenger,
  type TripTransferPerson,
} from '@/types/trips'
import { tripMeetingText } from '@/utils/tripDisplay'
import { makeTransferDemo } from '@/views/trips/tripTransferDemo'

/**
 * Вкладка «Трансфер» — **пока макет на заглушках**.
 *
 * Модель согласована (сессия 27.10.2026), API ещё нет: данные примерные
 * (`tripTransferDemo.ts`), правки живут в памяти страницы. Экран собирается
 * первым именно для того, чтобы согласовать вид до миграций — экран дороже
 * переделывается, чем таблица.
 *
 * **Строка — это заброска, машина — её часть.** У поезда машины нет, но
 * пассажиры и места нужны те же, поэтому строка отвечает на «когда, откуда,
 * куда, на чём», а машины живут внутри строки. Из этого же следует
 * «Вернуться так же»: копия строки с обратными точками, а не общая машина
 * на весь поход.
 *
 * **Пассажиры — это состав строки, а не машины.** Человек сначала «едет
 * этой строкой», потом получает машину; `carId: null` — «едет, но места
 * нет», и на экране это подписано «без машины», потому что это работа для
 * людей, а не ошибка.
 *
 * **Права:** правку вкладки даёт бэкенд (`canEdit` — организатор, роль
 * водителя, соорганизатор), а свою машину водитель правит сам. Снять себя
 * со строки человек может всегда — это и есть «пассажир может отказаться».
 *
 * **Чата здесь нет** намеренно: чат-тема вкладки — это новый вид чата
 * (`trip_transfer`), и он появится вместе с API, а не с макетом.
 */
const props = withDefaults(
  defineProps<{
    trip: Trip
    /** Право на правку вкладки: считает бэкенд и отдаёт в `tabs`. */
    canEdit?: boolean
  }>(),
  { canEdit: false },
)

const auth = useAuthStore()

/**
 * Я в примере — чтобы «своя машина» и «снять себя» вели себя как в жизни:
 * без этого пришлось бы показывать права, которых не видно в действии.
 */
const me = computed<TripTransferPerson>(() => ({
  userId: auth.user?.id ?? 'demo-self',
  displayName: auth.user?.displayName ?? 'Вы',
}))

const demo = makeTransferDemo(me.value)
const travelers = ref<TripTransferPerson[]>(demo.travelers)
const legs = ref<TripTransferLeg[]>(demo.legs)

/** Место сбора живёт в походе, а не в строке: здесь только показ. */
const meetingText = computed(() => tripMeetingText(props.trip))

/** Идентификаторы макета: с API их выдаст база, сейчас — счётчик. */
let lastLegId = 100
let lastCarId = 100

const isOrganizer = computed(() => props.trip.organizerUserId === auth.user?.id)

// ───────────────────────────── места и люди ─────────────────────────────

function carPassengers(leg: TripTransferLeg, car: TripTransferCar): TripTransferPassenger[] {
  return leg.passengers.filter((passenger) => passenger.carId === car.id)
}

/**
 * Занятые места.
 *
 * У своей машины водитель — пассажир этой же машины, поэтому он уже в списке.
 * У наёмной водителя в составе нет, но **место он занимает** — иначе машина
 * «на четверых» повезут пятерых.
 */
function occupied(car: TripTransferCar, leg: TripTransferLeg): number {
  return carPassengers(leg, car).length + (car.driverUserId === null ? 1 : 0)
}

/** Места не указаны (`null`) — не потолок: «пятиместная» уточнят позже. */
function hasFreeSeat(car: TripTransferCar, leg: TripTransferLeg): boolean {
  return car.seats === null || occupied(car, leg) < car.seats
}

function seatsText(car: TripTransferCar, leg: TripTransferLeg): string {
  return car.seats === null ? 'места не указаны' : `${occupied(car, leg)} из ${car.seats}`
}

function canEditCar(car: TripTransferCar): boolean {
  return props.canEdit || car.canEdit
}

/** Снять себя со строки человек вправе всегда: это и есть «отказаться». */
function canRemovePassenger(passenger: TripTransferPassenger): boolean {
  return props.canEdit || passenger.userId === me.value.userId
}

function unassigned(leg: TripTransferLeg): TripTransferPassenger[] {
  return leg.passengers.filter((passenger) => passenger.carId === null)
}

/** Кого ещё нет в строке — их и предлагаем добавить. */
function outsiders(leg: TripTransferLeg): TripTransferPerson[] {
  return travelers.value.filter(
    (traveler) => !leg.passengers.some((passenger) => passenger.userId === traveler.userId),
  )
}

/** Под машинами показываем «без машины», у остальных строк — весь состав. */
function rowPeople(leg: TripTransferLeg): TripTransferPassenger[] {
  return leg.mode === 'car' ? unassigned(leg) : leg.passengers
}

function carLabel(leg: TripTransferLeg, carId: number): string {
  const car = leg.cars.find((item) => item.id === carId)
  return car ? car.driverName : 'машина'
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

// ───────────────────────────── действия ─────────────────────────────

function seat(leg: TripTransferLeg, passenger: TripTransferPassenger, car: TripTransferCar) {
  if (!hasFreeSeat(car, leg)) return
  passenger.carId = car.id
}

function unseat(passenger: TripTransferPassenger) {
  passenger.carId = null
}

/**
 * Выбор в `select` — обработчиком, а не `v-model`: варианты приходят из
 * данных (люди и машины), и после посадки список обязан пересобраться.
 * Обратно в пустое значение селект возвращаем руками — иначе он показывает
 * уже сработавший пункт как выбранный.
 */
function seatFromRow(leg: TripTransferLeg, passenger: TripTransferPassenger, event: Event) {
  const select = event.target as HTMLSelectElement
  const car = leg.cars.find((item) => item.id === Number(select.value))
  if (car) seat(leg, passenger, car)
  select.value = ''
}

function seatFromCar(leg: TripTransferLeg, car: TripTransferCar, event: Event) {
  const select = event.target as HTMLSelectElement
  const passenger = leg.passengers.find((item) => item.userId === select.value)
  if (passenger) seat(leg, passenger, car)
  select.value = ''
}

function addFromSelect(leg: TripTransferLeg, event: Event) {
  const select = event.target as HTMLSelectElement
  addTraveler(leg, select.value)
  select.value = ''
}

function addTraveler(leg: TripTransferLeg, userId: string) {
  const traveler = travelers.value.find((person) => person.userId === userId)
  if (!traveler) return

  leg.passengers.push({ userId: traveler.userId, displayName: traveler.displayName, carId: null })
}

function removePassenger(leg: TripTransferLeg, passenger: TripTransferPassenger) {
  leg.passengers = leg.passengers.filter((item) => item.userId !== passenger.userId)
}

/**
 * Убрать машину: её пассажиры остаются в строке и становятся
 * нераспределёнными. Так же поведёт себя база (`ON DELETE SET NULL`):
 * людей не теряем, а показываем, что о них надо договориться заново.
 */
function removeCar(leg: TripTransferLeg, car: TripTransferCar) {
  leg.cars = leg.cars.filter((item) => item.id !== car.id)
  for (const passenger of leg.passengers) {
    if (passenger.carId === car.id) passenger.carId = null
  }
}

function removeLeg(leg: TripTransferLeg) {
  legs.value = legs.value.filter((item) => item.id !== leg.id)
}

/**
 * «Вернуться так же»: копия строки с обратными точками.
 *
 * Дату не копируем: обратный выезд редко известен в момент, когда
 * договорились о прямом, а выдуманное время хуже пустого. Машины и люди —
 * копируются: «так же» и значит «те же и так же».
 */
function returnSameWay(leg: TripTransferLeg) {
  const carIds = new Map<number, number>()

  const cars = leg.cars.map((car) => {
    const id = ++lastCarId
    carIds.set(car.id, id)
    return { ...car, id }
  })

  const passengers = leg.passengers.map((passenger) => ({
    ...passenger,
    carId: passenger.carId === null ? null : (carIds.get(passenger.carId) ?? null),
  }))

  legs.value.push({
    id: ++lastLegId,
    position: legs.value.length + 1,
    departsAt: null,
    fromPlace: leg.toPlace,
    toPlace: leg.fromPlace,
    mode: leg.mode,
    note: null,
    cars,
    passengers,
  })
}

// ───────────────────────────── строка: диалог ─────────────────────────────

interface LegDraft {
  id: number | null
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

function saveLeg() {
  const draft = legDraft.value
  if (!draft) return

  const fromPlace = draft.fromPlace.trim()
  const toPlace = draft.toPlace.trim()

  if (!fromPlace || !toPlace) {
    legError.value = 'Нужны обе точки: откуда и куда'
    return
  }

  if (draft.id === null) {
    legs.value.push({
      id: ++lastLegId,
      position: legs.value.length + 1,
      departsAt: fromLocalInput(draft.departsAt),
      fromPlace,
      toPlace,
      mode: draft.mode,
      note: draft.note.trim() || null,
      cars: [],
      passengers: [],
    })
  } else {
    const leg = legs.value.find((item) => item.id === draft.id)
    if (leg) {
      leg.mode = draft.mode
      leg.fromPlace = fromPlace
      leg.toPlace = toPlace
      leg.departsAt = fromLocalInput(draft.departsAt)
      leg.note = draft.note.trim() || null

      // Смена вида на «не авто» убирает машины: у поезда их не бывает,
      // и оставлять их в данных значило бы показывать чужую строку.
      if (draft.mode !== 'car') {
        leg.cars = []
        for (const passenger of leg.passengers) passenger.carId = null
      }
    }
  }

  legDraft.value = null
}

// ───────────────────────────── машина: диалог ─────────────────────────────

interface CarDraft {
  legId: number
  ownership: TransferCarOwnership
  driverUserId: string
  driverName: string
  driverPhone: string
  /**
   * Мест может быть числом или пустой строкой: `<input type="number">`
   * с `v-model` отдаёт число, а очищенное поле — строку (Vue кастует
   * значение сам, и `String()` — единственный общий знаменатель).
   */
  seats: string | number
}

const carDraft = ref<CarDraft | null>(null)
const carError = ref<string | null>(null)

function openCarDialog(leg: TripTransferLeg) {
  carError.value = null
  carDraft.value = {
    legId: leg.id,
    ownership: 'own',
    driverUserId: me.value.userId,
    driverName: '',
    driverPhone: '',
    seats: '',
  }
}

function saveCar() {
  const draft = carDraft.value
  if (!draft) return

  const leg = legs.value.find((item) => item.id === draft.legId)
  if (!leg) return

  const rawSeats = String(draft.seats).trim()
  const seats = rawSeats === '' ? null : Number(rawSeats)

  if (seats !== null && (!Number.isInteger(seats) || seats < 1)) {
    carError.value = 'Мест — целое число, и хотя бы одно'
    return
  }

  let driverUserId: string | null = null
  let driverName = ''

  if (draft.ownership === 'own') {
    const driver = travelers.value.find((person) => person.userId === draft.driverUserId)
    if (!driver) {
      carError.value = 'Выберите водителя из участников'
      return
    }
    driverUserId = driver.userId
    driverName = driver.displayName
  } else {
    driverName = draft.driverName.trim()
    if (!driverName) {
      carError.value = 'У наёмной машины нужно имя водителя'
      return
    }
  }

  const car: TripTransferCar = {
    id: ++lastCarId,
    ownership: draft.ownership,
    driverUserId,
    driverName,
    driverPhone: draft.driverPhone.trim() || null,
    seats,
    canEdit: props.canEdit || driverUserId === me.value.userId,
  }

  leg.cars.push(car)

  // Водитель своей машины едет в ней: место он занимает, и в «без машины»
  // ему делать нечего.
  if (driverUserId !== null) {
    const driver = leg.passengers.find((passenger) => passenger.userId === driverUserId)
    if (driver) driver.carId = car.id
    else leg.passengers.push({ userId: driverUserId, displayName: driverName, carId: car.id })
  }

  carDraft.value = null
}
</script>

<template>
  <section class="flex flex-col gap-4" data-test="trip-transfer">
    <!-- Макет, а не рабочий экран: честная подпись важнее вида «всё готово» -->
    <p
      class="rounded-xl border border-dashed border-border bg-field px-3 py-2 text-xs text-muted"
      data-test="transfer-demo"
    >
      Макет вкладки: данные примерные, правки живут до перезагрузки страницы. Сохранение и чат
      появятся вместе с API.
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
      <span v-if="!meetingText && (canEdit || isOrganizer)" class="text-xs text-muted">
        — заполняется в форме похода
      </span>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-sm text-muted">Заброска · идут {{ travelers.length }}</h2>

      <button
        v-if="canEdit"
        type="button"
        class="cursor-pointer rounded-xl border border-primary bg-primary px-3 py-2 text-sm text-white transition-opacity hover:opacity-90"
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
            class="cursor-pointer rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-text transition-colors hover:border-primary"
            data-test="transfer-return"
            @click="returnSameWay(leg)"
          >
            Вернуться так же
          </button>
          <button
            type="button"
            class="cursor-pointer rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-text transition-colors hover:border-primary"
            data-test="transfer-edit-leg"
            @click="openLegDialog(leg)"
          >
            Править
          </button>
          <button
            type="button"
            class="cursor-pointer rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-muted transition-colors hover:border-primary hover:text-text"
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
              {{ seatsText(car, leg) }}
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
                v-if="canEditCar(car)"
                type="button"
                class="cursor-pointer border-0 bg-transparent p-0 text-muted transition-colors hover:text-text"
                :data-test="`transfer-unseat-${passenger.userId}`"
                @click="unseat(passenger)"
              >
                ×
              </button>
            </span>

            <span v-if="carPassengers(leg, car).length === 0" class="text-sm text-muted">
              пока никого
            </span>

            <select
              v-if="canEditCar(car) && unassigned(leg).length > 0 && hasFreeSeat(car, leg)"
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
              v-else-if="canEditCar(car) && unassigned(leg).length > 0"
              class="text-xs text-muted"
              data-test="transfer-car-full"
            >
              мест нет
            </span>
          </div>

          <button
            v-if="canEditCar(car)"
            type="button"
            class="cursor-pointer self-start rounded-xl border border-border bg-surface px-3 py-1.5 text-sm text-muted transition-colors hover:border-primary hover:text-text"
            :data-test="`transfer-remove-car-${car.id}`"
            @click="removeCar(leg, car)"
          >
            Убрать машину
          </button>
        </div>

        <button
          v-if="canEdit"
          type="button"
          class="cursor-pointer self-start rounded-xl border border-border bg-field px-3 py-2 text-sm text-text transition-colors hover:border-primary"
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

            <!-- Нераспределённого сажают в машину; поезд и автобус — просто едут -->
            <select
              v-if="leg.mode === 'car' && passenger.carId === null && canEdit && leg.cars.length > 0"
              class="rounded-lg border border-border bg-surface px-1 py-0.5 text-base text-text md:text-xs"
              :data-test="`transfer-choose-car-${passenger.userId}`"
              @change="seatFromRow(leg, passenger, $event)"
            >
              <option value="">в машину</option>
              <option
                v-for="car in leg.cars"
                :key="car.id"
                :value="car.id"
                :disabled="!hasFreeSeat(car, leg)"
              >
                {{ car.driverName }}
              </option>
            </select>

            <button
              v-if="canRemovePassenger(passenger)"
              type="button"
              class="cursor-pointer border-0 bg-transparent p-0 text-muted transition-colors hover:text-text"
              :data-test="`transfer-drop-${passenger.userId}`"
              @click="removePassenger(leg, passenger)"
            >
              ×
            </button>
          </span>

          <span v-if="rowPeople(leg).length === 0" class="text-sm text-muted" data-test="transfer-no-people">
            {{ leg.mode === 'car' ? 'все по машинам' : 'пока никто' }}
          </span>

          <select
            v-if="canEdit && outsiders(leg).length > 0"
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
            class="cursor-pointer rounded-xl border border-primary bg-primary px-3 py-1.5 text-sm text-white transition-opacity hover:opacity-90"
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
        <h3 class="text-base font-medium text-text">Машина</h3>

        <label class="flex flex-col gap-1 text-sm text-muted">
          Чья
          <select
            v-model="carDraft.ownership"
            class="rounded-xl border border-border bg-field px-3 py-2 text-base text-text focus:border-primary focus:outline-none"
            data-test="transfer-ownership-input"
          >
            <option v-for="value in TRANSFER_CAR_OWNERSHIPS" :key="value" :value="value">
              {{ TRANSFER_CAR_OWNERSHIP_LABELS[value] }}
            </option>
          </select>
        </label>

        <label v-if="carDraft.ownership === 'own'" class="flex flex-col gap-1 text-sm text-muted">
          Водитель
          <select
            v-model="carDraft.driverUserId"
            class="rounded-xl border border-border bg-field px-3 py-2 text-base text-text focus:border-primary focus:outline-none"
            data-test="transfer-driver-input"
          >
            <option v-for="person in travelers" :key="person.userId" :value="person.userId">
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
            class="cursor-pointer rounded-xl border border-primary bg-primary px-3 py-1.5 text-sm text-white transition-opacity hover:opacity-90"
            data-test="transfer-car-save"
            @click="saveCar"
          >
            Сохранить
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
