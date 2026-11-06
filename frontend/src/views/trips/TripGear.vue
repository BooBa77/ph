<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import {
  createTripGearSection,
  listGear,
  listTripGear,
  proposeTripGear,
  removeTripGear,
  removeTripGearSection,
  updateTripGear,
  updateTripGearSection,
} from '@/api/gear'
import { listTripChecklists } from '@/api/tripChecklists'
import { listParticipants } from '@/api/trips'
import { ApiError } from '@/api/errors'
import { useAuthStore } from '@/stores/auth'
import TripGearChecklist from '@/components/gear/TripGearChecklist.vue'
import TripGearExtraPicker from '@/components/gear/TripGearExtraPicker.vue'
import TripGearItemModal from '@/components/gear/TripGearItemModal.vue'
import TripGearManualModal from '@/components/gear/TripGearManualModal.vue'
import TripGearSectionList from '@/components/gear/TripGearSectionList.vue'
import { TRIP_GEAR_STATUS_LABELS } from '@/types/gear'
import type { Checklist, TripChecklists } from '@/types/checklists'
import type {
  GearItem,
  TripGearItem,
  TripGearSection,
  TripGearSectionScope,
  TripGearStatus,
} from '@/types/gear'
import type { Trip, TripParticipant } from '@/types/trips'
import {
  formatWeight,
  formatWeightTotal,
  weightInGrams,
} from '@/utils/gearWeight'

/**
 * Вкладка «Снаряжение» похода (код `gear`), первый проход по фронту
 * (05.11.2026).
 *
 * План целиком — `docs/ph/gear-tab.md`. По нему на странице **две большие
 * сворачиваемые секции**: общественное снаряжение (цвет темы, заказчик
 * склоняется к красно-коричневому) и личное (синее, как у «Питания»
 * и «Спальника»). Внутри — вложенные секции, каждая со своим сворачиванием.
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
 * - «Взял» — общественные вещи, назначенные на меня, и «Мой рюкзак» —
 *   то же с итоговым весом. Личные вещи и дополнительные рюкзаки ждут
 *   модели: в `trip_gear` их ещё нет, и придумывать её на экране рано.
 *
 * **Модалка одна на всё приложение.** «Добавить снаряжение» открывает
 * общий `TripGearExtraPicker` (05.11.2026) со своим `storageKey`, «Добавить
 * вручную» — общую `TripGearManualModal`. Копий форм здесь нет: у вкладки
 * свои заголовок, память свёрнутых групп и подпись, а сохранение остаётся
 * этому экрану.
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

const isLoading = ref(true)
const error = ref<string | null>(null)
/** Ошибка действия: её показываем рядом, не закрывая уже загруженный список. */
const actionError = ref<string | null>(null)
/** Состав не загрузился — имена в рюкзаках будут неполными, но экран живёт. */
const peopleError = ref<string | null>(null)

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
const catalog = ref<GearItem[]>([])
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

const openedItem = computed(
  () => items.value.find((row) => row.id === openedItemId.value) ?? null,
)

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

  await patchItem(item, { status })
}

/** Раздел выбрали в карточке — путь переноса для телефона, где drag не работает. */
async function onItemSection(sectionId: string | null): Promise<void> {
  const item = openedItem.value
  if (!item) return

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
  if (!item) return

  await patchItem(item, { assignedUserId: userId })
}

async function onItemRemove(): Promise<void> {
  const item = openedItem.value
  if (!item) return

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
/** «Взял» — своя раскладка, но и её на телефоне тянут полем в карточке. */
const canDragPersonal = computed(() => !isCoarsePointer.value)

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

/** Утверждённое без несущего: его и перетаскивают в рюкзаки. */
const unassigned = computed(() => approved.value.filter((item) => item.assignedUserId === null))

/** Плитки строятся только по «иду»: «пока не решил» ещё не несёт груз. */
const going = computed(() => participants.value.filter((person) => person.status === 'going'))

/** Общественное, которое несу я: это и «Взял», и содержимое «Моего рюкзака». */
const myItems = computed(() =>
  approved.value.filter((item) => item.assignedUserId !== null && item.assignedUserId === meId.value),
)

/**
 * Рюкзаки участников одним проходом: список вещей и итог считаются здесь,
 * а не в разметке по три раза на плитку.
 */
const bags = computed(() =>
  going.value.map((person) => {
    const list = approved.value.filter((item) => item.assignedUserId === person.userId)

    return { person, items: list, weight: weightTotalLabel(list) }
  }),
)

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
 */
function weightTotalLabel(list: TripGearItem[]): string {
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

async function load(): Promise<void> {
  const current = ++requestId
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
  } catch (problem) {
    actionError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось сохранить изменение'
    items.value = [...items.value]
  } finally {
    busyId.value = null
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
const draggingKind = ref<'assign' | 'section' | null>(null)

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
  draggingKind.value = null
}

async function dropOn(userId: string | null): Promise<void> {
  const item = items.value.find((row) => row.id === draggingId.value)
  draggingId.value = null
  draggingKind.value = null

  if (!item || item.assignedUserId === userId) return

  await patchItem(item, { assignedUserId: userId })
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

  if (isCatalogLoaded.value || isCatalogLoading.value) return

  isCatalogLoading.value = true

  try {
    const list = await listGear()
    catalog.value = list.items
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
  addTargetSection.value = null
  await openPickerBase()
}

async function openPickerForSection(sectionId: string | null): Promise<void> {
  addTargetSection.value = sectionId
  await openPickerBase()
}

/** Выбрали вещь каталога: она уходит в поход предложением, как и раньше. */
async function onPick(item: GearItem): Promise<void> {
  if (isAdding.value) return

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

/** Каталог, из которого нельзя предложить: то, что уже в походе. */
const excludedIds = computed(() => items.value.map((item) => item.gearItemId))
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
        open
        class="flex flex-col gap-3 rounded-2xl border border-orange-900 bg-orange-100 p-3"
        data-test="gear-public-section"
      >
        <summary class="cursor-pointer select-none text-sm font-medium text-orange-900">
          Общественное снаряжение
        </summary>

        <!--
          «Список»: что взять вообще, до распределения по людям. Список
          ведёт тот, кому доступна вкладка; остальные только видят его.
        -->
        <details
          open
          class="rounded-xl border border-border bg-white p-3"
          data-test="gear-shared-checklist"
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
          open
          class="rounded-xl border border-border bg-white p-3"
          data-test="gear-taking"
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
              Пока ничего не собрано. Добавьте снаряжение из личного каталога или вручную —
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
              class="rounded-xl border border-dashed p-2 transition-colors"
              :class="draggingKind === 'section' ? 'border-primary bg-primary/5' : 'border-border bg-surface'"
              data-test="gear-taking-sections"
              @create="onCreateSection('shared', $event)"
              @rename="onRenameSection"
              @remove="onRemoveSection"
              @move="moveToSharedSection"
              @add-to="openPickerForSection"
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
                    class="ml-auto shrink-0 cursor-pointer rounded-lg border border-orange-200 bg-white px-1.5 py-0.5 text-xs text-muted no-underline transition-colors hover:border-red-400 hover:text-red-600 disabled:opacity-40"
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
                    ✕
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
          open
          class="rounded-xl border border-border bg-white p-3"
          data-test="gear-distribution"
        >
          <summary class="cursor-pointer select-none text-sm font-medium text-text">
            Распределение
          </summary>

          <div class="mt-2 flex flex-col gap-2">
            <p
              v-if="approved.length === 0"
              class="text-sm text-muted"
              data-test="gear-distribution-empty"
            >
              Распределять пока нечего: сначала решите, что берём.
            </p>

            <template v-else>
              <div
                class="rounded-xl border border-dashed p-2 transition-colors"
                :class="draggingId ? 'border-primary bg-primary/5' : 'border-border bg-surface'"
                data-test="gear-unassigned"
                @dragover.prevent
                @drop.prevent="dropOn(null)"
              >
                <p class="text-xs font-medium text-muted">
                  Не распределено
                </p>

                <ul v-if="unassigned.length > 0" class="mt-1 flex flex-wrap gap-1.5">
                  <li
                    v-for="item in unassigned"
                    :key="item.id"
                    class="flex cursor-pointer flex-wrap items-center gap-1 rounded-xl border border-border bg-white px-2 py-1 text-sm transition-colors hover:border-primary"
                    role="button"
                    tabindex="0"
                    draggable="true"
                    :aria-label="`${item.title}. Открыть карточку вещи и сменить несущего`"
                    title="Открыть карточку вещи"
                    :data-test="`gear-unassigned-item-${item.id}`"
                    @click="openItem(item, 'shared')"
                    @keydown.enter.prevent="openItem(item, 'shared')"
                    @keydown.space.prevent="openItem(item, 'shared')"
                    @dragstart="startDrag(item, $event)"
                    @dragend="endDrag"
                  >
                    <span class="font-medium">{{ item.title }}</span>
                    <span v-if="weightInGrams(item.weightGrams)" class="text-xs text-muted">
                      {{ weightInGrams(item.weightGrams) }}
                    </span>
                    <span class="text-xs text-muted">· {{ personName(item.ownerUserId) }}</span>
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
                  :key="bag.person.userId"
                  class="flex flex-col gap-1 rounded-xl border bg-white p-2 transition-colors"
                  :class="bag.person.userId === meId ? 'border-primary' : 'border-border'"
                  :data-test="`gear-bag-${bag.person.userId}`"
                  @dragover.prevent
                  @drop.prevent="dropOn(bag.person.userId)"
                >
                  <div class="flex items-baseline justify-between gap-2">
                    <span class="truncate text-sm font-medium text-text">
                      {{ personOptionLabel(bag.person) }}
                    </span>
                    <span class="shrink-0 text-xs text-muted">{{ bag.weight }}</span>
                  </div>

                  <ul v-if="bag.items.length > 0" class="flex flex-col gap-1">
                    <li
                      v-for="item in bag.items"
                      :key="item.id"
                      class="flex cursor-pointer flex-wrap items-center gap-1 rounded-lg border border-border bg-surface px-2 py-1 text-sm transition-colors hover:border-primary"
                      role="button"
                      tabindex="0"
                      draggable="true"
                      :aria-label="`${item.title}. Открыть карточку вещи и сменить несущего`"
                      title="Открыть карточку вещи"
                      :data-test="`gear-bag-item-${item.id}`"
                      @click="openItem(item, 'shared')"
                      @keydown.enter.prevent="openItem(item, 'shared')"
                      @keydown.space.prevent="openItem(item, 'shared')"
                      @dragstart="startDrag(item, $event)"
                      @dragend="endDrag"
                    >
                      <span class="min-w-0 truncate">{{ item.title }}</span>
                      <span v-if="weightInGrams(item.weightGrams)" class="text-xs text-muted">
                        {{ weightInGrams(item.weightGrams) }}
                      </span>
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
        open
        class="flex flex-col gap-3 rounded-2xl border border-emerald-300 bg-emerald-100 p-3"
        data-test="gear-recommendation-section"
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
        open
        class="flex flex-col gap-3 rounded-2xl border border-blue-300 bg-blue-100 p-3"
        data-test="gear-personal-section"
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
          open
          class="rounded-xl border border-border bg-white p-3"
          data-test="gear-personal-checklist"
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
                subtitle="Не удаляется: это совет, а не ваш личный пункт. Отметку видите только вы — организатору она не возвращается."
                :can-mark="true"
                @updated="applyChecklist('recommendation', $event)"
              />

              <TripGearChecklist
                :trip-id="trip.id"
                :checklist="checklists.personal"
                scope="personal"
                heading="Мои личные вещи"
                subtitle="Этот список видите только вы. Можно добавить пункты или взять их из своих чек-листов."
                empty-text="Личного списка ещё нет — заведите его и добавьте вещи."
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

        <!-- «Взял»: то, что назначено на меня -->
        <details
          open
          class="rounded-xl border border-border bg-white p-3"
          data-test="gear-taken"
        >
          <summary class="cursor-pointer select-none text-sm font-medium text-text">
            Взял
          </summary>

          <div class="mt-2 flex flex-col gap-2">
            <p
              v-if="myItems.length === 0 && personalSections.length === 0"
              class="text-sm text-muted"
              data-test="gear-taken-empty"
            >
              Вы пока ничего не несёте: вещи назначаются в «Распределении».
            </p>

            <!--
              Личные разделы «Взял»: «Снаряга», «Одежда» и что человек
              добавит сам. Остальным они не видны — сервер их не отдаёт.
              Кнопки добавления здесь нет: содержимое «Взял» определяет
              «Распределение», а личные вещи ждут своей модели.
            -->
            <TripGearSectionList
              :sections="personalSections"
              :items="myItems"
              :parent-id="null"
              scope="personal"
              :can-manage="true"
              :can-place="true"
              class="rounded-xl border border-dashed p-2 transition-colors"
              :class="draggingKind === 'section' ? 'border-primary bg-primary/5' : 'border-blue-200 bg-blue-50'"
              data-test="gear-taken-sections"
              @create="onCreateSection('personal', $event)"
              @rename="onRenameSection"
              @remove="onRemoveSection"
              @move="moveToPersonalSection"
            >
              <template #item="{ item }">
                <!--
                  Та же пилюля, что в «Берём», и та же карточка: во «Взял»
                  поле «Раздел» ведёт в личные разделы. Статуса здесь нет —
                  сюда попадают только вещи, которые человек уже несёт.
                -->
                <li
                  class="flex cursor-pointer flex-wrap items-center gap-1 rounded-full border border-blue-300 bg-white px-2 py-1 text-sm text-blue-900 transition-colors hover:border-blue-500"
                  role="button"
                  tabindex="0"
                  :draggable="canDragPersonal"
                  :aria-label="`${item.title}. Открыть карточку вещи`"
                  :data-test="`gear-taken-item-${item.id}`"
                  @click="openItem(item, 'personal')"
                  @keydown.enter.prevent="openItem(item, 'personal')"
                  @keydown.space.prevent="openItem(item, 'personal')"
                  @dragstart="startDrag(item, $event, 'section')"
                  @dragend="endDrag"
                >
                  <span>{{ item.title }}</span>
                  <span v-if="item.weightGrams !== null" class="text-xs">
                    · {{ formatWeight(item.weightGrams) }}
                  </span>
                  <span class="text-xs text-blue-700">· {{ item.typeName }}</span>
                </li>
              </template>
            </TripGearSectionList>
          </div>
        </details>

        <!--
          «Мой рюкзак» — то же, что моя плитка в «Распределении», с итогом.
          Личные вещи и дополнительные рюкзаки («сменка на окончание похода»)
          появятся, когда у них будет модель: сейчас их негде хранить.
        -->
        <details
          open
          class="rounded-xl border border-border bg-white p-3"
          data-test="gear-backpack"
        >
          <summary class="cursor-pointer select-none text-sm font-medium text-text">
            Мой рюкзак
          </summary>

          <div class="mt-2 flex flex-col gap-2">
            <p v-if="myItems.length === 0" class="text-sm text-muted" data-test="gear-backpack-empty">
              В рюкзаке пусто.
            </p>

            <template v-else>
              <ul class="flex flex-col gap-1">
                <li
                  v-for="item in myItems"
                  :key="item.id"
                  class="flex items-baseline justify-between gap-2 rounded-lg border border-border bg-surface px-2 py-1 text-sm"
                  :data-test="`gear-backpack-item-${item.id}`"
                >
                  <span class="min-w-0 truncate">{{ item.title }}</span>
                  <span class="shrink-0 text-xs text-muted">
                    {{ weightInGrams(item.weightGrams) ?? 'без веса' }}
                  </span>
                </li>
              </ul>

              <p class="text-sm font-medium text-text" data-test="gear-backpack-total">
                {{ weightTotalLabel(myItems) }}
              </p>
            </template>
          </div>
        </details>
      </details>
    </template>

    <!--
      Карточка вещи: всё, что известно о вещи, плюс решения — несущий,
      раздел и «берём / не берём». Одна на «Берём», «Взял» и
      «Распределение»; `scope` выбирает, какой раздел показывать.
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
      :can-assign="openedScope === 'shared'"
      :can-decide="canEdit && openedScope === 'shared'"
      :can-place="openedScope === 'shared' ? canEdit : true"
      :can-remove="isMyItem(openedItem)"
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
      :loading="isCatalogLoading"
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
      :owner-options="manualOwnerOptions"
      @created="onManualCreated"
      @close="isManualOpen = false"
    />
  </section>
</template>
