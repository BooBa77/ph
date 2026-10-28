<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { ApiError } from '@/api/errors'
import {
  acceptTransferPassenger,
  addTransferPassenger,
  createTransferLeg,
  fetchTripTransfer,
  joinTransferLeg,
  removeTransferLeg,
  removeTransferPassenger,
  updateTransferLeg,
} from '@/api/trips'
import { createVehicle, fetchVehicles } from '@/api/vehicles'
import { useAuthStore } from '@/stores/auth'
import {
  TRANSFER_COMPENSATIONS,
  TRANSFER_COMPENSATION_LABELS,
  TRANSFER_DIRECTION_LABELS,
  TRANSFER_MODE_GROUPS,
  TRANSFER_MODE_LABELS,
  TRANSFER_PUBLIC_MODES,
  transferModeOfVehicle,
  VEHICLE_KINDS,
  VEHICLE_KIND_LABELS,
  type TransferCompensation,
  type TransferDirection,
  type TransferMode,
  type Trip,
  type TripTransfer,
  type TripTransferLeg,
  type TripTransferPassenger,
  type TripTransferPerson,
  type Vehicle,
  type VehicleKind,
} from '@/types/trips'
import TripChat from '@/views/trips/TripChat.vue'

/**
 * Вкладка «Трансфер»: карточки перемещений двух сторон.
 *
 * **Карточка — это и есть транспорт** (переделано 27.10.2026 по разбору
 * заказчика). Тип транспорта, время, откуда и куда, места, владелец
 * и компенсация живут в одной плашке; «каждая часть группы едет своей
 * карточкой». Машин отдельной сущностью больше нет — у поезда и вертолёта
 * пассажиры те же, а мест и водителя нет.
 *
 * **Заброска — цепочка этапов из тех же карточек** (28.10.2026). Заказчик:
 * «этапы — те же карточки, не новая сущность». Карточки с одинаковым
 * `chainId` собираются в блок: «авто → кони → лодка». Права, пассажиры,
 * места и деньги у этапа прежние — новых правил нет, поэтому и на экране
 * это те же плашки, только с номером этапа и общей подписью.
 *
 * **Заброска бывает и парой.** Этапы одной цепочки могут стоять в обеих
 * сторонах: в «Туда» этапы 1–2, в «Обратно» — 3–4, и номер заброски у них
 * общий. Поэтому подпись говорит, какие именно этапы здесь, а не сколько
 * их в этой области. Порядок задаёт время отправления: номер считает
 * бэкенд, и лодка спокойно стоит и между конями, и после них.
 *
 * **Пара «туда-обратно» — это одна поездка на два конца.** Зеркало
 * создаётся с теми же людьми и той же оплатой, но дальше составы живут
 * врозь: на обратном рейсе людей и точки можно менять, и на прямой это
 * не влияет. Общее остаётся одно — ушёл из исходной, ушёл и из зеркала.
 * Флаг и цена живут на исходной карточке, а у зеркала вместо них подсказка.
 * Пары не бывает у общественного транспорта: билеты покупают раздельно
 * в каждую сторону.
 *
 * **Две области, «Туда» и «Обратно»** — как разделы «Питания»: свои цвета,
 * своя кнопка «Добавить трансфер», свой порядок карточек. Сторона — поле
 * карточки, а не вывод из точек: обратный выезд бывает без точек вовсе.
 *
 * **Плашка сворачивается**: в шапке видно «что, когда и куда» и строку
 * «наше ТС · владелец. Нива г/н 222, занято 4 из 4 (имена)», внутри —
 * пассажиры, оплата и действия. Длинный список из десяти карточек иначе
 * не читается.
 *
 * **Права считает бэкенд**: `plan.canEdit` — можно заводить любые карточки
 * и ставить флаг «наше ТС», `leg.canEdit` — можно править эту карточку
 * (владелец своего ТС правит свою без права на вкладку), `leg.joinStatus` —
 * что будет, если человек присоединится: на рейс сразу, на чужое ТС заявкой.
 *
 * **Чата нет в шаблоне** отдельной кнопкой — он часть вкладки, как у
 * «Питания»: чат — тема вкладки.
 */
const props = defineProps<{ trip: Trip }>()

const auth = useAuthStore()

const plan = ref<TripTransfer | null>(null)
const isLoading = ref(true)
const isSaving = ref(false)
const error = ref<string | null>(null)
const actionError = ref<string | null>(null)

/** Свёрнутые плашки: ключ — id карточки. По умолчанию всё развёрнуто. */
const collapsed = ref<Set<string>>(new Set())

/**
 * Какую карточку человек собрался удалить.
 *
 * Удаление необратимо и уносит пассажиров, поэтому спрашиваем — тем же
 * способом, что у блюд и шаблонов чек-листов: кнопка превращается в «Да»/«Нет».
 */
const confirmingLegId = ref<string | null>(null)

const meId = computed(() => auth.user?.id ?? '')
const vehicles = ref<Vehicle[]>([])
const canEditTab = computed(() => plan.value?.canEdit ?? false)
const travelers = computed(() => plan.value?.travelers ?? [])
const legs = computed(() => plan.value?.legs ?? [])

/** Рейсы одной стороны: только не этапы, заброска живёт отдельно. */
function transferSection(direction: TransferDirection) {
  const list = legs.value.filter(
    (leg) => leg.direction === direction && !leg.isStage,
  )

  return {
    key: direction,
    kind: 'transfers' as const,
    direction,
    legs: list,
    unassigned: unassignedIn(list),
    empty:
      direction === 'there'
        ? 'Секция отображения рейсов к началу маршрута. Каждый рейс — отдельное перемещение части группы: кто-то едет машиной, кто-то автобусом или заброска вещей отдельно от участников'
        : 'Секция отображения рейсов до дома',
    label: TRANSFER_DIRECTION_LABELS[direction],
    addLabel: 'Добавить рейс',
    plate: direction === 'there' ? 'border-sky-300 bg-sky-100' : 'border-emerald-300 bg-emerald-100',
    title: direction === 'there' ? 'text-sky-900' : 'text-emerald-900',
    button: direction === 'there' ? 'bg-sky-600' : 'bg-emerald-600',
  }
}

/** Заброска: её этапы — такие же рейсы, просто в своей секции. */
function stageSection() {
  const list = legs.value.filter((leg) => leg.isStage)

  return {
    key: 'stages',
    kind: 'stages' as const,
    direction: null,
    legs: list,
    unassigned: [],
    empty: 'Уазики, каюры и прочее бездорожье',
    label: 'Заброска',
    addLabel: 'Добавить этап заброски',
    plate: 'border-violet-300 bg-violet-100',
    title: 'text-violet-900',
    button: 'bg-violet-600',
  }
}

/** Три секции одного экрана: дорога туда, заброска, дорога домой. */
const sections = computed(() => [
  transferSection('there'),
  stageSection(),
  transferSection('back'),
])

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

  /**
   * Каталог транспорта — отдельно и необязательно: без него вкладка
   * работает, просто выбрать готовую машину будет не из чего.
   */
  try {
    vehicles.value = await fetchVehicles()
  } catch {
    vehicles.value = []
  }
}

watch(() => props.trip.id, load, { immediate: true })

/** Одна обёртка на все действия: сервер отвечает вкладкой целиком. */
async function run(action: () => Promise<TripTransfer>): Promise<boolean> {
  if (isSaving.value) return false

  isSaving.value = true
  actionError.value = null

  try {
    plan.value = await action()
    return true
  } catch (problem) {
    actionError.value =
      problem instanceof ApiError ? problem.message : 'Не получилось — попробуйте ещё раз'
    return false
  } finally {
    isSaving.value = false
  }
}

// ───────────────────────────── что показываем ─────────────────────────────

function isCollapsed(id: string): boolean {
  return collapsed.value.has(id)
}

function toggleCollapsed(id: string) {
  const next = new Set(collapsed.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)

  collapsed.value = next
}

/** «7 ноября, 08:00» — время обязательно, поэтому без «уточняется». */
function departureText(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function accepted(leg: TripTransferLeg): TripTransferPassenger[] {
  return leg.passengers.filter((person) => person.status === 'accepted')
}

function requested(leg: TripTransferLeg): TripTransferPassenger[] {
  return leg.passengers.filter((person) => person.status === 'requested')
}

/**
 * Сколько людей едет — словами.
 *
 * Заказчик попросил именно эти три вида: «занято 4 из 4 (имена)»,
 * «едем все вместе» и «без участников». Ноль из нуля не показываем вовсе:
 * мест не указали — значит потолка нет, а не «ноль», и «0 из 0» читалось
 * бы как полная машина без людей.
 */
function peopleText(leg: TripTransferLeg): string {
  const riding = accepted(leg)

  if (riding.length === 0) return 'без участников'
  if (leg.seats === null) return 'едем все вместе'

  const names = riding.map((person) => person.displayName).join(', ')

  return `занято ${riding.length} из ${leg.seats} (${names})`
}

/**
 * Шапка плашки одной строкой: «Наше ТС · Сергей. Нива г/н 222, занято
 * 4 из 4 (имена) {заметка}».
 *
 * Раньше это были три отдельных куска в ряд, и «0 из 0» с припиской
 * «пока никого — вещи поедут без людей» приходилось читать как ребус.
 */
function summaryText(leg: TripTransferLeg): string {
  let text = ''

  if (leg.isOwnVehicle) {
    text = leg.ownerName ? `Наше ТС · ${leg.ownerName}` : 'Наше ТС'
  }

  if (leg.vehicleTitle !== null) {
    const plate = leg.vehiclePlate === null ? '' : ` г/н ${leg.vehiclePlate}`
    text = text === '' ? `${leg.vehicleTitle}${plate}` : `${text}. ${leg.vehicleTitle}${plate}`
  }

  const people = peopleText(leg)
  text = text === '' ? people : `${text}, ${people}`

  return leg.note === null ? text : `${text} ${leg.note}`
}

/**
 * Компенсация одной строкой: «Общий расход · 3000 ₽ · туда-обратно».
 * Сумма у «безвозмездно» не показывается — её и нет.
 *
 * Живёт внутри плашки, а не в шапке: заказчик попросил «оплату — внутрь».
 */
function compensationText(leg: TripTransferLeg): string {
  const parts = [TRANSFER_COMPENSATION_LABELS[leg.compensation]]

  if (leg.compensationAmountRub !== null) {
    parts.push(`${leg.compensationAmountRub.toLocaleString('ru-RU')} ₽`)
  }
  if (leg.isRoundTrip) parts.push('туда-обратно')

  return parts.join(' · ')
}

/** В «Трансфере» велосипед не выбирают: он не возит группу. */
const vehiclesForTransfer = computed(() =>
  vehicles.value.filter((vehicle) => transferModeOfVehicle(vehicle.kind) !== null),
)

/** Кого ещё нет в карточке — их и предлагаем посадить. */
function outsiders(leg: TripTransferLeg) {
  return travelers.value.filter(
    (traveler) => !leg.passengers.some((person) => person.userId === traveler.userId),
  )
}

/** Участники, которых нет ни в одной карточке стороны — они внизу секции. */
function unassignedIn(list: TripTransferLeg[]): TripTransferPerson[] {
  const seated = new Set<string>()

  for (const leg of list) {
    for (const person of leg.passengers) {
      if (person.status === 'accepted') seated.add(person.userId)
    }
  }

  return travelers.value.filter((person) => !seated.has(person.userId))
}

function isMine(person: TripTransferPassenger): boolean {
  return person.userId === meId.value
}

function hasFreeSeat(leg: TripTransferLeg): boolean {
  return leg.seats === null || leg.occupied < leg.seats
}

const addTraveler = (leg: TripTransferLeg, event: Event) => {
  const select = event.target as HTMLSelectElement
  const userId = select.value
  select.value = ''

  if (userId !== '') {
    void run(() => addTransferPassenger(props.trip.id, leg.id, userId))
  }
}

const join = (leg: TripTransferLeg) => void run(() => joinTransferLeg(props.trip.id, leg.id))

const accept = (leg: TripTransferLeg, person: TripTransferPassenger) =>
  void run(() => acceptTransferPassenger(props.trip.id, leg.id, person.userId))

const leave = (leg: TripTransferLeg, person: TripTransferPassenger) =>
  void run(() => removeTransferPassenger(props.trip.id, leg.id, person.userId))

/** Удаление подтверждено — убираем карточку вместе с её пассажирами. */
async function deleteLeg(leg: TripTransferLeg) {
  confirmingLegId.value = null

  await run(() => removeTransferLeg(props.trip.id, leg.id))
}

// ───────────────────────────── рейс: диалог ─────────────────────────────

interface LegDraft {
  id: string | null
  /** Этап заброски: строка попадёт в секцию «Заброска». */
  isStage: boolean
  direction: TransferDirection
  mode: TransferMode
  fromPlace: string
  toPlace: string
  /** `datetime-local` — местное «YYYY-MM-DDTHH:mm». */
  departsAt: string
  /** Транспорт из каталога: `''` — не выбран, тип и места вводим руками. */
  vehicleId: string
  isOwnVehicle: boolean
  ownerUserId: string
  seats: string | number
  compensation: TransferCompensation
  amount: string | number
  isRoundTrip: boolean
  /** Заполнено — это зеркало пары, второй пары у него не бывает. */
  sourceLegId: string | null
  note: string
}

const legDraft = ref<LegDraft | null>(null)
const legError = ref<string | null>(null)

/** `datetime-local` ждёт местное «YYYY-MM-DDTHH:mm», а API — ISO. */
function toLocalInput(iso: string): string {
  const date = new Date(iso)
  const pad = (value: number) => String(value).padStart(2, '0')

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null
}

const isPublicMode = (mode: TransferMode) =>
  (TRANSFER_PUBLIC_MODES as readonly string[]).includes(mode)

/** Какие компенсации допустимы для типа: у рейса — билет, у своего — расход. */
const allowedCompensations = computed<TransferCompensation[]>(() => {
  if (!legDraft.value) return [...TRANSFER_COMPENSATIONS]

  return isPublicMode(legDraft.value.mode)
    ? ['free', 'ticket']
    : ['free', 'shared', 'sharedPerPassenger']
})

const isAmountNeeded = computed(() => legDraft.value?.compensation !== 'free')

/**
 * Карточка-зеркало пары.
 *
 * У неё нет ни флага «туда-обратно», ни своей оплаты: пара — это одна
 * поездка, и оба конца у неё общие. Показываем одну подсказку вместо двух
 * полей, которые всё равно ничего не решают.
 */
const isMirror = computed(
  () => legDraft.value !== null && legDraft.value.sourceLegId !== null,
)

/**
 * Прятать ли оплату и флаг: у зеркала пары своего кошелька нет, кроме
 * общественного транспорта — там билеты на обоих концах и цена своя.
 */
const hidesMoney = computed(
  () => isMirror.value && !isPublicMode(legDraft.value?.mode ?? 'car'),
)

/** Флаг «наше ТС» — только тому, кому право вкладки дало флаг. */
const canFlagOwnVehicle = computed(
  () => canEditTab.value && legDraft.value !== null && !isPublicMode(legDraft.value.mode),
)

/**
 * Общий черновик формы. Этап и рейс — одна и та же строка, поэтому
 * и форма одна: разница только в `isStage`, то есть в секции.
 */
function buildDraft(
  direction: TransferDirection,
  leg: TripTransferLeg | null,
  isStage: boolean,
): LegDraft {
  if (leg === null) {
    return {
      id: null,
      isStage,
      direction,
      mode: 'car',
      fromPlace: '',
      toPlace: '',
      departsAt: '',
      vehicleId: '',
      isOwnVehicle: false,
      ownerUserId: meId.value,
      seats: '',
      compensation: 'free',
      amount: '',
      isRoundTrip: false,
      sourceLegId: null,
      note: '',
    }
  }

  return {
    id: leg.id,
    isStage,
    direction: leg.direction,
    mode: leg.mode,
    fromPlace: leg.fromPlace,
    toPlace: leg.toPlace,
    departsAt: toLocalInput(leg.departsAt),
    vehicleId: leg.vehicleId ?? '',
    isOwnVehicle: leg.isOwnVehicle,
    ownerUserId: leg.ownerUserId ?? meId.value,
    seats: leg.seats ?? '',
    compensation: leg.compensation,
    amount: leg.compensationAmountRub ?? '',
    isRoundTrip: leg.isRoundTrip,
    sourceLegId: leg.sourceLegId,
    note: leg.note ?? '',
  }
}

/** Правка или создание рейса; `isStage` решает, в какую секцию он попадёт. */
function openLegDialog(
  direction: TransferDirection,
  leg: TripTransferLeg | null = null,
  isStage?: boolean,
) {
  legError.value = null
  legDraft.value = buildDraft(direction, leg, isStage ?? leg?.isStage ?? false)
}

/**
 * Смена типа меняет и набор допустимых оплат.
 *
 * У общественного транспорта по умолчанию «цена билета»: там платят
 * за билет, а не «делят бензин». Пара при этом остаётся возможной —
 * «туда-обратно» это планирование, а не кошелёк.
 */
function changeMode() {
  const draft = legDraft.value
  if (!draft) return

  /**
   * У рейса по умолчанию «цена билета»: там платят за билет, а не делят
   * бензин. Обратно — с рейса на свой транспорт — «безвозмездно»:
   * билет своему авто не выписывают.
   */
  if (isPublicMode(draft.mode)) {
    if (draft.compensation === 'free') draft.compensation = 'ticket'
    draft.isOwnVehicle = false
  } else if (draft.compensation === 'ticket') {
    draft.compensation = 'free'
  }
}

/** Выбранный транспорт каталога: у него свои тип и места. */
const selectedVehicle = computed(
  () => vehicles.value.find((vehicle) => vehicle.id === legDraft.value?.vehicleId) ?? null,
)

const selectedVehicleMode = computed<TransferMode | null>(() =>
  selectedVehicle.value === null ? null : transferModeOfVehicle(selectedVehicle.value.kind),
)

function applyVehicle() {
  const draft = legDraft.value
  const vehicle = selectedVehicle.value
  const mode = selectedVehicleMode.value
  if (!draft || !vehicle || mode === null) return

  draft.mode = mode
  draft.seats = vehicle.seats ?? ''
  draft.isOwnVehicle = true
  draft.ownerUserId = meId.value

  if (!allowedCompensations.value.includes(draft.compensation)) {
    draft.compensation = 'free'
  }
}

// ─── «Добавить технику» прямо в диалоге ───

interface VehicleDraft {
  kind: VehicleKind
  brand: string
  seats: string | number
  plate: string
}

const vehicleDraft = ref<VehicleDraft | null>(null)
const vehicleError = ref<string | null>(null)

function openVehicleForm() {
  vehicleError.value = null
  vehicleDraft.value = { kind: 'car', brand: '', seats: '', plate: '' }
}

async function saveVehicle() {
  const draft = vehicleDraft.value
  if (!draft) return

  const brand = draft.brand.trim()
  if (!brand) {
    vehicleError.value = 'Марка нужна — по ней выбирают в списке'
    return
  }

  const rawSeats = String(draft.seats).trim()
  const seats = rawSeats === '' ? null : Number(rawSeats)

  if (seats !== null && (!Number.isInteger(seats) || seats < 1)) {
    vehicleError.value = 'Вместимость — целое число, и хотя бы одно место'
    return
  }

  try {
    const created = await createVehicle({
      kind: draft.kind,
      brand,
      seats,
      plate: draft.plate.trim() || null,
    })

    vehicles.value = [...vehicles.value, created]

    if (legDraft.value) {
      legDraft.value.vehicleId = created.id
      applyVehicle()
    }

    vehicleDraft.value = null
  } catch (problem) {
    vehicleError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось сохранить транспорт'
  }
}

async function saveLeg() {
  const draft = legDraft.value
  if (!draft) return

  const fromPlace = draft.fromPlace.trim()
  const toPlace = draft.toPlace.trim()
  const departsAt = fromLocalInput(draft.departsAt)

  if (!fromPlace || !toPlace) {
    legError.value = 'Нужны обе точки: откуда и докуда'
    return
  }

  if (!departsAt) {
    legError.value = 'Без времени отправления рейс бесполезен — укажите его'
    return
  }

  const rawAmount = String(draft.amount).trim()
  const amount = rawAmount === '' ? null : Number(rawAmount)

  if (draft.compensation !== 'free' && (amount === null || amount <= 0)) {
    legError.value = 'Укажите сумму компенсации'
    return
  }

  const rawSeats = String(draft.seats).trim()
  const seats = rawSeats === '' ? null : Number(rawSeats)

  if (seats !== null && (!Number.isInteger(seats) || seats < 1)) {
    legError.value = 'Мест — целое число, и хотя бы одно'
    return
  }

  const input = {
    direction: draft.direction,
    isStage: draft.isStage,
    mode: draft.mode,
    departsAt,
    fromPlace,
    toPlace,
    isOwnVehicle: draft.isOwnVehicle,
    ownerUserId: draft.isOwnVehicle ? draft.ownerUserId : null,
    seats,
    vehicleId: draft.vehicleId === '' ? null : Number(draft.vehicleId),
    compensation: draft.compensation,
    compensationAmountRub: draft.compensation === 'free' ? null : amount,
    isRoundTrip: draft.isRoundTrip,
    note: draft.note.trim() || null,
  }

  const ok =
    draft.id === null
      ? await run(() => createTransferLeg(props.trip.id, input))
      : await run(() => updateTransferLeg(props.trip.id, draft.id as string, input))

  if (ok) legDraft.value = null
}

/** Правка строки: форма одна, `isStage` решает, в какой секции она живёт. */
function editLeg(leg: TripTransferLeg) {
  openLegDialog(leg.direction, leg)
}

/** Кнопка внизу секции: новый рейс или новый этап заброски. */
function addFrom(section: { kind: 'transfers' | 'stages'; direction: TransferDirection | null }) {
  if (section.kind === 'stages') openLegDialog('there', null, true)
  else if (section.direction !== null) openLegDialog(section.direction)
}

const driverOptions = computed(() =>
  canEditTab.value
    ? travelers.value
    : travelers.value.filter((person) => person.userId === meId.value),
)
</script>

<template>
  <section class="flex flex-col gap-4" data-test="trip-transfer">
    <p v-if="isLoading" class="text-muted" data-test="transfer-loading">Загружаем трансфер…</p>

    <p v-else-if="error" class="text-muted" data-test="transfer-error">{{ error }}</p>

    <template v-else>
      <p v-if="actionError" class="text-sm text-red-600" data-test="transfer-action-error">
        {{ actionError }}
      </p>

      <!--
        Три секции: рейсы к началу маршрута, заброска (бездорожье), рейсы
        домой. Этап заброски — такой же рейс, просто в своей секции.
      -->
      <details
        v-for="section in sections"
        :key="section.key"
        open
        class="flex flex-col gap-3 rounded-2xl border p-3"
        :class="section.plate"
        :data-test="`transfer-area-${section.key}`"
      >
        <summary class="cursor-pointer select-none text-sm" :class="section.title">
          {{ section.label }}
        </summary>

        <p v-if="section.legs.length === 0" class="text-sm text-muted" data-test="transfer-empty">
          {{ section.empty }}
        </p>

        <article
          v-for="leg in section.legs"
          :key="leg.id"
          class="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3"
          data-test="transfer-leg"
        >
            <header class="flex items-start gap-2">
              <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                <span class="text-base font-medium text-text" data-test="transfer-leg-mode">
                  {{ TRANSFER_MODE_LABELS[leg.mode] }} · {{ departureText(leg.departsAt) }}
                </span>

                <span class="text-sm text-text" data-test="transfer-leg-places">
                  {{ leg.fromPlace }} → {{ leg.toPlace }}
                </span>

                <span class="text-xs text-muted" data-test="transfer-leg-summary">
                  {{ summaryText(leg) }}
                </span>
              </div>

              <!-- Свернуть плашку: в шапке остаётся «что, когда и куда» -->
              <button
                type="button"
                class="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border text-muted transition-colors hover:border-primary hover:text-text"
                :aria-expanded="!isCollapsed(leg.id)"
                :data-test="`transfer-collapse-${leg.id}`"
                :title="isCollapsed(leg.id) ? 'Показать подробности' : 'Свернуть'"
                @click="toggleCollapsed(leg.id)"
              >
                <svg
                  class="h-4 w-4 transition-transform"
                  :class="isCollapsed(leg.id) ? '-rotate-90' : ''"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.4"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
            </header>

            <template v-if="!isCollapsed(leg.id)">
              <!-- Оплата внутри плашки: заказчик попросил «оплату — внутрь» -->
              <p class="text-sm text-muted" data-test="transfer-leg-compensation">
                {{ compensationText(leg) }}
              </p>

              <div class="flex flex-wrap items-center gap-2" data-test="transfer-passengers">
                <span
                  v-for="person in accepted(leg)"
                  :key="person.userId"
                  class="flex items-center gap-1 rounded-full border border-border bg-field px-2 py-1 text-sm text-text"
                  data-test="transfer-passenger"
                >
                  {{ person.displayName }}
                  <span v-if="isMine(person)" class="text-xs text-muted">(вы)</span>

                  <!--
                    Крестика у владельца ТС нет: он уходит вместе со своим
                    трансфером, и «удалить» его отдельно всё равно нельзя.
                  -->
                  <button
                    v-if="(isMine(person) || leg.canEdit) && person.userId !== leg.ownerUserId"
                    type="button"
                    class="cursor-pointer border-0 bg-transparent p-0 text-muted transition-colors hover:text-text disabled:opacity-60"
                    :disabled="isSaving"
                    :data-test="`transfer-leave-${leg.id}-${person.userId}`"
                    @click="leave(leg, person)"
                  >
                    ×
                  </button>
                </span>
              </div>

              <!-- Заявки на своё ТС: владелец принимает сам -->
              <div
                v-if="requested(leg).length > 0"
                class="flex flex-col gap-1 rounded-lg border border-dashed border-border p-2"
                data-test="transfer-requests"
              >
                <span class="text-xs text-muted">Просятся</span>

                <span
                  v-for="person in requested(leg)"
                  :key="person.userId"
                  class="flex flex-wrap items-center gap-2 text-sm text-text"
                >
                  {{ person.displayName }}

                  <template v-if="leg.canEdit">
                    <button
                      type="button"
                      class="cursor-pointer rounded-lg border border-primary bg-primary px-2 py-1 text-xs text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                      :disabled="isSaving"
                      :data-test="`transfer-accept-${leg.id}-${person.userId}`"
                      @click="accept(leg, person)"
                    >
                      Принять
                    </button>
                    <button
                      type="button"
                      class="cursor-pointer rounded-lg border border-border bg-field px-2 py-1 text-xs text-text transition-colors hover:border-primary disabled:opacity-60"
                      :disabled="isSaving"
                      :data-test="`transfer-reject-${leg.id}-${person.userId}`"
                      @click="leave(leg, person)"
                    >
                      Отклонить
                    </button>
                  </template>

                  <!-- Свою заявку человек отменяет сам -->
                  <button
                    v-else-if="isMine(person)"
                    type="button"
                    class="cursor-pointer border-0 bg-transparent p-0 text-xs text-muted underline transition-colors hover:text-text disabled:opacity-60"
                    :disabled="isSaving"
                    :data-test="`transfer-leave-${leg.id}-${person.userId}`"
                    @click="leave(leg, person)"
                  >
                    Отменить заявку
                  </button>
                </span>
              </div>

              <div class="flex flex-wrap items-center gap-2">
                <!-- Присоединиться: на рейс сразу, на чужое ТС заявкой -->
                <button
                  v-if="leg.joinStatus !== null"
                  type="button"
                  class="cursor-pointer rounded-xl border border-primary bg-primary px-3 py-1.5 text-sm text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                  :disabled="isSaving"
                  :data-test="`transfer-join-${leg.id}`"
                  @click="join(leg)"
                >
                  {{ leg.joinStatus === 'requested' ? 'Попроситься' : 'Присоединиться' }}
                </button>

                <span
                  v-else-if="leg.isOwnVehicle && leg.ownerUserId === meId"
                  class="text-xs text-muted"
                  data-test="transfer-owner-hint"
                >
                  Ваше ТС — заявки принимаете вы
                </span>

                <select
                  v-if="leg.canEdit && outsiders(leg).length > 0"
                  class="w-full rounded-xl border border-border bg-field px-2 py-1 text-base text-text transition-colors focus:border-primary focus:outline-none md:w-auto md:text-sm"
                  :data-test="`transfer-add-passenger-${leg.id}`"
                  @change="addTraveler(leg, $event)"
                >
                  <option value="">посадить…</option>
                  <option
                    v-for="person in outsiders(leg)"
                    :key="person.userId"
                    :value="person.userId"
                  >
                    {{ person.displayName }}
                  </option>
                </select>

                <span
                  v-if="leg.canEdit && !hasFreeSeat(leg)"
                  class="text-xs text-muted"
                  data-test="transfer-full"
                >
                  мест нет
                </span>
              </div>

              <div v-if="leg.canEdit" class="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  class="cursor-pointer rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-text transition-colors hover:border-primary disabled:opacity-60"
                  :disabled="isSaving"
                  :data-test="`transfer-edit-${leg.id}`"
                  @click="editLeg(leg)"
                >
                  Править
                </button>

                <template v-if="confirmingLegId === leg.id">
                  <span class="text-sm text-muted">Удалить трансфер?</span>
                  <button
                    type="button"
                    class="cursor-pointer rounded-xl border border-red-600 px-3 py-1 text-sm text-red-600 transition-colors hover:bg-red-600 hover:text-white disabled:opacity-50"
                    :disabled="isSaving"
                    :data-test="`transfer-delete-confirm-${leg.id}`"
                    @click="deleteLeg(leg)"
                  >
                    Да
                  </button>
                  <button
                    type="button"
                    class="cursor-pointer rounded-xl border border-border px-3 py-1 text-sm text-muted transition-colors hover:text-text"
                    :data-test="`transfer-delete-cancel-${leg.id}`"
                    @click="confirmingLegId = null"
                  >
                    Нет
                  </button>
                </template>
                <button
                  v-else
                  type="button"
                  class="cursor-pointer rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-muted transition-colors hover:border-red-600 hover:text-red-600 disabled:opacity-60"
                  :disabled="isSaving"
                  :data-test="`transfer-delete-${leg.id}`"
                  @click="confirmingLegId = leg.id"
                >
                  Удалить
                </button>
              </div>
            </template>
          </article>

        <!-- Кто ещё не сел ни в один рейс этой стороны -->
        <div v-if="section.unassigned.length > 0" class="flex flex-col gap-2">
          <hr class="border-border" />

          <div class="flex flex-wrap items-center gap-1" data-test="transfer-unassigned">
            <span class="text-xs text-muted">Не распределены:</span>
            <span
              v-for="person in section.unassigned"
              :key="person.userId"
              class="rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted"
            >
              {{ person.displayName }}
            </span>
          </div>
        </div>

        <button
          type="button"
          class="cursor-pointer self-start rounded-xl px-3 py-2 text-sm text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          :class="section.button"
          :disabled="isSaving"
          :data-test="`transfer-add-${section.key}`"
          @click="addFrom(section)"
        >
          {{ section.addLabel }}
        </button>
      </details>

      <!-- Карточка: создать или поправить. Одна форма на оба случая -->
      <div
        v-if="legDraft"
        class="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4"
        data-test="transfer-leg-dialog"
      >
        <div class="flex w-full max-w-md flex-col gap-2 rounded-xl border border-border bg-surface p-4">
          <h3 class="text-base font-medium text-text">
            <template v-if="legDraft.isStage">
              {{ legDraft.id === null ? 'Новый этап заброски' : 'Этап заброски' }}
            </template>
            <template v-else>
              {{ legDraft.id === null ? 'Новый рейс' : 'Рейс' }} ·
              {{ TRANSFER_DIRECTION_LABELS[legDraft.direction] }}
            </template>
          </h3>

          <!-- Тип и места — от каталога, если транспорт выбран из списка -->
          <label v-if="!selectedVehicle" class="flex flex-col gap-1 text-sm text-muted">
            Тип транспорта
            <select
              v-model="legDraft.mode"
              class="rounded-xl border border-border bg-field px-3 py-2 text-base text-text focus:border-primary focus:outline-none"
              data-test="transfer-mode-input"
              @change="changeMode"
            >
              <optgroup
                v-for="group in TRANSFER_MODE_GROUPS"
                :key="group.code"
                :label="group.label"
              >
                <option v-for="mode in group.modes" :key="mode" :value="mode">
                  {{ TRANSFER_MODE_LABELS[mode] }}
                </option>
              </optgroup>
            </select>
          </label>

          <!-- Транспорт из каталога: тип и места приходят оттуда -->
          <div class="flex flex-col gap-1 text-sm text-muted">
            <span>Мой транспорт</span>

            <div class="flex flex-wrap gap-2">
              <select
                v-model="legDraft.vehicleId"
                class="min-w-0 flex-1 rounded-xl border border-border bg-field px-3 py-2 text-base text-text focus:border-primary focus:outline-none"
                data-test="transfer-vehicle-input"
                @change="applyVehicle"
              >
                <option value="">не используется</option>
                <option v-for="vehicle in vehiclesForTransfer" :key="vehicle.id" :value="vehicle.id">
                  {{ vehicle.brand }} · {{ VEHICLE_KIND_LABELS[vehicle.kind]
                  }}<template v-if="vehicle.plate"> · {{ vehicle.plate }}</template
                  ><template v-if="vehicle.seats"> · {{ vehicle.seats }} мест</template>
                </option>
              </select>

              <button
                type="button"
                class="cursor-pointer rounded-xl border border-border bg-field px-3 py-2 text-sm text-text transition-colors hover:border-primary"
                data-test="transfer-vehicle-new"
                @click="openVehicleForm"
              >
                Добавить
              </button>
            </div>

            <p v-if="selectedVehicle && selectedVehicleMode" class="text-xs text-muted" data-test="transfer-vehicle-applied">
              Тип и места — из техники: {{ TRANSFER_MODE_LABELS[selectedVehicleMode] }}<template
                v-if="selectedVehicle.seats"
              >
                · {{ selectedVehicle.seats }} мест</template
              >
            </p>
          </div>

          <!-- Завести транспорт, не уходя из карточки -->
          <div
            v-if="vehicleDraft"
            class="flex flex-col gap-2 rounded-xl border border-dashed border-border p-2"
            data-test="vehicle-form"
          >
            <select
              v-model="vehicleDraft.kind"
              class="rounded-xl border border-border bg-field px-3 py-2 text-base text-text focus:border-primary focus:outline-none"
              data-test="vehicle-kind-input"
            >
              <option v-for="kind in VEHICLE_KINDS" :key="kind" :value="kind">
                {{ VEHICLE_KIND_LABELS[kind] }}
              </option>
            </select>

            <input
              v-model="vehicleDraft.brand"
              type="text"
              maxlength="100"
              placeholder="Марка: «Нива»"
              class="rounded-xl border border-border bg-field px-3 py-2 text-base text-text focus:border-primary focus:outline-none"
              data-test="vehicle-brand-input"
            />

            <div class="flex gap-2">
              <input
                v-model="vehicleDraft.seats"
                type="number"
                min="1"
                max="60"
                placeholder="Мест"
                class="w-24 rounded-xl border border-border bg-field px-3 py-2 text-base text-text focus:border-primary focus:outline-none"
                data-test="vehicle-seats-input"
              />
              <input
                v-model="vehicleDraft.plate"
                type="text"
                maxlength="20"
                placeholder="Госномер"
                class="min-w-0 flex-1 rounded-xl border border-border bg-field px-3 py-2 text-base text-text focus:border-primary focus:outline-none"
                data-test="vehicle-plate-input"
              />
            </div>

            <p v-if="vehicleError" class="text-sm text-red-600" data-test="vehicle-error">
              {{ vehicleError }}
            </p>

            <button
              type="button"
              class="cursor-pointer self-start rounded-xl border border-primary bg-primary px-3 py-1.5 text-sm text-white transition-opacity hover:opacity-90"
              data-test="vehicle-save"
              @click="saveVehicle"
            >
              Сохранить в моём снаряжении
            </button>

            <button
              type="button"
              class="cursor-pointer self-start rounded-xl border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:text-text"
              data-test="vehicle-cancel"
              @click="vehicleDraft = null"
            >
              Отмена
            </button>
          </div>

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
            Докуда
            <input
              v-model="legDraft.toPlace"
              type="text"
              maxlength="200"
              class="rounded-xl border border-border bg-field px-3 py-2 text-base text-text focus:border-primary focus:outline-none"
              data-test="transfer-to-input"
            />
          </label>

          <label class="flex flex-col gap-1 text-sm text-muted">
            Время отправления
            <input
              v-model="legDraft.departsAt"
              type="datetime-local"
              class="rounded-xl border border-border bg-field px-3 py-2 text-base text-text focus:border-primary focus:outline-none"
              data-test="transfer-departure-input"
            />
          </label>

          <!-- «Наше ТС» — только тому, кому право вкладки дало флаг -->
          <template v-if="!selectedVehicle">
            <label
              v-if="canFlagOwnVehicle"
              class="flex cursor-pointer items-center gap-2 text-sm text-text"
            >
              <input
                v-model="legDraft.isOwnVehicle"
                type="checkbox"
                class="h-4 w-4 cursor-pointer accent-[var(--theme-primary)]"
                data-test="transfer-own-input"
              />
              Наше ТС
              <span class="text-xs text-muted">— заявки на него принимает владелец</span>
            </label>

            <label
              v-if="legDraft.isOwnVehicle"
              class="flex flex-col gap-1 text-sm text-muted"
            >
              Владелец ТС
              <select
                v-model="legDraft.ownerUserId"
                class="rounded-xl border border-border bg-field px-3 py-2 text-base text-text focus:border-primary focus:outline-none"
                data-test="transfer-owner-input"
              >
                <option v-for="person in driverOptions" :key="person.userId" :value="person.userId">
                  {{ person.displayName }}
                </option>
              </select>
            </label>

            <p
              v-else-if="!canEditTab && !isPublicMode(legDraft.mode)"
              class="text-xs text-muted"
              data-test="transfer-own-hint"
            >
              Свой транспорт попадёт как «наше ТС»: заявки будете принимать вы
            </p>

            <label
              v-if="!isPublicMode(legDraft.mode)"
              class="flex flex-col gap-1 text-sm text-muted"
            >
              Всего мест, включая водителя — можно не заполнять
              <input
                v-model="legDraft.seats"
                type="number"
                min="1"
                max="60"
                class="rounded-xl border border-border bg-field px-3 py-2 text-base text-text focus:border-primary focus:outline-none"
                data-test="transfer-seats-input"
              />
            </label>
          </template>

          <!--
            Общая оплата бывает только у своего и наёмного транспорта:
            бензин и аренда платятся «за два конца». У общественного
            билеты стоят на обоих концах, и цена у них своя, поэтому
            у рейса поля оплаты есть даже в зеркале.
          -->
          <p v-if="hidesMoney" class="text-xs text-muted" data-test="transfer-mirror-hint">
            Это обратный рейс пары: «туда-обратно» и оплата задаются на исходном.
            Здесь правятся люди, точки и время
          </p>

          <template v-else>
            <label class="flex flex-col gap-1 text-sm text-muted">
              Компенсация расходов
              <select
                v-model="legDraft.compensation"
                class="rounded-xl border border-border bg-field px-3 py-2 text-base text-text focus:border-primary focus:outline-none"
                data-test="transfer-compensation-input"
              >
                <option v-for="value in allowedCompensations" :key="value" :value="value">
                  {{ TRANSFER_COMPENSATION_LABELS[value] }}
                </option>
              </select>
            </label>

            <label
              v-if="isAmountNeeded"
              class="flex flex-col gap-1 text-sm text-muted"
            >
              Сумма, рублей
              <input
                v-model="legDraft.amount"
                type="number"
                min="1"
                max="1000000"
                class="rounded-xl border border-border bg-field px-3 py-2 text-base text-text focus:border-primary focus:outline-none"
                data-test="transfer-amount-input"
              />
            </label>

            <label class="flex cursor-pointer items-center gap-2 text-sm text-text">
              <input
                v-model="legDraft.isRoundTrip"
                type="checkbox"
                class="h-4 w-4 cursor-pointer accent-[var(--theme-primary)]"
                data-test="transfer-round-trip-input"
              />
              Туда-обратно
              <span class="text-xs text-muted">
                — вернуться тем же способом и составом (можно редактировать)
              </span>
            </label>
          </template>

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

          <p v-if="legError" class="text-sm text-red-600" data-test="transfer-leg-error">
            {{ legError }}
          </p>

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

      <!-- Чат трансфера — часть вкладки, как у «Питания» -->
      <TripChat :trip-id="trip.id" kind="trip_transfer" />
    </template>
  </section>
</template>
