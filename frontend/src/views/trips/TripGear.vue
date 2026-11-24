<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import {
  addPersonalTripGear,
  assignTripGearPackage,
  autoDistributeTripGear,
  createTripGearSection,
  getTripGearLoad,
  listGear,
  listTripGear,
  proposeTripGear,
  removePersonalTripGear,
  removeTripGear,
  removeTripGearSection,
  updatePersonalTripGear,
  updateTripGear,
  updateTripGearSection,
} from '@/api/gear'
import { subscribeTripEvents } from '@/api/events'
import type { TripEvent } from '@/api/events'
import { listTripChecklists } from '@/api/tripChecklists'
import { listParticipants, removeRouteSleeping } from '@/api/trips'
import { ApiError } from '@/api/errors'
import { useAuthStore } from '@/stores/auth'
import TripChat from '@/views/trips/TripChat.vue'
import TripGearChecklist from '@/components/gear/TripGearChecklist.vue'
import TripGearExtraPicker from '@/components/gear/TripGearExtraPicker.vue'
import TripGearItemModal from '@/components/gear/TripGearItemModal.vue'
import TripGearManualModal from '@/components/gear/TripGearManualModal.vue'
import TripGearSectionList from '@/components/gear/TripGearSectionList.vue'
import { pickableGear } from '@/utils/gearCatalog'
import { TRIP_GEAR_STATUS_LABELS } from '@/types/gear'
import type { Checklist, TripChecklists } from '@/types/checklists'
import type {
  GearBusyItem,
  GearItem,
  TripGearItem,
  TripGearLoad,
  TripGearLoadUnit,
  TripGearSection,
  TripGearSectionScope,
  TripGearSleeping,
  TripGearStatus,
} from '@/types/gear'
import type { Trip, TripParticipant } from '@/types/trips'
import {
  formatWeight,
  formatWeightTotal,
} from '@/utils/gearWeight'
import { readMyFoodWeight } from '@/utils/myFoodWeight'

/**
 * Вкладка «Снаряжение» похода (код `gear`), первый проход по фронту
 * (05.11.2026).
 *
 * План целиком — `docs/ph/gear-tab.md`. По нему на странице **большие
 * сворачиваемые секции**: общественное снаряжение (цвет темы, заказчик
 * склоняется к красно-коричневому), рекомендации участникам, личное (синее,
 * как у «Питания» и «Спальника») и с 24.11.2026 — отдельная оранжевая
 * «Мой рюкзак» с общественным, личным и словами-подытогами. Внутри —
 * вложенные секции, каждая со своим сворачиванием.
 *
 * **«Список» — с 05.11.2026.** Заказчик описал логику: в общественной
 * секции список общественного снаряжения, между секциями — отдельная
 * «Рекомендации участникам по личным вещам» организатора (внутри
 * общественной она, по словам заказчика, «смотрится некорректно»),
 * в личной секции свой
 * список, где рекомендация стоит отдельным зелёным блоком над личными
 * пунктами, удалить её нельзя, а отметки организатору не возвращаются.
 * Список правит и отмечает тот, кому доступна вкладка; остальные только
 * видят. Пункты можно заводить с нуля или брать из личных чек-листов
 * профиля — конкретная вещь едет экземпляром в личный список и типом
 * в общий и рекомендацию.
 *
 * **Что уже работает на настоящих данных:**
 * - «Берём» — снаряжение похода (`GET /api/trips/:id/gear`). Предложенные
 *   вещи ждут решения, утверждённые стоят сплошными пилюлями, отклонённые
 *   остаются в своих разделах зачёркнутыми (06.11.2026): решение
 *   «не берём» — это отметка, а не удаление вещи. Удалить вещь из похода
 *   может только её владелец: у организатора крестик ставит «не берём»
 *   (`crossItem`). Статус меняет тот, кому роль дала вкладку (`canEdit`),
 *   остальные видят статус словами: права считает сервер.
 * - «Распределение» — плитки-рюкзаки участников со статусом «Идёт»
 *   (`docs/ph/gear-distribution.md` §5). Вещь перетаскивается мышью, а
 *   несущего меняют в карточке вещи тем же полем «Несёт», что и в «Берём»
 *   (06.11.2026) — это путь для телефона, где HTML5-drag не работает.
 *   Назначение — отдельное поле `assignedUserId`, а не смена владельца:
 *   вещь остаётся в каталоге владельца, как и решено в §5.
 * - «Взял» — **личные вещи** (06.11.2026): содержимое секции «Спальник»
 *   из «Ночёвок» в разделе «в палатку» и свои разделы человека. Вещи
 *   похода, назначенные на меня, здесь не показываются: их место —
 *   «Распределение» и «Мой рюкзак», а личное и общественное — разные вещи
 *   (слова заказчика). «Мой рюкзак» — общественное назначенное плюс личное
 *   из «Ночёвок», одним итогом.
 *
 * **Модалка одна на всё приложение.** «Добавить снаряжение» открывает
 * общий `TripGearExtraPicker` (05.11.2026) со своим `storageKey`, «Добавить
 * вручную» — общую `TripGearManualModal`. Копий форм здесь нет: у вкладки
 * свои заголовок, память свёрнутых групп и подпись, а сохранение остаётся
 * этому экрану.
 *
 * **Чат снаряжения — внизу вкладки** (06.11.2026). Как у «Питания»,
 * «Трансфера» и «Ночёвок»: чат — тема вкладки, отдельной закладки «Чаты»
 * в проекте нет (`docs/ph/tabs.md` §7). Вид чата — `trip_gear`, он же
 * заведён миграцией у существующих походов.
 *
 * **Живые обновления — SSE** (06.11.2026). Участники перетасовывают вещи
 * одновременно, и перезагрузка страницы после каждого чужого действия —
 * не ответ. Поток открыт, пока вкладка на экране; событие — сигнал
 * **перечитать** снаряжение или чек-листы, а не готовые данные (ответ
 * зависит от смотрящего: чужие личные разделы в нём обнулены). Своё
 * действие пропускаем по `actorId`: ответ `PATCH` уже применил изменение,
 * а повторный запрос мог бы перетереть более новое локальное состояние.
 *
 * **Цвет общественной секции — временный.** Заказчик ещё не выбрал
 * окончательный оттенок; когда выберет, цвет переедет в тему
 * (`themes.css`), а не останется значением в разметке.
 */
const props = withDefaults(
  defineProps<{
    trip: Trip
    /** Правит ли смотрящий снаряжение: статусы и удаление чужих вещей. */
    canEdit?: boolean
  }>(),
  { canEdit: false },
)

const auth = useAuthStore()

const meId = computed(() => auth.user?.id ?? '')

const items = ref<TripGearItem[]>([])
const participants = ref<TripParticipant[]>([])

/**
 * Разделы «Берём» и «Взял» (05.11.2026).
 *
 * Приходят одним ответом с вещами: пустой раздел — законное состояние,
 * а второй запрос ради заголовков дал бы секции два состояния загрузки.
 * Личные разделы сервер отдаёт только свои — чужих в массиве нет.
 */
const sections = ref<TripGearSection[]>([])

/**
 * Мои личные вещи из «Ночёвок» (06.11.2026): содержимое секции «Спальник».
 *
 * Заказчик: «сюда автоматически должно попадать содержимое секции „Спальник“
 * из Ночёвок — это личное». Строки приходят отдельным массивом: это не вещи
 * похода, они живут в своей таблице и в «Берём» не попадают. Раздел,
 * который их показывает, ищется по коду шаблона: переименованный раздел
 * всё равно остаётся разделом «в палатку».
 */
const sleeping = ref<TripGearSleeping[]>([])

/**
 * Мои личные вещи «Взял» (06.11.2026): одежда, каска, палки.
 *
 * Приходят **той же формой**, что общественные вещи (`TripGearItem`):
 * дерево разделов, карточка и пилюля не знают про второй вид строки.
 * Отличает их только смысл: место — `personalSectionId`, статуса нет,
 * несущий — сам владелец. Поэтому отдельного типа на экране не нужно,
 * а сервер отдаёт их отдельным массивом: в «Берём» и «Распределение»
 * личное не попадает.
 */
const personalItems = ref<TripGearItem[]>([])

/**
 * Раскладка груза `GET /gear/load` (06.11.2026): рюкзаки с весами, пакеты
 * еды из «Питания», доли и личная половина смотрящего.
 *
 * Раньше «Распределение» и «Мой рюкзак» считали вес сами по `items`:
 * пакетов там не было вовсе. Теперь единственный источник цифр — ответ
 * сервера — так после кнопки и после перезагрузки на экране одни и те же
 * числа. `null` — раскладка не загрузилась; тогда экран показывает
 * прежнюю картину по вещам, без пакетов, вместо пустого места.
 */
const loadData = ref<TripGearLoad | null>(null)

const isLoading = ref(true)
const error = ref<string | null>(null)
/** Ошибка действия: её показываем рядом, не закрывая уже загруженный список. */
const actionError = ref<string | null>(null)
/** Состав не загрузился — имена в рюкзаках будут неполными, но экран живёт. */
const peopleError = ref<string | null>(null)

// ───────────────────────────── свёрнутые секции ─────────────────────────────

/**
 * Какие секции вкладки развёрнуты (06.11.2026).
 *
 * Заказчик: «закладка Снаряжения первый раз должна открываться со свёрнутыми
 * секциями, а дальше помнить что развёрнуто и сохранять/воссоздавать при
 * переключении между закладками».
 *
 * Переключение закладок в `TripView` — это `v-if`: компонент вкладки
 * размонтируется, и состояние в памяти до следующего открытия не доживает.
 * Поэтому развёрнутость живёт в `localStorage` **на поход**: у каждого
 * похода своя раскладка, и «Общественное» одного не должно разворачивать
 * «Общественное» другого.
 *
 * Первый раз ключа нет — `{}`, то есть всё свёрнуто. Пишем только известные
 * булевы значения: мусор в хранилище не должен ломать вкладку.
 */
const OPEN_STATE_PREFIX = 'ph.tripGear.open'

const openState = ref<Record<string, boolean>>({})

function openStateKey(tripId: string): string {
  return `${OPEN_STATE_PREFIX}.${tripId}`
}

function readOpenState(tripId: string): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(openStateKey(tripId))
    if (raw === null) return {}

    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}

    const result: Record<string, boolean> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'boolean') result[key] = value
    }

    return result
  } catch {
    // Мусор в localStorage — те же свёрнутые секции, а не пустая вкладка.
    return {}
  }
}

function writeOpenState(tripId: string, state: Record<string, boolean>): void {
  try {
    window.localStorage.setItem(openStateKey(tripId), JSON.stringify(state))
  } catch {
    // Хранилище недоступно (приватный режим, квота) — память секций
    // останется только до перезагрузки. Вкладку это не ломает.
  }
}

watch(
  () => props.trip.id,
  (tripId) => {
    openState.value = readOpenState(tripId)
  },
  { immediate: true },
)

function isSectionOpen(key: string): boolean {
  return openState.value[key] === true
}

/** `<details>` сообщил о свёртывании/развёртывании — запоминаем. */
function onSectionToggle(key: string, event: Event): void {
  const open = (event.target as HTMLDetailsElement).open
  if (openState.value[key] === open) return

  const next = { ...openState.value, [key]: open }
  openState.value = next
  writeOpenState(props.trip.id, next)
}

/** Вещь, по которой идёт запрос: её поля блокируются до ответа. */
const busyId = ref<string | null>(null)
const removingId = ref<string | null>(null)

// ───────────────────────────── «Список»: чек-листы ─────────────────────────────

/**
 * Три списка похода: общественное снаряжение, мой личный и рекомендация
 * организатора. `null` — не загрузились или ещё не заведены; различает
 * это `checklistsLoading`/`checklistsError`.
 */
const checklists = ref<TripChecklists | null>(null)
const checklistsLoading = ref(true)
const checklistsError = ref<string | null>(null)

/** Рекомендация показывается в личной секции, только если в ней что-то есть. */
const hasRecommendation = computed(
  () => (checklists.value?.recommendation?.items.length ?? 0) > 0,
)

/**
 * Инструменты списков спрятаны «⋯» в заголовке секции (06.11.2026).
 *
 * Заказчик: «У нас слишком много текста на экране, нужно ужиматься.
 * Установи спискам крошки» — тот же «⋯», что у разделов в «Берём»,
 * только теперь в `<summary>` самого списка. Свёрнутая строка «Список 1/4»
 * несёт и прогресс, и переключатель, а текстовая ссылка «Скрыть инструменты»
 * ушла: она занимала отдельную строку под заголовком.
 *
 * Состояние у родителя, потому что кнопка живёт в `<summary>` снаружи
 * `TripGearChecklist`. Это способ посмотреть список «как его видят люди»;
 * в localStorage не сохраняем — при следующем открытии вкладки человек
 * снова получает редактор.
 */
const sharedToolsHidden = ref(false)
const personalToolsHidden = ref(false)

/**
 * Прогресс списка для свёрнутой секции (05.11.2026). Заказчик: «в списках
 * частичное выполнение пунктов должно быть видно в свёрнутом виде».
 *
 * Считает родитель, а не `TripGearChecklist`: свёрнутая секция — это
 * внешние `<details>`, и до своего заголовка компонент не дотягивается.
 * В личном списке дробь складывается из рекомендации и своих пунктов —
 * это тоже знание экрана, а не одного чек-листа.
 */
function doneProgress(...lists: (Checklist | null)[]): string {
  const items = lists.flatMap((list) => list?.items ?? [])
  const done = items.filter((item) => item.isDone).length

  return done > 0 ? `${done}/${items.length}` : ''
}

/** Общий список общественного снаряжения. */
const sharedProgress = computed(() => doneProgress(checklists.value?.shared ?? null))

/** Личный список: рекомендация организатора плюс свои пункты. */
const personalProgress = computed(() =>
  doneProgress(checklists.value?.recommendation ?? null, checklists.value?.personal ?? null),
)

/**
 * Компонент вернул изменённый список — кладём его на место.
 *
 * Списки живут одним объектом, потому что приходят одним ответом и
 * перерисовываются вместе; отдельные `ref` на каждый означали бы три
 * способа забыть обновить один из них.
 */
function applyChecklist(
  key: 'shared' | 'personal' | 'recommendation',
  checklist: Checklist | null,
): void {
  checklists.value = {
    shared: null,
    personal: null,
    recommendation: null,
    ...(checklists.value ?? {}),
    [key]: checklist,
  }
}

// ───────────────────────────── личный каталог и модалки ─────────────────────────────

const isPickerOpen = ref(false)
const isManualOpen = ref(false)
/**
 * Куда кладём выбранную вещь: в «Берём» (`shared`) или в раздел «Взял»
 * (`personal`). У модалки выбора одна на оба пути — заказчик просил ту же
 * «Добавить снаряжение», а разница только в ручке сохранения (06.11.2026).
 */
const pickerScope = ref<'shared' | 'personal'>('shared')
/** Раздел «Взял», в который положат следующую личную вещь. */
const personalAddTargetSection = ref<string | null>(null)
const catalog = ref<GearItem[]>([])
/**
 * Вещи каталога, занятые в других походах на даты этого (11.11.2026, шаг 2).
 * Приходят вместе с каталогом (`GET /gear?tripId=`), а не считаются на экране:
 * занятость зависит от дат и от трёх таблиц похода.
 */
const catalogBusy = ref<GearBusyItem[]>([])
const isCatalogLoading = ref(false)
const isCatalogLoaded = ref(false)
const catalogError = ref<string | null>(null)
const isAdding = ref(false)

// ───────────────────────────── производные списки ─────────────────────────────

const approved = computed(() => items.value.filter((item) => item.status === 'approved'))
const proposed = computed(() => items.value.filter((item) => item.status === 'proposed'))
const declined = computed(() => items.value.filter((item) => item.status === 'declined'))

/**
 * Разделы по большим секциям. Общественные видит весь состав, личные
 * сервер отдаёт только свои — поэтому фильтра по владельцу здесь нет.
 */
const sharedSections = computed(() =>
  sections.value.filter((section) => section.scope === 'shared'),
)
const personalSections = computed(() =>
  sections.value.filter((section) => section.scope === 'personal'),
)

/**
 * Код шаблона раздела «в палатку» — тот же, что в бэкенде (06.11.2026).
 *
 * Сверяемся по коду, а не по названию: заказчик переименовывает разделы
 * под себя, и после переименования спальник из «Ночёвок» не должен
 * потерять свой раздел.
 */
const TENT_INSIDE_SECTION_CODE = 'tent_inside'

/**
 * Id строки «Мои продукты» в личной половине раскладки (09.11.2026).
 *
 * В «Питании» это не пакет из базы, а сводка по личным приёмам, поэтому
 * у неё нет своего id. Сервер отдаёт её в списке пакетов с этим
 * договорным id — по нему экран понимает, что вес можно подменить
 * фактическим из отметки человека, а не из расчёта.
 */
const MY_FOOD_PACKAGE_ID = 'my-food'

/** Личный раздел «в палатку» — если он есть у смотрящего. */
const tentInsideSection = computed(
  () =>
    personalSections.value.find(
      (section) =>
        section.templateCode === TENT_INSIDE_SECTION_CODE && section.parentId === null,
    ) ?? null,
)

/**
 * Разделы «Взял», у которых содержимое приходит не из `trip_gear`
 * (06.11.2026): «в палатку» наполняется личным «Спальником» из «Ночёвок».
 * Список нужен дереву разделов, чтобы не подписывать такой раздел «Пусто».
 */
const personalExtraSectionIds = computed(() =>
  tentInsideSection.value !== null && sleeping.value.length > 0
    ? [tentInsideSection.value.id]
    : [],
)

// ───────────────────────────── карточка вещи ─────────────────────────────

/**
 * Пилюля открывает карточку (06.11.2026).
 *
 * Заказчик: «В пилюле отображение полей выбора раздела и выбор
 * „Берём/не берём“ это лишнее, особенно в мобилке. Предлагаю модалку,
 * в которой отображаются все характеристики объекта и эти два поля».
 * Поэтому в списке у вещи остались название, вес и владелец, а решения
 * переехали в `TripGearItemModal` — и заодно перестали быть двумя `select`
 * в каждой строке.
 *
 * Храним id, а не объект: после `PATCH` родитель заменяет строку в `items`,
 * и карточка обязана показать свежую вещь, а не копию, открытую когда-то.
 */
const openedItemId = ref<string | null>(null)
/** Из какой большой секции открыли карточку: от этого зависит поле «Раздел». */
const openedScope = ref<TripGearSectionScope>('shared')

/**
 * Открытая карточка — личная вещь «Взял» (06.11.2026). Решает большая
 * секция, из которой открыли, а не совпадение id: id у `trip_gear`
 * и `trip_personal_gear` независимы, и «5» может быть и там, и там.
 */
const openedIsPersonal = computed(() => openedScope.value === 'personal')

const openedItem = computed(() => {
  if (openedIsPersonal.value) {
    return personalItems.value.find((row) => row.id === openedItemId.value) ?? null
  }

  return (
    items.value.find((row) => row.id === openedItemId.value) ??
    personalItems.value.find((row) => row.id === openedItemId.value) ??
    null
  )
})

function openItem(item: TripGearItem, scope: TripGearSectionScope): void {
  openedItemId.value = item.id
  openedScope.value = scope
}

function closeItem(): void {
  openedItemId.value = null
}

/**
 * Статус выбрали в карточке. Правку делает `patchItem`: он же держит
 * защиту от двойного нажатия и показывает текст ошибки сервера.
 */
async function onItemStatus(status: TripGearStatus): Promise<void> {
  const item = openedItem.value
  if (!item) return
  // У личной вещи статуса нет: её не решают «берём / не берём».
  if (openedIsPersonal.value) return

  await patchItem(item, { status })
}

/** Раздел выбрали в карточке — путь переноса для телефона, где drag не работает. */
async function onItemSection(sectionId: string | null): Promise<void> {
  const item = openedItem.value
  if (!item) return

  if (openedIsPersonal.value) {
    await patchPersonal(item, sectionId)
    return
  }

  await patchItem(
    item,
    openedScope.value === 'shared'
      ? { sharedSectionId: sectionId }
      : { personalSectionId: sectionId },
  )
}

/**
 * Несущего выбрали в карточке (06.11.2026).
 *
 * Заказчик: «раз уж вставил „Несёт Трегубов Сергей“, то давай сразу это
 * будет поле выбора несущего». Право — как у перетаскивания между
 * рюкзаками: назначить вещь может **любой участник**, решает сервер.
 * `null` — освободить вещь: «не распределено» — законное состояние.
 */
async function onItemAssignee(userId: string | null): Promise<void> {
  const item = openedItem.value
  if (!item || openedIsPersonal.value) return

  await patchItem(item, { assignedUserId: userId })
}

async function onItemRemove(): Promise<void> {
  const item = openedItem.value
  if (!item) return

  if (openedIsPersonal.value) {
    await removePersonal(item)
    return
  }

  await remove(item)
}

/**
 * Указатель грубый (палец) — HTML5-drag&drop на нём не работает и не нужен
 * (06.11.2026). Тот же размен, что в «Распределении»: перенос вещи между
 * разделами на телефоне делает поле «Раздел» в карточке.
 *
 * Проверка на `matchMedia` обязательна: в jsdom его нет, а в старых
 * браузерах он не гарантирован — см. `usePwaInstall`.
 */
const isCoarsePointer = ref(
  typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches,
)

/** «Берём» тянет только тот, кому роль дала вкладку. */
const canDragShared = computed(() => props.canEdit && !isCoarsePointer.value)

/**
 * Плоский список разделов в порядке дерева — для выпадающего «Раздел»
 * в пилюле. На телефоне HTML5-drag не работает, а перенести вещь между
 * разделами человек должен с любого устройства.
 */
function sectionChoices(list: TripGearSection[]): { id: string; label: string }[] {
  const result: { id: string; label: string }[] = []

  const walk = (parentId: string | null, depth: number): void => {
    const siblings = list
      .filter((section) => section.parentId === parentId)
      .slice()
      .sort((left, right) => left.sortOrder - right.sortOrder || Number(left.id) - Number(right.id))

    for (const section of siblings) {
      result.push({
        id: section.id,
        label: `${'— '.repeat(depth)}${section.title}`,
      })
      walk(section.id, depth + 1)
    }
  }

  walk(null, 0)

  return result
}

const sharedSectionChoices = computed(() => sectionChoices(sharedSections.value))
const personalSectionChoices = computed(() => sectionChoices(personalSections.value))

/**
 * «Берём» — всё, что решали, включая отклонённое (06.11.2026).
 *
 * Заказчик: «снаряжение, помеченное как „Не берём“ нужно не удалять
 * из секции, а помечать как отвергнутое, перечеркнуть или иной красивый
 * вариант». Поэтому отклонённые вещи остаются на своём месте в разделе,
 * а не уезжают в отдельный свёрнутый блок: организатор снял вещь,
 * а участник должен видеть, где она и почему не едет, и сам решить,
 * убирать ли её из похода. Решение принимает ведущий вкладку, но
 * «не берём» — это отметка, а не удаление.
 */
const taking = computed(() => [...approved.value, ...proposed.value, ...declined.value])

/** Утверждённое без несущего — запасной вид, когда раскладка не пришла. */
const unassignedItems = computed(() =>
  approved.value.filter((item) => item.assignedUserId === null),
)

/** Плитки строятся только по «иду»: «пока не решил» ещё не несёт груз. */
const going = computed(() => participants.value.filter((person) => person.status === 'going'))

/** Общественное, которое несу я: запасной вид «Моего рюкзака». */
const myItems = computed(() =>
  approved.value.filter((item) => item.assignedUserId !== null && item.assignedUserId === meId.value),
)

// ───────────────────────────── вид раскладки ─────────────────────────────

/**
 * Пилюля груза в «Распределении» и «Моём рюкзаке» (06.11.2026).
 *
 * Одно представление на вещь и на пакет еды: у обоих есть название, вес
 * и несущий, а различает их только оформление (пакет — фиолетовый, как
 * в «Питании») и то, что по вещи открывается карточка, а у пакета её нет.
 * `item` — найденная вещь похода: из `GET /gear/load` приходят только id,
 * название и вес, а карточке нужна вся строка.
 */
interface LoadPill {
  key: string
  kind: 'gear' | 'package' | 'firstAid'
  id: string
  title: string
  weightGrams: number | null
  /** Вес известен. У общественной аптечки без веса — `false`. */
  weightKnown: boolean
  item: TripGearItem | null
}

/** Рюкзак участника: общественные вещи, пакеты и итог. */
interface LoadBag {
  userId: string
  person: TripParticipant | null
  gear: LoadPill[]
  packages: LoadPill[]
  weight: string
  /** Итог с сервера: «Общественное» в рюкзаке не досчитывает его на экране. */
  totalWeightGrams: number
}

function itemPill(item: TripGearItem): LoadPill {
  return {
    key: `gear-${item.id}`,
    kind: 'gear',
    id: item.id,
    title: item.title,
    weightGrams: item.weightGrams,
    // У вещи каталога вес либо есть, либо «не указан» — это разные вещи,
    // и «без веса» в рюкзаке по-прежнему показывается.
    weightKnown: true,
    item,
  }
}

function unitPill(unit: TripGearLoadUnit): LoadPill {
  return {
    key: `${unit.kind}-${unit.id}`,
    kind: unit.kind,
    id: unit.id,
    title: unit.title,
    weightGrams: unit.weightGrams,
    // Общественная аптечка без веса: в раскладке она 0, но цифру не рисуем.
    weightKnown: unit.weightKnown !== false,
    item:
      unit.kind === 'gear'
        ? (items.value.find((row) => row.id === unit.id) ?? null)
        : null,
  }
}

/** Нераспределённое: из раскладки, а без неё — по вещам похода. */
const unassignedPills = computed<LoadPill[]>(() => {
  const loaded = loadData.value
  if (loaded) return loaded.unassigned.map(unitPill)

  return unassignedItems.value.map(itemPill)
})

/**
 * Рюкзаки «Распределения». Источник весов — `GET /gear/load`: он один
 * складывает вещи и пакеты «Питания», поэтому после кнопки и после
 * перезагрузки на экране одни и те же числа. Раскладка не пришла —
 * показываем вещи похода, как раньше, но без пакетов.
 */
const bags = computed<LoadBag[]>(() => {
  const loaded = loadData.value

  if (loaded) {
    return loaded.backpacks.map((backpack) => {
      const gear = backpack.gear.map(unitPill)
      const packages = backpack.packages.map(unitPill)
      // Одни неизвестные аптечки — не повод писать «Всего: 0 г»: цифры
      // нет, как и у самой аптечки (слова заказчика 09.11.2026).
      const hasKnownWeight = [...gear, ...packages].some(
        (pill) => pill.weightKnown && (pill.weightGrams ?? 0) > 0,
      )

      return {
        userId: backpack.userId,
        person:
          participants.value.find((person) => person.userId === backpack.userId) ?? null,
        gear,
        packages,
        weight: hasKnownWeight
          ? formatWeightTotal(backpack.totalWeightGrams, 0)
          : '—',
        totalWeightGrams: backpack.totalWeightGrams,
      }
    })
  }

  return going.value.map((person) => {
    const list = approved.value.filter((item) => item.assignedUserId === person.userId)

    return {
      userId: person.userId,
      person,
      gear: list.map(itemPill),
      packages: [],
      weight: weightTotalLabel(list),
      totalWeightGrams: sumWeight(list),
    }
  })
})

/**
 * Есть ли что распределять: вещи похода или пакеты «Питания».
 *
 * Раньше кнопка смотрела только на утверждённые вещи, и поход с одними
 * пакетами еды не мог разложить их автоматически. Теперь тот же ответ
 * `GET /gear/load`, что рисует плитки, говорит и об этом.
 */
const hasDistributable = computed(() =>
  loadData.value
    ? loadData.value.totalWeightGrams > 0 || loadData.value.unassigned.length > 0
    : approved.value.length > 0,
)

/** Моя плитка в «Распределении» — источник «Общественного» в рюкзаке. */
const myLoadBag = computed<LoadBag | null>(() => {
  if (loadData.value) return bags.value.find((bag) => bag.userId === meId.value) ?? null

  return null
})

/** «Общественное» в «Моём рюкзаке»: вещи, пакеты и итог. */
const backpackPublicGear = computed<LoadPill[]>(() =>
  loadData.value
    ? (myLoadBag.value?.gear ?? [])
    : myItems.value.map(itemPill),
)

const backpackPublicPackages = computed<LoadPill[]>(() =>
  loadData.value ? (myLoadBag.value?.packages ?? []) : [],
)

/** Сумма известных весов: строки без веса идут нулём, как считает сервер. */
function sumWeight(rows: Array<{ weightGrams: number | null }>): number {
  return rows.reduce((sum, row) => sum + (row.weightGrams ?? 0), 0)
}

/** Строка рюкзака, у которой вес бывает неизвестен. */
interface BackpackRow {
  weightGrams: number | null
  /** `false` — вес не указан, даже если в раскладке строка идёт нулём. */
  weightKnown?: boolean
}

/** Личная строка рюкзака: вещь «Взял», «Спальник» или личная аптечка. */
interface BackpackPersonalGearRow extends BackpackRow {
  key: string
  id: string
  kind: 'personal' | 'sleeping' | 'firstAid'
  title: string
  weightKnown: boolean
}

/**
 * Взвешена ли строка. У общественной аптечки без веса `weightKnown: false`
 * и `weightGrams: 0` — это не «0 г», а «не взвесили»; у личных вещей
 * и личной аптечки неизвестный вес приходит `null`.
 */
function rowHasWeight(row: BackpackRow): boolean {
  return row.weightKnown !== false && row.weightGrams !== null
}

/**
 * Подытог секции словами (решение заказчика 24.11.2026).
 *
 * Прочерка и «Всего: 0 г» больше нет: пустая секция говорит «груза нет»,
 * секция из одних невзвешенных — «вес не указан», смешанная считает только
 * взвешенные строки и показывает число. `grams` — итог с сервера, если он
 * есть: «Общественное» обязано совпадать с плиткой «Распределения» 1:1.
 */
function sectionSummary(
  title: string,
  rows: BackpackRow[],
  emptyLabel: string,
  unweighedLabel: string,
  grams?: number,
): string {
  if (rows.length === 0) return emptyLabel

  const weighed = rows.filter(rowHasWeight)
  if (weighed.length === 0) return unweighedLabel

  return `${title} ${formatWeight(grams ?? sumWeight(weighed))}`
}

const backpackPublicRows = computed<LoadPill[]>(() => [
  ...backpackPublicGear.value,
  ...backpackPublicPackages.value,
])

/**
 * «Общественное» в «Моём рюкзаке» — 1:1 из моей плитки «Распределения».
 *
 * Вещи и пакеты берутся из того же `GET /gear/load`, а число — из итога
 * плитки (`totalWeightGrams`), а не складывается на экране: иначе две
 * суммы одного груза однажды разошлись бы.
 */
const backpackPublicSummary = computed(() =>
  sectionSummary(
    'Общественное',
    backpackPublicRows.value,
    'Общественного груза нет',
    'Общественное, вес не указан',
    myLoadBag.value?.totalWeightGrams,
  ),
)

/**
 * «Личное» в «Моём рюкзаке» (06.11.2026): свои вещи «Взял», строки
 * «Спальника», личная аптечка и своя еда из «Питания» — с фактическим
 * весом, а если его нет, с расчётным. В распределение личное не входит.
 */
const backpackPersonalGear = computed<BackpackPersonalGearRow[]>(() => {
  const personal = loadData.value?.personal
  if (personal) {
    return personal.gear.map((row) => ({
      key: `${row.kind}-${row.id}`,
      id: row.id,
      kind: row.kind,
      title: row.title,
      weightGrams: row.weightGrams,
      weightKnown: row.weightKnown !== false,
    }))
  }

  return [
    ...personalItems.value.map((item) => ({
      key: `personal-${item.id}`,
      id: item.id,
      kind: 'personal' as const,
      title: item.title,
      weightGrams: item.weightGrams,
      weightKnown: item.weightGrams !== null,
    })),
    ...sleeping.value.map((row) => ({
      key: `sleeping-${row.id}`,
      id: row.id,
      kind: 'sleeping' as const,
      title: row.title,
      weightGrams: row.weightGrams,
      weightKnown: row.weightGrams !== null,
    })),
  ]
})

/** Пакеты личной еды: вес и откуда он — фактический или расчётный. */
const backpackPersonalPackages = computed(() => {
  const rows = loadData.value?.personal?.packages

  if (!rows) return []

  return rows.map((pack) => {
    // «Мои продукты» сервер считает расчётно: фактический вес человек
    // вписывает в «Питании», и живёт он в его браузере, а не в походе
    // (`meals.md` §5.7). Читаем ту же отметку, чтобы рюкзак не спорил
    // с «Питанием» на одном экране.
    if (pack.id !== MY_FOOD_PACKAGE_ID) return pack

    const actual = readMyFoodWeight(props.trip.id, meId.value)

    return actual === null ? pack : { ...pack, weightGrams: actual, isActual: true }
  })
})

const backpackPersonalRows = computed<BackpackRow[]>(() => [
  ...backpackPersonalGear.value,
  ...backpackPersonalPackages.value,
])

const backpackPersonalSummary = computed(() =>
  sectionSummary(
    'Личное',
    backpackPersonalRows.value,
    'Личное ещё не указано',
    'Личное, вес не указан',
  ),
)

/**
 * Итог «Моего рюкзака» в заголовке (09.11.2026, слова — 24.11.2026).
 *
 * Заказчик просил вес, видимый и в свёрнутой секции: «Мой рюкзак 3,8 кг».
 * Считаются те же строки, что показаны внутри, поэтому цифра не расходится
 * с подытогами. Пустой рюкзак говорит «Мой рюкзак пуст», рюкзак из одних
 * невзвешенных — «Мой рюкзак, вес не указан»; смешанный считает только
 * взвешенные.
 */
const backpackSummary = computed(() => {
  const rows = [...backpackPublicRows.value, ...backpackPersonalRows.value]

  if (rows.length === 0) return 'Мой рюкзак пуст'
  if (!rows.some(rowHasWeight)) return 'Мой рюкзак, вес не указан'

  const grams =
    (myLoadBag.value?.totalWeightGrams ?? sumWeight(backpackPublicRows.value)) +
    sumWeight(backpackPersonalRows.value)

  return `Мой рюкзак ${formatWeight(grams)}`
})

/** Есть ли во «Личном» вообще что показать. */
const backpackPersonalEmpty = computed(() => backpackPersonalRows.value.length === 0)

/** Организатору — выбор хозяина для «Добавить вручную», как в «Ночёвках». */
const isOrganizer = computed(() => props.trip.organizerUserId === meId.value)

const manualOwnerOptions = computed(() => {
  if (!isOrganizer.value) return []

  const virtuals = participants.value.filter((person) => person.isVirtual)
  if (virtuals.length === 0) return []

  return [
    { userId: meId.value, displayName: `${auth.user?.displayName ?? 'Я'} (я)` },
    ...virtuals.map((person) => ({
      userId: person.userId,
      displayName: `${person.displayName} (без аккаунта)`,
    })),
  ]
})

/** Название для подписи владельца: состав приходит отдельно от снаряжения. */
function personName(userId: string): string {
  return participants.value.find((person) => person.userId === userId)?.displayName ?? 'Участник'
}

/** Подпись участника в списке «кому»: себя помечаем словом «я». */
function personOptionLabel(person: TripParticipant): string {
  return person.userId === meId.value
    ? `${person.displayName} (я)`
    : person.displayName
}

/** Подпись рюкзака: состав мог не загрузиться — тогда хотя бы имя из вещей. */
function bagPersonLabel(bag: LoadBag): string {
  if (bag.person) return personOptionLabel(bag.person)
  if (bag.userId === meId.value) return `${auth.user?.displayName ?? 'Я'} (я)`

  return personName(bag.userId)
}

/**
 * Кого предложить в поле «Несёт» карточки (06.11.2026).
 *
 * Список — «идущие», как на сервере: назначение «пока не решил»
 * отбивается 400, чтобы вещь не спряталась в чужом статусе. Текущего
 * несущего добавляем, даже если он уже не идёт: иначе `select` показал бы
 * пустое значение, и человек подумал бы, что вещь свободна.
 */
const assigneeChoices = computed(() => {
  const current = openedItem.value?.assignedUserId ?? null
  const people = [...going.value]

  if (current !== null && !people.some((person) => person.userId === current)) {
    const person = participants.value.find((row) => row.userId === current)
    if (person) people.push(person)
  }

  const choices = people.map((person) => ({
    userId: person.userId,
    label: personOptionLabel(person),
  }))

  // Человек мог выйти из похода, а вещь за ним осталась: значение в списке
  // должно быть, иначе `select` показал бы «не распределено» и соврал.
  if (current !== null && !choices.some((choice) => choice.userId === current)) {
    choices.push({ userId: current, label: personName(current) })
  }

  return choices
})

/**
 * Итог по набору вещей той же строкой, что в каталоге: «Всего: 3,2 кг ·
 * без веса: 1». Неизвестный вес не прячем: иначе итог выглядел бы точным.
 *
 * Принимает и вещи похода, и личные строки «Ночёвок»: у обоих есть
 * `weightGrams`, и второй счётчик веса был бы второй формулой.
 */
function weightTotalLabel(list: Array<{ weightGrams: number | null }>): string {
  if (list.length === 0) return '—'

  const withWeight = list.filter((item) => item.weightGrams !== null)
  const total = withWeight.reduce((sum, item) => sum + (item.weightGrams ?? 0), 0)

  return formatWeightTotal(total, list.length - withWeight.length)
}

/** Моя вещь: только владелец удаляет её из похода (06.11.2026). */
function isMyItem(item: TripGearItem): boolean {
  return meId.value !== '' && item.ownerUserId === meId.value
}

/**
 * Крестик в пилюле — владельцу и тому, кто ведёт снаряжение (06.11.2026).
 *
 * Заказчик: «удалить вещь из похода может только владелец. Организатор
 * только предлагает убрать вещь через „не берём“. Крестик отображается
 * владельцам и организаторам, но организаторы по крестику помечают на
 * удаление, а владельцы сразу удаляют».
 *
 * Поэтому у чужой отклонённой вещи организатору крестик уже не нужен:
 * повторная отметка ничего не меняет, а удалять он не вправе.
 */
function canCross(item: TripGearItem): boolean {
  return isMyItem(item) || (props.canEdit && item.status !== 'declined')
}

/** Крестик: владелец удаляет строку, организатор ставит «не берём». */
async function crossItem(item: TripGearItem): Promise<void> {
  if (isMyItem(item)) {
    await remove(item)
    return
  }

  await patchItem(item, { status: 'declined' })
}

// ───────────────────────────── загрузка ─────────────────────────────

/**
 * Счётчик запросов: пока ответ едет, поход могли переключить, и поздний
 * ответ прошлого похода не должен перетереть уже показанный новый.
 */
let requestId = 0

/**
 * Версии «тихих» ответов (06.11.2026). Полная загрузка и ответ чужого
 * события идут параллельно: без версии поздний ответ мог бы перетереть
 * более свежий. Растёт при каждой загрузке — старые ответы отбрасываются.
 */
let gearVersion = 0
let checklistVersion = 0

async function load(): Promise<void> {
  const current = ++requestId

  // Полная загрузка отменяет ответы тихих обновлений: их данные старше.
  gearVersion += 1
  checklistVersion += 1

  isLoading.value = true
  checklistsLoading.value = true
  error.value = null
  actionError.value = null
  peopleError.value = null
  checklistsError.value = null

  try {
    const list = await listTripGear(props.trip.id)
    if (current !== requestId) return

    items.value = list.items
    sections.value = list.sections
    sleeping.value = list.sleeping
    personalItems.value = list.personalItems

    /**
     * Раскладка — отдельным запросом: она считает вес пакетов «Питания»
     * и доли, и её падение не должно закрывать вкладку. Не пришла —
     * «Распределение» покажет прежнюю картину по вещам без пакетов.
     */
    try {
      const loaded = await getTripGearLoad(props.trip.id)
      if (current === requestId) loadData.value = loaded
    } catch {
      if (current === requestId) loadData.value = null
    }

    /**
     * Чек-листы — отдельным запросом: у них свой домен и своя ошибка.
     * Не загрузились — «Берём» и «Распределение» продолжают работать,
     * а на месте «Списка» будет честная подпись.
     */
    try {
      const lists = await listTripChecklists(props.trip.id)
      if (current === requestId) checklists.value = lists
    } catch (problem) {
      if (current === requestId) {
        checklists.value = null
        checklistsError.value =
          problem instanceof ApiError
            ? problem.message
            : 'Чек-листы похода не загрузились'
      }
    }

    // Состав нужен только подписям и плиткам рюкзаков: его падение экран
    // не закрывает — снаряжение важнее имён.
    try {
      participants.value = await listParticipants(props.trip.id)
    } catch {
      if (current === requestId) {
        participants.value = []
        peopleError.value = 'Состав похода не загрузился — имена в рюкзаках могут быть неполными'
      }
    }
  } catch (problem) {
    if (current !== requestId) return

    error.value =
      problem instanceof ApiError ? problem.message : 'Не удалось загрузить снаряжение похода'
  } finally {
    if (current === requestId) {
      isLoading.value = false
      checklistsLoading.value = false
    }
  }
}

watch(() => props.trip.id, load, { immediate: true })

// ───────────────────────────── живые обновления (SSE) ─────────────────────────────

/**
 * Перетасовка идёт пачкой: одно перетаскивание — один `PATCH`, но человек
 * двигает вещи подряд, и на каждое событие ходить на сервер незачем.
 * Пауза склеивает серию в один запрос.
 */
const LIVE_REFRESH_DELAY = 300

let stopLiveEvents: (() => void) | null = null
let gearRefreshTimer: ReturnType<typeof setTimeout> | null = null
let checklistRefreshTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Событие из потока (06.11.2026).
 *
 * **Своё действие больше не пропускаем** (13.11.2026): `actorId` не различает
 * вкладки одного аккаунта, и вторая вкладка «Снаряжения» не обновлялась.
 * Повторный запрос дешевле расходящегося списка, а пауза склеивает серию
 * правок в один.
 *
 * **Чужую вкладку пропускаем** (12.11.2026): канал событий на бэкенде
 * один на поход, и денежные события прилетают в тот же поток. Без явной
 * проверки `scope` «Бухгалтерия» перечитывала бы снаряжение, а «Снаряжение» —
 * расходы, на каждое действие друг друга.
 */
function onLiveEvent(event: TripEvent): void {
  if (event.scope === 'gear') scheduleGearRefresh()
  else if (event.scope === 'checklist') scheduleChecklistRefresh()
}

function scheduleGearRefresh(): void {
  if (gearRefreshTimer !== null) return

  gearRefreshTimer = setTimeout(() => {
    gearRefreshTimer = null
    void refreshGearQuietly()
  }, LIVE_REFRESH_DELAY)
}

function scheduleChecklistRefresh(): void {
  if (checklistRefreshTimer !== null) return

  checklistRefreshTimer = setTimeout(() => {
    checklistRefreshTimer = null
    void refreshChecklistsQuietly()
  }, LIVE_REFRESH_DELAY)
}

/**
 * Перечитать вещи и разделы, не показывая «Загружаем снаряжение…».
 *
 * Ошибку глотаем: живые обновления — удобство, а не данные. Следующее
 * событие или перезагрузка страницы попробует снова, а красная плашка
 * посреди работы из-за чужого перетаскивания только мешала бы.
 */
async function refreshGearQuietly(withLoad = true): Promise<void> {
  if (isLoading.value) return

  const tripId = props.trip.id
  const version = ++gearVersion

  try {
    const list = await listTripGear(tripId)

    // Пока ответ ехал, могли переключить поход или начать полную загрузку.
    if (version !== gearVersion || tripId !== props.trip.id || isLoading.value) return

    items.value = list.items
    sections.value = list.sections
    sleeping.value = list.sleeping
    personalItems.value = list.personalItems
    // Снаряжение пришло — значит связь с сервером есть, и прежняя ошибка
    // загрузки больше не правда.
    error.value = null

    // Пакеты в рюкзаках и доли могли измениться вместе с вещами: чужая
    // правка в «Питании» тоже приходит этим событием.
    if (withLoad) await refreshLoadQuietly()
  } catch {
    // Молча: экран уже показан, поток переподключится сам.
  }
}

/**
 * Пересчитать раскладку тихо (06.11.2026): пакеты, доли и личная половина.
 *
 * Отдельная версия, потому что после смены несущего и правки пакета
 * `GET /gear/load` — единственный источник новых цифр. Ошибку глотаем:
 * экран уже показан, а следующее событие или кнопка попробуют снова.
 */
let loadVersion = 0

async function refreshLoadQuietly(): Promise<void> {
  if (isLoading.value) return

  const tripId = props.trip.id
  const version = ++loadVersion

  try {
    const loaded = await getTripGearLoad(tripId)
    if (version !== loadVersion || tripId !== props.trip.id) return

    loadData.value = loaded
  } catch {
    // Молча — по той же причине, что и у снаряжения.
  }
}

/** Серия быстрых правок — один пересчёт раскладки. */
const LOAD_REFRESH_DELAY = 400
let loadRefreshTimer: ReturnType<typeof setTimeout> | null = null

function scheduleLoadRefresh(): void {
  if (loadRefreshTimer !== null) return

  loadRefreshTimer = setTimeout(() => {
    loadRefreshTimer = null
    void refreshLoadQuietly()
  }, LOAD_REFRESH_DELAY)
}

/**
 * То же для трёх чек-листов: общий, мой личный и рекомендация.
 */
async function refreshChecklistsQuietly(): Promise<void> {
  if (checklistsLoading.value) return

  const tripId = props.trip.id
  const version = ++checklistVersion

  try {
    const lists = await listTripChecklists(tripId)

    if (version !== checklistVersion || tripId !== props.trip.id || checklistsLoading.value) {
      return
    }

    checklists.value = lists
    checklistsError.value = null
  } catch {
    // Молча — по той же причине, что и у снаряжения.
  }
}

/**
 * Поток живёт, пока вкладка на экране. Переключили поход — старый поток
 * закрываем: события чужого похода к этому экрану не относятся.
 */
watch(
  () => props.trip.id,
  (tripId) => {
    stopLiveEvents?.()
    stopLiveEvents = subscribeTripEvents(tripId, onLiveEvent)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  stopLiveEvents?.()
  stopLiveEvents = null

  if (gearRefreshTimer !== null) clearTimeout(gearRefreshTimer)
  if (checklistRefreshTimer !== null) clearTimeout(checklistRefreshTimer)
  if (loadRefreshTimer !== null) clearTimeout(loadRefreshTimer)
  gearRefreshTimer = null
  checklistRefreshTimer = null
  loadRefreshTimer = null
})


// ───────────────────────────── действия ─────────────────────────────

/**
 * Общая правка строки: статус и/или несущий.
 *
 * При ошибке список перерисовывается из прежних данных: `select` уже
 * показал выбранное значение, и без перерисовки экран врал бы, что изменение
 * сохранилось.
 */
/** Что можно поменять одной правкой: права у полей разные, решает сервер. */
interface GearPatch {
  status?: TripGearStatus
  assignedUserId?: string | null
  sharedSectionId?: string | null
  personalSectionId?: string | null
}

async function patchItem(item: TripGearItem, body: GearPatch): Promise<void> {
  if (busyId.value !== null) return

  busyId.value = item.id
  actionError.value = null

  try {
    const updated = await updateTripGear(props.trip.id, item.id, body)
    items.value = items.value.map((row) => (row.id === updated.id ? updated : row))

    // Несущий поменялся — раскладка и доли уже другие.
    if (body.assignedUserId !== undefined) scheduleLoadRefresh()
  } catch (problem) {
    actionError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось сохранить изменение'
    items.value = [...items.value]
  } finally {
    busyId.value = null
  }
}

/**
 * «Автоматически распределить груз» (06.11.2026).
 *
 * Заказчик просил кнопку ещё 21.10.2026, бэкенд готов с 06.11.2026:
 * `POST /gear/auto-distribute` — полный сброс и раскладка заново (своё —
 * владельцу, тяжёлое вперёд, остаток и пакеты — самому свободному, аптечка
 * медику). Кнопка видна тому, кому роль дала вкладку: это решение по
 * составу, как «берём / не берём».
 *
 * После ответа перечитываем `GET /gear`, а не считаем новые назначения
 * сами: пилюли в «Распределении» и карточка вещи должны показывать
 * `assignedUserId`, который записал сервер, а не нашу копию раскладки.
 * Пакеты еды и доли приезжают тем же ответом и появятся на экране
 * следующим шагом.
 */
const isDistributing = ref(false)

async function distributeLoad(): Promise<void> {
  if (isDistributing.value) return

  isDistributing.value = true
  actionError.value = null

  try {
    const distributed = await autoDistributeTripGear(props.trip.id)
    // Ответ кнопки — уже готовая раскладка: лишний `GET /gear/load` не нужен.
    loadData.value = distributed
    await refreshGearQuietly(false)
  } catch (problem) {
    actionError.value =
      problem instanceof ApiError
        ? problem.message
        : 'Не удалось распределить груз автоматически'
  } finally {
    isDistributing.value = false
  }
}

/**
 * Перетаскивание пилюли между рюкзаками.
 *
 * Мышь тянет пилюлю, плитка принимает её на `drop`; на телефоне несущего
 * меняют в карточке вещи — HTML5-drag на касании не работает.
 */
const draggingId = ref<string | null>(null)

/**
 * Что тащим: вещь между рюкзаками (`assign`) или между разделами (`section`).
 * У одного и того же набора пилюль два разных смысла перетаскивания,
 * и без пометки падение в чужую зону сделало бы не то, что ждали.
 */
const draggingKind = ref<'assign' | 'section' | 'personal-section' | null>(null)

function startDrag(item: TripGearItem, event: DragEvent, kind: 'assign' | 'section' = 'assign'): void {
  draggingId.value = item.id
  draggingKind.value = kind

  // Firefox без setData не начинает перетаскивание, даже у draggable-элемента.
  // Данные не читаем: важен сам факт «тащим эту пилюлю».
  event.dataTransfer?.setData('text/plain', item.id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

/** Перетаскивание бросили мимо цели — состояние не должно залипнуть. */
function endDrag(): void {
  draggingId.value = null
  draggingPackageId.value = null
  draggingKind.value = null
}

async function dropOn(userId: string | null): Promise<void> {
  // Пакет еды — такая же единица груза, но живёт в своей ручке.
  if (draggingKind.value === 'assign' && draggingPackageId.value !== null) {
    const packageId = draggingPackageId.value
    draggingPackageId.value = null
    draggingKind.value = null
    await assignPackage(packageId, userId)
    return
  }

  const item = items.value.find((row) => row.id === draggingId.value)
  draggingId.value = null
  draggingKind.value = null

  if (!item || item.assignedUserId === userId) return

  await patchItem(item, { assignedUserId: userId })
}

/**
 * Пакет еды тянут в рюкзак (06.11.2026). Пакеты «Питания» — не вещи похода:
 * у них своя ручка назначения, и открывать по ним карточку вещи нечего.
 */
const draggingPackageId = ref<string | null>(null)

function startPackageDrag(packageId: string, event: DragEvent): void {
  draggingId.value = null
  draggingPackageId.value = packageId
  draggingKind.value = 'assign'

  event.dataTransfer?.setData('text/plain', packageId)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

/** Назначили несущего пакета: сервер отвечает раскладкой целиком. */
async function assignPackage(packageId: string, userId: string | null): Promise<void> {
  actionError.value = null

  try {
    loadData.value = await assignTripGearPackage(props.trip.id, packageId, userId)
  } catch (problem) {
    actionError.value =
      problem instanceof ApiError
        ? problem.message
        : 'Не удалось назначить пакет'
  }
}

// ───────────────────────────── разделы «Берём» и «Взял» ─────────────────────────────

/** Ошибка действия с разделом: показываем рядом, список не закрываем. */
const sectionBusy = ref(false)

/**
 * Раздел, в который положат следующую добавленную вещь. `null` — корень
 * «Берём». `undefined` — добавление начато не из раздела.
 */
const addTargetSection = ref<string | null | undefined>(undefined)

function replaceSection(updated: TripGearSection): void {
  sections.value = sections.value.map((section) =>
    section.id === updated.id ? updated : section,
  )
}

/**
 * Новый раздел. Общий создаёт тот, кому дали вкладку, личный — любой
 * участник; права всё равно проверяет сервер, а ошибку показываем текстом.
 */
async function onCreateSection(
  scope: 'shared' | 'personal',
  payload: { parentId: string | null; title: string },
): Promise<void> {
  if (sectionBusy.value) return

  sectionBusy.value = true
  actionError.value = null

  try {
    const created = await createTripGearSection(props.trip.id, {
      scope,
      title: payload.title,
      parentId: payload.parentId,
    })
    sections.value = [...sections.value, created]
  } catch (problem) {
    actionError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось создать раздел'
  } finally {
    sectionBusy.value = false
  }
}

async function onRenameSection(payload: {
  section: TripGearSection
  title: string
}): Promise<void> {
  if (sectionBusy.value) return

  sectionBusy.value = true
  actionError.value = null

  try {
    replaceSection(
      await updateTripGearSection(props.trip.id, payload.section.id, {
        title: payload.title,
      }),
    )
  } catch (problem) {
    actionError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось переименовать раздел'
  } finally {
    sectionBusy.value = false
  }
}

/**
 * Удаление раздела. Вещи не пропадают: сервер оставляет их в походе,
 * а ссылка на раздел обнуляется — вещь оказывается в корне секции.
 * Поэтому здесь достаточно убрать раздел из памяти.
 */
async function onRemoveSection(section: TripGearSection): Promise<void> {
  if (sectionBusy.value) return

  sectionBusy.value = true
  actionError.value = null

  try {
    await removeTripGearSection(props.trip.id, section.id)

    // Дочерние разделы сервер удаляет каскадом, их вещи высыпаются
    // в корень. Убираем удалённое поддерево и здесь, иначе на экране
    // остались бы разделы, которых уже нет.
    const removed = new Set<string>([section.id])
    let grew = true
    while (grew) {
      grew = false
      for (const row of sections.value) {
        if (row.parentId !== null && removed.has(row.parentId) && !removed.has(row.id)) {
          removed.add(row.id)
          grew = true
        }
      }
    }

    sections.value = sections.value.filter((row) => !removed.has(row.id))

    // Вещи удалённых разделов остались в походе — показываем их в корне,
    // как это сделала база.
    items.value = items.value.map((item) => ({
      ...item,
      sharedSectionId:
        item.sharedSectionId !== null && removed.has(item.sharedSectionId)
          ? null
          : item.sharedSectionId,
      personalSectionId:
        item.personalSectionId !== null && removed.has(item.personalSectionId)
          ? null
          : item.personalSectionId,
    }))
  } catch (problem) {
    actionError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось удалить раздел'
  } finally {
    sectionBusy.value = false
  }
}

/** Перенесли вещь в общественный раздел («Берём») или в его корень. */
async function moveToSharedSection(sectionId: string | null): Promise<void> {
  if (draggingKind.value !== 'section') return

  const item = items.value.find((row) => row.id === draggingId.value)
  draggingId.value = null
  draggingKind.value = null

  if (!item || item.sharedSectionId === sectionId) return

  await patchItem(item, { sharedSectionId: sectionId })
}

/** Перенесли вещь в личный раздел («Взял») или в его корень. */
async function moveToPersonalSection(sectionId: string | null): Promise<void> {
  if (draggingKind.value === 'personal-section') {
    const personal = personalItems.value.find((row) => row.id === draggingId.value)
    draggingId.value = null
    draggingKind.value = null

    if (!personal || personal.personalSectionId === sectionId) return

    await patchPersonal(personal, sectionId)
    return
  }

  if (draggingKind.value !== 'section') return

  const item = items.value.find((row) => row.id === draggingId.value)
  draggingId.value = null
  draggingKind.value = null

  if (!item || item.personalSectionId === sectionId) return

  await patchItem(item, { personalSectionId: sectionId })
}

/**
 * Вещь добавили из раздела — кладём её в этот раздел. Пока вещь едет
 * предложением, раздел ей уже назначен: иначе после добавления она
 * прыгала бы в корень и человек искал бы её глазами.
 */
async function placeCreated(item: TripGearItem): Promise<TripGearItem> {
  const target = addTargetSection.value

  if (target === undefined || target === null) return item

  try {
    return await updateTripGear(props.trip.id, item.id, { sharedSectionId: target })
  } catch (problem) {
    actionError.value =
      problem instanceof ApiError ? problem.message : 'Вещь добавлена, но в раздел не попала'

    return item
  }
}

/** Убрать вещь из похода: строка `trip_gear` уходит, каталог владельца цел. */
async function remove(item: TripGearItem): Promise<void> {
  if (removingId.value !== null) return

  removingId.value = item.id
  actionError.value = null

  try {
    await removeTripGear(props.trip.id, item.id)
    items.value = items.value.filter((row) => row.id !== item.id)
    // Карточка этой вещи больше нечего показывать: закрываем её вместе с вещью.
    if (openedItemId.value === item.id) openedItemId.value = null
  } catch (problem) {
    actionError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось убрать вещь из похода'
  } finally {
    removingId.value = null
  }
}

// ───────────────────────────── личные вещи «Взял» ─────────────────────────────

/**
 * Добавили свою вещь в раздел «Взял» (06.11.2026).
 *
 * Заказчик: «Личные вещи — это то, что помимо общественного: одежда, каска,
 * трекинговые палочки», и у раздела нужна кнопка «Добавить снаряжение
 * в этот раздел». Вещь приходит из личного каталога — того же, что
 * у «Берём», — и сразу встаёт в выбранный личный раздел.
 */
async function addPersonalTo(
  gearItem: GearItem,
  sectionId: string | null,
): Promise<void> {
  if (isAdding.value) return

  isAdding.value = true
  actionError.value = null

  try {
    const created = await addPersonalTripGear(props.trip.id, {
      gearItemId: gearItem.id,
      sectionId,
    })
    personalItems.value = [...personalItems.value, created]
    isPickerOpen.value = false
    pickerScope.value = 'shared'
    scheduleLoadRefresh()
  } catch (problem) {
    actionError.value =
      problem instanceof ApiError
        ? problem.message
        : 'Не удалось добавить личную вещь'
  } finally {
    isAdding.value = false
  }
}

/**
 * Правка личной вещи: только раздел. Статуса и несущего у неё нет —
 * нести её может только владелец, а «берём / не берём» не решается.
 */
async function patchPersonal(item: TripGearItem, sectionId: string | null): Promise<void> {
  if (busyId.value !== null) return

  busyId.value = item.id
  actionError.value = null

  try {
    const updated = await updatePersonalTripGear(props.trip.id, item.id, { sectionId })
    personalItems.value = personalItems.value.map((row) =>
      row.id === updated.id ? updated : row,
    )
    scheduleLoadRefresh()
  } catch (problem) {
    actionError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось перенести вещь'
  } finally {
    busyId.value = null
  }
}

/** Крестик у личной вещи: строка уходит из похода, каталог остаётся. */
async function removePersonal(item: TripGearItem): Promise<void> {
  if (removingId.value !== null) return

  removingId.value = item.id
  actionError.value = null

  try {
    await removePersonalTripGear(props.trip.id, item.id)
    personalItems.value = personalItems.value.filter((row) => row.id !== item.id)
    if (openedItemId.value === item.id) openedItemId.value = null
    scheduleLoadRefresh()
  } catch (problem) {
    actionError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось убрать личную вещь'
  } finally {
    removingId.value = null
  }
}

/**
 * Крестик у строки «Спальника» «Ночёвок». Это одна и та же личная вещь:
 * убираем её из той таблицы, где она живёт, — второй правды не заводим.
 */
async function removeSleepingPill(row: TripGearSleeping): Promise<void> {
  if (removingId.value !== null) return

  removingId.value = row.id
  actionError.value = null

  try {
    await removeRouteSleeping(props.trip.id, row.id)
    sleeping.value = sleeping.value.filter((item) => item.id !== row.id)
    scheduleLoadRefresh()
  } catch (problem) {
    actionError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось убрать вещь из «Спальника»'
  } finally {
    removingId.value = null
  }
}

/** Личная вещь тянется между разделами «Взял» — на мыши. */
function startPersonalDrag(item: TripGearItem, event: DragEvent): void {
  draggingId.value = item.id
  draggingKind.value = 'personal-section'

  event.dataTransfer?.setData('text/plain', item.id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

/**
 * «Добавить снаряжение»: открываем общую модалку, каталог грузим один раз.
 *
 * Пустой каталог не мешает: в модалке остаётся «Добавить вручную» — так
 * в поход попадает вещь, которой дома ещё нет.
 *
 * Кнопка есть и в корне, и в каждом разделе: куда именно положат вещь,
 * помнит `addTargetSection`. Корневая кнопка кладёт в корень.
 */
async function openPickerBase(): Promise<void> {
  isPickerOpen.value = true
  catalogError.value = null
  // Ошибка прошлого действия к новому выбору не относится: иначе она
  // всплывала бы в модалке, которую человек только что открыл.
  actionError.value = null

  if (isCatalogLoaded.value || isCatalogLoading.value) return

  isCatalogLoading.value = true

  try {
    const list = await listGear(props.trip.id)
    catalog.value = pickableGear(list)
    catalogBusy.value = list.busyGear ?? []
    isCatalogLoaded.value = true
  } catch (problem) {
    catalogError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось загрузить личное снаряжение'
    // Модалка закрывается: текст ошибки стоит у кнопки, а не под оверлеем,
    // и повторное нажатие «Добавить снаряжение» попробует ещё раз.
    isPickerOpen.value = false
  } finally {
    isCatalogLoading.value = false
  }
}

async function openPicker(): Promise<void> {
  pickerScope.value = 'shared'
  addTargetSection.value = null
  await openPickerBase()
}

async function openPickerForSection(sectionId: string | null): Promise<void> {
  pickerScope.value = 'shared'
  addTargetSection.value = sectionId
  await openPickerBase()
}

/** «Добавить снаряжение в этот раздел» во «Взял» (06.11.2026). */
async function openPersonalPickerForSection(sectionId: string | null): Promise<void> {
  pickerScope.value = 'personal'
  personalAddTargetSection.value = sectionId
  await openPickerBase()
}

/** Выбрали вещь каталога: в «Берём» — предложение, во «Взял» — личная строка. */
async function onPick(item: GearItem): Promise<void> {
  if (isAdding.value) return

  if (pickerScope.value === 'personal') {
    await addPersonalTo(item, personalAddTargetSection.value)
    return
  }

  isAdding.value = true
  actionError.value = null

  try {
    const created = await proposeTripGear(props.trip.id, item.id)
    const placed = await placeCreated(created)
    items.value = [...items.value, placed]
    isPickerOpen.value = false
    addTargetSection.value = undefined
  } catch (problem) {
    actionError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось добавить вещь в поход'
  } finally {
    isAdding.value = false
  }
}

/** «Добавить вручную»: форма открывается поверх выбора, как в «Ночёвках». */
function openManual(): void {
  isManualOpen.value = true
}

async function onManualCreated(item: TripGearItem): Promise<void> {
  const placed = await placeCreated(item)

  items.value = [...items.value, placed]
  isManualOpen.value = false
  isPickerOpen.value = false
  addTargetSection.value = undefined
}

/**
 * Ручная вещь в личный раздел: модалка в режиме `personal` заводит предмет
 * каталога, а строка «Взял» создаётся той же ручкой, что у выбора из
 * каталога. Так у личной вещи одна модель пути, а не две.
 */
async function onPersonalCatalogCreated(item: GearItem): Promise<void> {
  await addPersonalTo(item, personalAddTargetSection.value)
  isManualOpen.value = false
}

/**
 * Каталог, из которого нельзя взять вещь: то, что уже в походе.
 *
 * В личный раздел не предлагаем ещё и то, что человек уже несёт
 * в «Спальнике»: это та же вещь, и вторая строка задвоила бы её вес.
 */
const excludedIds = computed(() => {
  if (pickerScope.value === 'shared') return items.value.map((item) => item.gearItemId)

  return [
    ...items.value.map((item) => item.gearItemId),
    ...personalItems.value.map((item) => item.gearItemId),
    ...sleeping.value.map((row) => row.gearItemId),
  ]
})
</script>

<template>
  <section class="flex flex-col gap-3" data-test="trip-gear">
    <p v-if="isLoading" class="text-sm text-muted" data-test="gear-loading">
      Загружаем снаряжение…
    </p>

    <p v-else-if="error" class="text-sm text-muted" data-test="gear-error">{{ error }}</p>

    <template v-else>
      <p v-if="actionError" class="text-sm text-red-600" data-test="gear-action-error">
        {{ actionError }}
      </p>

      <p v-if="peopleError" class="text-xs text-muted" data-test="gear-people-error">
        {{ peopleError }}
      </p>

      <!--
        Общественное снаряжение — цвет темы. Заказчик ещё выбирает
        красно-коричневый оттенок, поэтому пока палитра Tailwind; когда
        выберет, цвет переедет в `themes.css` и сюда станет токеном.
      -->
      <details
        :open="isSectionOpen('shared')"
        class="flex flex-col gap-3 rounded-2xl border border-orange-900 bg-orange-100 p-3"
        data-test="gear-public-section"
        @toggle="onSectionToggle('shared', $event)"
      >
        <summary class="cursor-pointer select-none text-sm font-medium text-orange-900">
          Общественное снаряжение
        </summary>

        <!--
          «Список»: что взять вообще, до распределения по людям. Список
          ведёт тот, кому доступна вкладка; остальные только видят его.
        -->
        <details
          :open="isSectionOpen('shared-checklist')"
          class="rounded-xl border border-border bg-white p-3"
          data-test="gear-shared-checklist"
          @toggle="onSectionToggle('shared-checklist', $event)"
        >
          <!--
            Заголовок списка — одной строкой с родным треугольником:
            строчное содержимое и «⋯» абсолютно справа. Блочная обёртка
            внутри `<summary>` отрывала маркер на отдельную строку.
          -->
          <summary class="relative cursor-pointer select-none text-sm font-medium text-text">
            <span
              class="inline-block max-w-full truncate align-bottom"
              :class="canEdit && checklists?.shared ? 'pr-9' : ''"
            >
              Список<span
                v-if="sharedProgress"
                class="ml-1 text-xs font-normal text-muted"
                data-test="gear-shared-progress"
              >{{ sharedProgress }}</span>
            </span>

            <!--
              Инструменты списка — за «⋯», как у разделов «Берём».
              `prevent` не даёт клику заодно свернуть секцию.
            -->
            <button
              v-if="canEdit && checklists?.shared"
              type="button"
              class="absolute right-0 top-1/2 -translate-y-1/2 cursor-pointer rounded-lg border border-border bg-white px-1.5 py-0.5 text-xs text-muted transition-colors hover:border-primary hover:text-text"
              :aria-expanded="!sharedToolsHidden"
              :aria-label="sharedToolsHidden ? 'Показать инструменты' : 'Скрыть инструменты'"
              :title="sharedToolsHidden ? 'Показать инструменты' : 'Скрыть инструменты'"
              data-test="checklist-tools-toggle"
              @click.prevent.stop="sharedToolsHidden = !sharedToolsHidden"
            >
              ⋯
            </button>
          </summary>

          <div class="mt-2">
            <TripGearChecklist
              v-if="checklists"
              :trip-id="trip.id"
              :checklist="checklists.shared"
              scope="trip"
              subtitle="Редактируют только организаторы."
              empty-text="Список общественного снаряжения ещё не завели."
              import-note="В список общественного снаряжения вещи из шаблона попадут названиями типов: «Топор», а не «мой любимый Fixars»."
              :can-manage="canEdit"
              :can-mark="canEdit"
              :can-import="canEdit"
              :tools-hidden="sharedToolsHidden"
              @updated="applyChecklist('shared', $event)"
            />

            <p v-else-if="checklistsLoading" class="text-sm text-muted" data-test="gear-checklists-loading">
              Загружаем чек-листы…
            </p>
            <p v-else class="text-sm text-muted" data-test="gear-checklists-error">
              {{ checklistsError ?? 'Чек-листы похода не загрузились' }}
            </p>
          </div>
        </details>

        <!-- «Берём»: пул вещей похода и решение «берём / не берём» -->
        <details
          :open="isSectionOpen('taking')"
          class="rounded-xl border border-border bg-white p-3"
          data-test="gear-taking"
          @toggle="onSectionToggle('taking', $event)"
        >
          <summary class="cursor-pointer select-none text-sm font-medium text-text">
            Берём
          </summary>

          <div class="mt-2 flex flex-col gap-2">
            <p
              v-if="taking.length === 0 && sharedSections.length === 0"
              class="text-sm text-muted"
              data-test="gear-taking-empty"
            >
              Пока ничего не собрано. Добавь снаряжение из личного каталога или вручную —
              вещь появится здесь.
            </p>

            <!--
              Разделы «Берём» — вложенные, произвольной глубины. Пилюля
              приходит слотом: у «Берём» и «Взял» она разная, и компонент
              дерева не должен знать, что именно в ней стоит.
            -->
            <TripGearSectionList
              :sections="sharedSections"
              :items="taking"
              :parent-id="null"
              scope="shared"
              :can-manage="canEdit"
              :can-place="canEdit"
              :can-add="canEdit"
              open-key-prefix="shared-section"
              :is-section-open="isSectionOpen"
              class="rounded-xl border border-dashed p-2 transition-colors"
              :class="draggingKind === 'section' ? 'border-primary bg-primary/5' : 'border-border bg-surface'"
              data-test="gear-taking-sections"
              @create="onCreateSection('shared', $event)"
              @rename="onRenameSection"
              @remove="onRemoveSection"
              @move="moveToSharedSection"
              @add-to="openPickerForSection"
              @toggle-section="onSectionToggle"
            >
              <template #item="{ item }">
                <!--
                  Пилюля — строка списка, а не форма (06.11.2026): название,
                  вес и владелец. Статус виден оформлением — сплошная
                  «берём», пунктир и курсив «предложено», зачёркнутое
                  «не берём», — а решения «берём / не берём» и раздел
                  переехали в карточку вещи, которая открывается нажатием.
                -->
                <li
                  class="flex cursor-pointer flex-wrap items-center gap-1 rounded-xl border px-2 py-1 text-sm transition-colors hover:border-orange-500"
                  :class="{
                    'border-orange-300 bg-orange-100 text-text': item.status === 'approved',
                    'border-dashed border-orange-300 bg-white italic text-muted':
                      item.status === 'proposed',
                    'border-orange-200 bg-white text-muted line-through opacity-70':
                      item.status === 'declined',
                  }"
                  role="button"
                  tabindex="0"
                  :draggable="canDragShared"
                  :aria-label="`${item.title}: ${TRIP_GEAR_STATUS_LABELS[item.status]}. Открыть карточку вещи`"
                  :title="TRIP_GEAR_STATUS_LABELS[item.status]"
                  :data-status="item.status"
                  :data-test="`gear-taking-item-${item.id}`"
                  @click="openItem(item, 'shared')"
                  @keydown.enter.prevent="openItem(item, 'shared')"
                  @keydown.space.prevent="openItem(item, 'shared')"
                  @dragstart="startDrag(item, $event, 'section')"
                  @dragend="endDrag"
                >
                  <span class="font-medium">{{ item.title }}</span>
                  <span v-if="item.weightGrams !== null" class="text-xs text-muted">
                    {{ formatWeight(item.weightGrams) }}
                  </span>
                  <span class="text-xs text-muted">· {{ personName(item.ownerUserId) }}</span>

                  <!--
                    Крестик — владельцу и ведущему вкладку (06.11.2026).
                    Заказчик: «удалить вещь из похода может только владелец.
                    Организатор только предлагает убрать вещь через „не берём“».
                    Поэтому действие разное: своя вещь уходит из похода,
                    чужая — только зачёркивается отметкой `declined`.
                    `stop` не даёт крестику заодно открыть карточку.
                  -->
                  <button
                    v-if="canCross(item)"
                    type="button"
                    class="ml-auto shrink-0 cursor-pointer border-0 bg-transparent p-0 text-xs text-orange-700 transition-colors hover:text-orange-900 disabled:cursor-not-allowed disabled:opacity-40"
                    :disabled="removingId === item.id || busyId === item.id"
                    :aria-label="
                      isMyItem(item)
                        ? `Убрать «${item.title}» из похода`
                        : `Пометить «${item.title}» как «не берём»`
                    "
                    :title="isMyItem(item) ? 'Убрать из похода' : 'Не берём: вещь останется у владельца'"
                    :data-test="`gear-taking-remove-${item.id}`"
                    @click.stop="crossItem(item)"
                    @keydown.stop
                  >
                    ×
                  </button>
                </li>
              </template>
            </TripGearSectionList>

            <p v-if="catalogError" class="text-xs text-red-600" data-test="gear-catalog-error">
              {{ catalogError }}
            </p>

            <button
              type="button"
              class="cursor-pointer self-start rounded-xl border border-orange-900 bg-orange-900 px-3 py-1.5 text-sm text-white transition-opacity hover:opacity-90"
              data-test="gear-add"
              @click="openPicker()"
            >
              Добавить снаряжение
            </button>
          </div>
        </details>

        <!--
          «Распределение» — плитки-рюкзаки по «иду». Вещь перетаскивается
          мышью, а несущий меняется в карточке вещи (06.11.2026): та же
          модалка, что в «Берём», с полем «Несёт». На телефоне drag&drop
          не бывает, а назначить вещь человек вправе с любого устройства.
        -->
        <details
          :open="isSectionOpen('distribution')"
          class="rounded-xl border border-border bg-white p-3"
          data-test="gear-distribution"
          @toggle="onSectionToggle('distribution', $event)"
        >
          <summary class="cursor-pointer select-none text-sm font-medium text-text">
            Распределение
          </summary>

          <div class="mt-2 flex flex-col gap-2">
            <!--
              Кнопка автораспределения (06.11.2026): бэкенд умеет раскладку
              с 06.11.2026, на экране её не было. Право — у того, кому роль
              дала вкладку: это решение по составу, как «берём / не берём».
              Полный сброс прежних назначений — так задумано
              (`gear-distribution.md` §4).
            -->
            <div
              v-if="canEdit"
              class="flex flex-wrap items-center gap-2"
              data-test="gear-distribute-row"
            >
              <button
                type="button"
                class="cursor-pointer rounded-xl border border-orange-900 bg-orange-900 px-3 py-1.5 text-sm text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                :disabled="isDistributing || !hasDistributable"
                data-test="gear-distribute"
                @click="distributeLoad"
              >
                {{ isDistributing ? 'Распределяем груз…' : 'Распределить груз автоматически' }}
              </button>

              <span class="text-xs text-muted">
                Сбросит прежние назначения и разложит заново: своё — владельцу,
                тяжёлое — сначала мужчинам, пакеты еды — тем, кто ест со всеми,
                аптечка — медику.
              </span>
            </div>

            <p
              v-if="!hasDistributable"
              class="text-sm text-muted"
              data-test="gear-distribution-empty"
            >
              Распределять пока нечего: сначала решите, что берём.
            </p>

            <template v-else>
              <div
                class="rounded-xl border border-dashed p-2 transition-colors"
                :class="draggingId || draggingPackageId ? 'border-primary bg-primary/5' : 'border-border bg-surface'"
                data-test="gear-unassigned"
                @dragover.prevent
                @drop.prevent="dropOn(null)"
              >
                <p class="text-xs font-medium text-muted">
                  Не распределено
                </p>

                <ul v-if="unassignedPills.length > 0" class="mt-1 flex flex-wrap gap-1.5">
                  <li
                    v-for="pill in unassignedPills"
                    :key="pill.key"
                    class="flex flex-wrap items-center gap-1 rounded-xl border px-2 py-1 text-sm transition-colors"
                    :class="
                      pill.kind === 'package'
                        ? 'cursor-grab border-violet-300 bg-violet-100 text-violet-900 hover:border-violet-500'
                        : 'cursor-pointer border-border bg-white hover:border-primary'
                    "
                    :role="pill.item ? 'button' : undefined"
                    :tabindex="pill.item ? 0 : undefined"
                    :draggable="pill.kind !== 'firstAid'"
                    :aria-label="
                      pill.item
                        ? `${pill.title}. Открыть карточку вещи и сменить несущего`
                        : undefined
                    "
                    :title="
                      pill.kind === 'firstAid'
                        ? 'Общественная аптечка: её место у доктора'
                        : pill.item
                          ? 'Открыть карточку вещи'
                          : 'Пакет еды из «Питания»'
                    "
                    :data-test="
                      pill.kind === 'package'
                        ? `gear-unassigned-package-${pill.id}`
                        : pill.kind === 'firstAid'
                          ? `gear-unassigned-first-aid-${pill.id}`
                          : `gear-unassigned-item-${pill.id}`
                    "
                    @click="pill.item ? openItem(pill.item, 'shared') : undefined"
                    @keydown.enter.prevent="pill.item ? openItem(pill.item, 'shared') : undefined"
                    @keydown.space.prevent="pill.item ? openItem(pill.item, 'shared') : undefined"
                    @dragstart="
                      pill.kind === 'package'
                        ? startPackageDrag(pill.id, $event)
                        : pill.item
                          ? startDrag(pill.item, $event)
                          : undefined
                    "
                    @dragend="endDrag"
                  >
                    <span class="font-medium">{{ pill.title }}</span>
                    <span v-if="pill.weightKnown && pill.weightGrams !== null" class="text-xs text-muted">
                      {{ formatWeight(pill.weightGrams) }}
                    </span>
                    <span
                      v-if="pill.kind === 'package'"
                      class="text-xs text-violet-700"
                    >· еда</span>
                    <span
                      v-else-if="pill.item"
                      class="text-xs text-muted"
                    >· {{ personName(pill.item.ownerUserId) }}</span>
                  </li>
                </ul>

                <p v-else class="mt-1 text-xs text-muted">Всё разобрано по рюкзакам.</p>
              </div>

              <p
                v-if="going.length === 0"
                class="text-sm text-muted"
                data-test="gear-going-empty"
              >
                В походе пока никто не идёт — распределять не между кем.
              </p>

              <div v-else class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                <div
                  v-for="bag in bags"
                  :key="bag.userId"
                  class="flex flex-col gap-1 rounded-xl border bg-white p-2 transition-colors"
                  :class="bag.userId === meId ? 'border-primary' : 'border-border'"
                  :data-test="`gear-bag-${bag.userId}`"
                  @dragover.prevent
                  @drop.prevent="dropOn(bag.userId)"
                >
                  <div class="flex items-baseline justify-between gap-2">
                    <span class="truncate text-sm font-medium text-text">
                      {{ bagPersonLabel(bag) }}
                    </span>
                    <span class="shrink-0 text-xs text-muted">{{ bag.weight }}</span>
                  </div>

                  <ul
                    v-if="bag.gear.length > 0 || bag.packages.length > 0"
                    class="flex flex-col gap-1"
                  >
                    <li
                      v-for="pill in bag.gear"
                      :key="pill.key"
                      class="flex flex-wrap items-center gap-1 rounded-lg border px-2 py-1 text-sm transition-colors"
                      :class="
                        pill.kind === 'firstAid'
                          ? 'border-orange-300 bg-orange-50 text-orange-900'
                          : 'cursor-pointer border-border bg-surface hover:border-primary'
                      "
                      :role="pill.kind === 'firstAid' ? undefined : 'button'"
                      :tabindex="pill.kind === 'firstAid' ? undefined : 0"
                      :draggable="pill.kind !== 'firstAid'"
                      :aria-label="
                        pill.kind === 'firstAid'
                          ? 'Общественная аптечка у доктора'
                          : `${pill.title}. Открыть карточку вещи и сменить несущего`
                      "
                      :title="
                        pill.kind === 'firstAid'
                          ? 'Общественная аптечка: её место у доктора'
                          : 'Открыть карточку вещи'
                      "
                      :data-test="
                        pill.kind === 'firstAid'
                          ? `gear-bag-first-aid-${pill.id}`
                          : `gear-bag-item-${pill.id}`
                      "
                      @click="pill.item ? openItem(pill.item, 'shared') : undefined"
                      @keydown.enter.prevent="pill.item ? openItem(pill.item, 'shared') : undefined"
                      @keydown.space.prevent="pill.item ? openItem(pill.item, 'shared') : undefined"
                      @dragstart="pill.item ? startDrag(pill.item, $event) : undefined"
                      @dragend="endDrag"
                    >
                      <span class="min-w-0 truncate">{{ pill.title }}</span>
                      <span
                        v-if="pill.weightKnown && pill.weightGrams !== null"
                        class="text-xs text-muted"
                      >
                        {{ formatWeight(pill.weightGrams) }}
                      </span>
                    </li>

                    <!--
                      Пакеты еды — фиолетовые, как в «Питании»: той же
                      вкладкой их и собирали. Неделимы и перетаскиваются
                      в чужой рюкзак так же, как вещь.
                    -->
                    <li
                      v-for="pill in bag.packages"
                      :key="pill.key"
                      class="flex cursor-grab flex-wrap items-center gap-1 rounded-lg border border-violet-300 bg-violet-100 px-2 py-1 text-sm text-violet-900 transition-colors hover:border-violet-500"
                      draggable="true"
                      title="Пакет еды из «Питания»"
                      :data-test="`gear-bag-package-${pill.id}`"
                      @dragstart="startPackageDrag(pill.id, $event)"
                      @dragend="endDrag"
                    >
                      <span class="min-w-0 truncate">{{ pill.title }}</span>
                      <span class="text-xs">· {{ formatWeight(pill.weightGrams) }}</span>
                    </li>
                  </ul>

                  <p v-else class="text-xs text-muted">Ничего не назначено</p>
                </div>
              </div>
            </template>
          </div>
        </details>
      </details>

      <!--
        «Рекомендации участникам по личным вещам» — отдельная секция между
        общественным и личным снаряжением (05.11.2026). Заказчик: внутри
        «Общественного снаряжения» она «смотрится некорректно», хотя её
        и видит только организатор. Пункты попадают участнику в личный
        «Список» зелёным блоком, отметки у каждого свои и организатору
        не возвращаются. Пустая рекомендация в личный список не попадает
        (`hasRecommendation`): совет без советов — лишняя строка.
      -->
      <details
        v-if="isOrganizer"
        :open="isSectionOpen('recommendation')"
        class="flex flex-col gap-3 rounded-2xl border border-emerald-300 bg-emerald-100 p-3"
        data-test="gear-recommendation-section"
        @toggle="onSectionToggle('recommendation', $event)"
      >
        <summary class="cursor-pointer select-none text-sm font-medium text-emerald-900">
          Рекомендации участникам по личным вещам
        </summary>

        <div class="rounded-xl border border-border bg-white p-3">
          <TripGearChecklist
            v-if="checklists"
            :trip-id="trip.id"
            :checklist="checklists.recommendation"
            scope="recommendation"
            subtitle="Рекомендация добавляется каждому участнику в личный список. Выполнение на его совести."
            empty-text="Рекомендации личных вещей ещё нет."
            import-note="В рекомендацию вещи из шаблона попадут названиями типов: «Топор», а не «Топор Fixars»."
            :can-manage="true"
            :can-import="true"
            @updated="applyChecklist('recommendation', $event)"
          />

          <p v-else-if="checklistsLoading" class="text-sm text-muted" data-test="gear-checklists-loading">
            Загружаем чек-листы…
          </p>
          <p v-else class="text-sm text-muted" data-test="gear-checklists-error">
            {{ checklistsError ?? 'Чек-листы похода не загрузились' }}
          </p>
        </div>
      </details>

      <!-- Личное снаряжение — синее, как «Питание» и «Спальник» -->
      <details
        :open="isSectionOpen('personal')"
        class="flex flex-col gap-3 rounded-2xl border border-blue-300 bg-blue-100 p-3"
        data-test="gear-personal-section"
        @toggle="onSectionToggle('personal', $event)"
      >
        <summary class="cursor-pointer select-none text-sm font-medium text-blue-900">
          Личное снаряжение
        </summary>

        <!--
          «Список» личной секции: сверху рекомендация организатора
          отдельным зелёным блоком, ниже — свои пункты. Рекомендацию
          нельзя убрать, отметки у каждого свои, а прогресс в свёрнутой
          секции считает обе части вместе — так видно, как идут сборы
          по всем личным вещам, а не только по своим.
        -->
        <details
          :open="isSectionOpen('personal-checklist')"
          class="rounded-xl border border-border bg-white p-3"
          data-test="gear-personal-checklist"
          @toggle="onSectionToggle('personal-checklist', $event)"
        >
          <summary class="relative cursor-pointer select-none text-sm font-medium text-text">
            <span
              class="inline-block max-w-full truncate align-bottom"
              :class="checklists?.personal ? 'pr-9' : ''"
            >
              Список<span
                v-if="personalProgress"
                class="ml-1 text-xs font-normal text-muted"
                data-test="gear-personal-progress"
              >{{ personalProgress }}</span>
            </span>

            <button
              v-if="checklists?.personal"
              type="button"
              class="absolute right-0 top-1/2 -translate-y-1/2 cursor-pointer rounded-lg border border-border bg-white px-1.5 py-0.5 text-xs text-muted transition-colors hover:border-primary hover:text-text"
              :aria-expanded="!personalToolsHidden"
              :aria-label="personalToolsHidden ? 'Показать инструменты' : 'Скрыть инструменты'"
              :title="personalToolsHidden ? 'Показать инструменты' : 'Скрыть инструменты'"
              data-test="checklist-tools-toggle"
              @click.prevent.stop="personalToolsHidden = !personalToolsHidden"
            >
              ⋯
            </button>
          </summary>

          <div class="mt-2 flex flex-col gap-3">
            <template v-if="checklists">
              <TripGearChecklist
                v-if="hasRecommendation"
                :trip-id="trip.id"
                :checklist="checklists.recommendation"
                scope="recommendation"
                variant="recommended"
                heading="Рекомендовано организатором"
                subtitle="Не удаляется: это совет, а не твой личный пункт. Отметку видишь только ты — организатору она не возвращается."
                :can-mark="true"
                @updated="applyChecklist('recommendation', $event)"
              />

              <TripGearChecklist
                :trip-id="trip.id"
                :checklist="checklists.personal"
                scope="personal"
                heading="Мои личные вещи"
                subtitle="Этот список видишь только ты. Можно добавить пункты или взять их из своих чек-листов."
                empty-text="Личного списка ещё нет — заведи его и добавь вещи."
                import-note="В личный список вещи из шаблона попадут конкретными экземплярами — как они записаны в каталоге."
                :can-manage="true"
                :can-mark="true"
                :can-import="true"
                :tools-hidden="personalToolsHidden"
                @updated="applyChecklist('personal', $event)"
              />
            </template>

            <p v-else-if="checklistsLoading" class="text-sm text-muted" data-test="gear-checklists-loading">
              Загружаем чек-листы…
            </p>
            <p v-else class="text-sm text-muted" data-test="gear-checklists-error">
              {{ checklistsError ?? 'Чек-листы похода не загрузились' }}
            </p>
          </div>
        </details>

        <!--
          «Взял» — только личные вещи (06.11.2026).
          Заказчик: «Ты переносишь общественное снаряжение, предложенное
          участником, в раздел его личных вещей. Это не верно в корне.
          Личные вещи — это то, что помимо общественного: одежда, каска,
          трекинговые палочки. Сюда автоматически должно попадать содержимое
          секции „Спальник“ из „Ночёвок“ — это личное».
          Поэтому вещи похода, назначенные на меня, остаются в «Распределении»
          и «Моём рюкзаке», а здесь — личные строки из «Спальника».
        -->
        <details
          :open="isSectionOpen('taken')"
          class="rounded-xl border border-border bg-white p-3"
          data-test="gear-taken"
          @toggle="onSectionToggle('taken', $event)"
        >
          <summary class="cursor-pointer select-none text-sm font-medium text-text">
            Взял
          </summary>

          <div class="mt-2 flex flex-col gap-2">
            <p
              v-if="sleeping.length === 0 && personalItems.length === 0 && personalSections.length === 0"
              class="text-sm text-muted"
              data-test="gear-taken-empty"
            >
              Личных вещей пока нет: спальник и коврик появятся из «Ночёвок»,
              а одежду, каску и палки добавь кнопкой ниже.
            </p>

            <!--
              Запасной путь: раздел «в палатку» удалили — личные вещи
              не должны пропасть с экрана. Строки «Спальника» всё равно
              приходят, и их место — корень «Взял».
            -->
            <ul
              v-if="sleeping.length > 0 && tentInsideSection === null"
              class="flex flex-wrap gap-1.5"
              data-test="gear-taken-sleeping-root"
            >
              <li
                v-for="row in sleeping"
                :key="row.id"
                class="flex flex-wrap items-center gap-1 rounded-full border border-blue-300 bg-white px-2 py-1 text-sm text-blue-900"
                :data-test="`gear-taken-sleeping-${row.id}`"
              >
                <span>{{ row.title }}</span>
                <span v-if="row.weightGrams !== null" class="text-xs">
                  · {{ formatWeight(row.weightGrams) }}
                </span>
                <span class="text-xs text-blue-700">· {{ row.typeName }}</span>

                <!--
                  Крестик у личной вещи (06.11.2026). У «Спальника» он
                  убирает строку из той же таблицы, что и «Ночёвки»:
                  это одна вещь, и второй правды не заводим.
                -->
                <button
                  type="button"
                  class="ml-1 shrink-0 cursor-pointer border-0 bg-transparent p-0 text-xs text-blue-700 transition-colors hover:text-blue-900 disabled:cursor-not-allowed disabled:opacity-40"
                  :disabled="removingId === row.id"
                  :aria-label="`Убрать «${row.title}» из личных вещей`"
                  title="Убрать из личных вещей"
                  :data-test="`gear-taken-remove-sleeping-${row.id}`"
                  @click.stop="removeSleepingPill(row)"
                >
                  ×
                </button>
              </li>
            </ul>

            <!--
              Личные разделы «Взял»: «в палатку», «Одежда», «Снаряга» и что
              человек добавит сам. Остальным они не видны — сервер их
              не отдаёт. С 06.11.2026 у каждого раздела есть кнопка
              «Добавить снаряжение в этот раздел», а у пилюль — крестик.
            -->
            <TripGearSectionList
              :sections="personalSections"
              :items="personalItems"
              :parent-id="null"
              scope="personal"
              :can-manage="true"
              :can-place="true"
              :can-add="true"
              :extra-ids="personalExtraSectionIds"
              open-key-prefix="personal-section"
              :is-section-open="isSectionOpen"
              class="rounded-xl border border-dashed p-2 transition-colors"
              :class="draggingKind === 'personal-section' ? 'border-primary bg-primary/5' : 'border-blue-200 bg-blue-50'"
              data-test="gear-taken-sections"
              @create="onCreateSection('personal', $event)"
              @rename="onRenameSection"
              @remove="onRemoveSection"
              @move="moveToPersonalSection"
              @add-to="openPersonalPickerForSection"
              @toggle-section="onSectionToggle"
            >
              <template #item="{ item }">
                <li
                  class="flex flex-wrap items-center gap-1 rounded-full border border-blue-300 bg-white px-2 py-1 text-sm text-blue-900 transition-colors hover:border-blue-500"
                  role="button"
                  tabindex="0"
                  draggable="true"
                  :aria-label="`${item.title}. Открыть карточку личной вещи`"
                  :data-test="`gear-taken-personal-${item.id}`"
                  @click="openItem(item, 'personal')"
                  @keydown.enter.prevent="openItem(item, 'personal')"
                  @keydown.space.prevent="openItem(item, 'personal')"
                  @dragstart="startPersonalDrag(item, $event)"
                  @dragend="endDrag"
                >
                  <span>{{ item.title }}</span>
                  <span v-if="item.weightGrams !== null" class="text-xs">
                    · {{ formatWeight(item.weightGrams) }}
                  </span>
                  <span class="text-xs text-blue-700">· {{ item.typeName }}</span>

                  <button
                    type="button"
                    class="ml-1 shrink-0 cursor-pointer border-0 bg-transparent p-0 text-xs text-blue-700 transition-colors hover:text-blue-900 disabled:cursor-not-allowed disabled:opacity-40"
                    :disabled="removingId === item.id"
                    :aria-label="`Убрать «${item.title}» из личных вещей`"
                    title="Убрать из личных вещей"
                    :data-test="`gear-taken-remove-${item.id}`"
                    @click.stop="removePersonal(item)"
                    @keydown.stop
                  >
                    ×
                  </button>
                </li>
              </template>

              <template #sectionExtra="{ section }">
                <!--
                  «в палатку» — содержимое секции «Спальник» «Ночёвок».
                  Раздел ищется по коду шаблона, поэтому переименование
                  не прячет личные вещи. Крестик убирает строку там, где
                  она живёт, — во «Спальнике».
                -->
                <ul
                  v-if="section.templateCode === TENT_INSIDE_SECTION_CODE && sleeping.length > 0"
                  class="flex flex-wrap gap-1.5"
                  data-test="gear-taken-sleeping"
                >
                  <li
                    v-for="row in sleeping"
                    :key="row.id"
                    class="flex flex-wrap items-center gap-1 rounded-full border border-blue-300 bg-white px-2 py-1 text-sm text-blue-900"
                    :data-test="`gear-taken-sleeping-${row.id}`"
                  >
                    <span>{{ row.title }}</span>
                    <span v-if="row.weightGrams !== null" class="text-xs">
                      · {{ formatWeight(row.weightGrams) }}
                    </span>
                    <span class="text-xs text-blue-700">· {{ row.typeName }}</span>

                    <button
                      type="button"
                      class="ml-1 shrink-0 cursor-pointer border-0 bg-transparent p-0 text-xs text-blue-700 transition-colors hover:text-blue-900 disabled:cursor-not-allowed disabled:opacity-40"
                      :disabled="removingId === row.id"
                      :aria-label="`Убрать «${row.title}» из личных вещей`"
                      title="Убрать из личных вещей"
                      :data-test="`gear-taken-remove-sleeping-${row.id}`"
                      @click.stop="removeSleepingPill(row)"
                    >
                      ×
                    </button>
                  </li>
                </ul>
              </template>
            </TripGearSectionList>

            <button
              type="button"
              class="cursor-pointer self-start rounded-xl border border-blue-900 bg-blue-900 px-3 py-1.5 text-sm text-white transition-opacity hover:opacity-90"
              data-test="gear-taken-add"
              @click="openPersonalPickerForSection(null)"
            >
              Добавить снаряжение
            </button>
          </div>
        </details>

      </details>

      <!--
        «Мой рюкзак» — четвёртая большая секция «Снаряжения» (24.11.2026).
        Заказчик: вынести её из «Личного снаряжения» отдельной большой
        секцией, цвет — оранжевый, как у общественной. «Общественное» —
        1:1 из моей плитки «Распределения» (вещи и пакеты еды), «Личное» —
        свои вещи «Взял», строки «Спальника», личная аптечка и личная еда
        «Питания». Подытоги — словами: пусто, «вес не указан», иначе
        «{} кг» по взвешенным строкам. Ключ свёрнутости остался `backpack`,
        поэтому привычка с прошлых версий не сбрасывается.
      -->
      <details
        :open="isSectionOpen('backpack')"
        class="flex flex-col gap-3 rounded-2xl border border-orange-900 bg-orange-100 p-3"
        data-test="gear-backpack"
        @toggle="onSectionToggle('backpack', $event)"
      >
        <summary class="cursor-pointer select-none text-sm font-medium text-orange-900">
          <span
            class="inline-block max-w-full truncate align-bottom"
            data-test="gear-backpack-total"
          >{{ backpackSummary }}</span>
        </summary>

        <div class="flex flex-col gap-2">
          <!--
            «Общественное» — ровно моя плитка «Распределения»: те же вещи
            с несущим «я», те же пакеты еды и тот же итог с сервера.
            Ничего не досчитываем: числа приходят из `GET /gear/load`.
          -->
          <details
            :open="isSectionOpen('backpack-public')"
            class="rounded-xl border border-orange-300 bg-white p-2"
            data-test="gear-backpack-public"
            @toggle="onSectionToggle('backpack-public', $event)"
          >
            <summary class="relative cursor-pointer select-none text-sm font-medium text-orange-900">
              <span
                class="inline-block max-w-full truncate align-bottom"
              >{{ backpackPublicSummary }}</span>
            </summary>

            <div class="mt-2 flex flex-col gap-1">
              <p
                v-if="backpackPublicRows.length === 0"
                class="text-sm text-muted"
                data-test="gear-backpack-public-empty"
              >
                Общественного груза за тобой нет.
              </p>

              <ul v-else class="flex flex-col gap-1">
                <li
                  v-for="pill in backpackPublicGear"
                  :key="pill.key"
                  class="flex items-baseline justify-between gap-2 rounded-lg border border-border bg-white px-2 py-1 text-sm"
                  :data-test="`gear-backpack-item-${pill.id}`"
                >
                  <span class="min-w-0 truncate">{{ pill.title }}</span>
                  <!--
                    Невзвешенная вещь и аптечка без веса подписаны словами
                    (24.11.2026): «0 г» у аптечки читался бы как вес,
                    а прочерк скрывал бы, что вещь не взвесили.
                  -->
                  <span class="shrink-0 text-xs text-muted">
                    {{
                      rowHasWeight(pill)
                        ? formatWeight(pill.weightGrams)
                        : 'вес не указан'
                    }}
                  </span>
                </li>

                <li
                  v-for="pill in backpackPublicPackages"
                  :key="pill.key"
                  class="flex items-baseline justify-between gap-2 rounded-lg border border-violet-300 bg-violet-100 px-2 py-1 text-sm text-violet-900"
                  :data-test="`gear-backpack-package-${pill.id}`"
                >
                  <span class="min-w-0 truncate">{{ pill.title }}</span>
                  <span class="shrink-0 text-xs">· {{ formatWeight(pill.weightGrams) }}</span>
                </li>
              </ul>
            </div>
          </details>

          <!--
            «Личное» — свои вещи «Взял», «Спальник» «Ночёвок», личная
            аптечка и личная еда. Личная аптечка без веса теперь тоже
            здесь и подписана «вес не указан» (24.11.2026).
          -->
          <details
            :open="isSectionOpen('backpack-personal')"
            class="rounded-xl border border-blue-200 bg-blue-50 p-2"
            data-test="gear-backpack-personal"
            @toggle="onSectionToggle('backpack-personal', $event)"
          >
            <summary class="relative cursor-pointer select-none text-sm font-medium text-blue-900">
              <span
                class="inline-block max-w-full truncate align-bottom"
              >{{ backpackPersonalSummary }}</span>
            </summary>

            <div class="mt-2 flex flex-col gap-1">
              <p
                v-if="backpackPersonalEmpty"
                class="text-sm text-muted"
                data-test="gear-backpack-personal-empty"
              >
                Личных вещей и личной еды нет.
              </p>

              <ul v-else class="flex flex-col gap-1">
                <li
                  v-for="row in backpackPersonalGear"
                  :key="row.key"
                  class="flex items-baseline justify-between gap-2 rounded-lg border border-blue-200 bg-white px-2 py-1 text-sm"
                  :data-test="`gear-backpack-${row.kind}-${row.id}`"
                >
                  <span class="min-w-0 truncate">{{ row.title }}</span>
                  <span class="shrink-0 text-xs text-muted">
                    {{ rowHasWeight(row) ? formatWeight(row.weightGrams) : 'вес не указан' }}
                  </span>
                </li>

                <!--
                  Личная еда: вес фактический, если пакет взвешен и состав
                  не менялся, иначе расчётный — заказчик просил показывать
                  оба и называть, какой именно.
                -->
                <li
                  v-for="pack in backpackPersonalPackages"
                  :key="`personal-package-${pack.id}`"
                  class="flex items-baseline justify-between gap-2 rounded-lg border border-blue-200 bg-white px-2 py-1 text-sm"
                  :data-test="`gear-backpack-personal-package-${pack.id}`"
                >
                  <span class="min-w-0 truncate">{{ pack.name }}</span>
                  <span class="shrink-0 text-xs text-muted">
                    <span class="text-blue-700">{{ pack.isActual ? 'факт' : 'расчёт' }} · </span>
                    {{ formatWeight(pack.weightGrams) }}
                  </span>
                </li>
              </ul>
            </div>
          </details>
        </div>
      </details>
    </template>

    <!--
      Чат снаряжения — тема вкладки, как у «Питания», «Трансфера»
      и «Ночёвок» (06.11.2026). Отдельной закладки «Чаты» в проекте нет,
      поэтому обсуждение вещей живёт здесь, внизу страницы, и не
      перекрывает работу: сначала список и рюкзаки, потом разговор о них.
    -->
    <TripChat :trip-id="trip.id" kind="trip_gear" />

    <!--
      Карточка вещи: всё, что известно о вещи, плюс решения — несущий,
      раздел и «берём / не берём». Открывается из «Берём» и
      «Распределения»; в «Ночёвках» та же карточка живёт через
      `TripGearItemCard`.
    -->
    <TripGearItemModal
      v-if="openedItem"
      :item="openedItem"
      :scope="openedScope"
      :section-choices="
        openedScope === 'shared' ? sharedSectionChoices : personalSectionChoices
      "
      :owner-name="personName(openedItem.ownerUserId)"
      :assignee-name="openedItem.assignedUserId ? personName(openedItem.assignedUserId) : null"
      :assignee-choices="assigneeChoices"
      :can-assign="openedScope === 'shared' && !openedIsPersonal"
      :can-decide="canEdit && openedScope === 'shared' && !openedIsPersonal"
      :can-place="openedScope === 'shared' ? canEdit : true"
      :can-remove="openedIsPersonal ? true : isMyItem(openedItem)"
      :hide-assignee="openedIsPersonal"
      :hide-status="openedIsPersonal"
      :busy="busyId === openedItem.id || removingId === openedItem.id"
      @status="onItemStatus"
      @assignee="onItemAssignee"
      @section="onItemSection"
      @remove="onItemRemove"
      @close="closeItem"
    />

    <TripGearExtraPicker
      v-if="isPickerOpen"
      :items="catalog"
      :exclude-ids="excludedIds"
      :busy="catalogBusy"
      :loading="isCatalogLoading"
      :error="actionError"
      title="Добавить снаряжение"
      storage-key="ph.tripGear.picker"
      @pick="onPick"
      @manual="openManual"
      @close="isPickerOpen = false"
    />

    <TripGearManualModal
      v-if="isManualOpen"
      :trip-id="trip.id"
      :type-codes="[]"
      default-type-code=""
      :mode="pickerScope === 'personal' ? 'personal' : 'trip'"
      :owner-options="manualOwnerOptions"
      @created="onManualCreated"
      @created-personal="onPersonalCatalogCreated"
      @close="isManualOpen = false"
    />
  </section>
</template>
