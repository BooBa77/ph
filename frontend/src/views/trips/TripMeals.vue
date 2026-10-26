<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { ApiError } from '@/api/errors'
import { listDishes } from '@/api/meals'
import {
  addMealDish,
  addMyMealDish,
  addMyMealLine,
  createMealPackage,
  fetchMealPlan,
  fetchMyMealPlan,
  removeMealDish,
  removeMealLine,
  removeMealPackage,
  removeMyMealDish,
  removeMyMealLine,
  setMealAllocations,
  setMealDishExclusions,
  setMealForm,
  setMealKulek,
  setMyMealDishExclusions,
  addMealLine,
  setMealLine,
  setMyStatus,
  updateMealPackage,
} from '@/api/trips'
import ProductPicker from '@/components/ui/ProductPicker.vue'
import TripChat from '@/views/trips/TripChat.vue'
import TripMealShoppingModal from '@/views/trips/TripMealShoppingModal.vue'
import { useAuthStore } from '@/stores/auth'
import {
  TRIP_MEAL_CODES,
  TRIP_MEAL_FORMS,
  TRIP_MEAL_FORM_LABELS,
  TRIP_MEAL_KINDS,
  TRIP_MEAL_LABELS,
  type Trip,
  type TripMeal,
  type TripMealDish,
  type TripMealDishIngredient,
  type TripMealForm,
  type TripMealKind,
  type TripMealPackage,
  type TripMealPlan,
  type TripMealProduct,
} from '@/types/trips'
import { formatProductAmount, type Dish, type Product } from '@/types/meals'
import { formatWeight } from '@/utils/gearWeight'

/**
 * Вкладка «Питание»: едоки, раскладка по дням и приёмам, фасовка.
 *
 * Раскладка считается на бэкенде: рецепт × едоков, мясное — без
 * вегетарианцев, ручные строки абсолютные. Здесь только экран и правки.
 *
 * **Два слоя в одной плашке.** Общая еда похода и личная еда участника
 * живут в одном приёме: личные поля стоят над общими и отделены синим.
 * Правит каждый своё, читают оба слоя все идущие — флаг «питаюсь
 * отдельно» для личных полей не нужен.
 *
 * **Дни — из похода.** У решённого похода день имеет дату; у «Планирую»
 * — только номер. Края подрезаются по времени заезда/выезда: приехали
 * в 14:00 — завтрак первого дня уже не нужен (`meals.md` §5.4). Время
 * 00:00 — «не задано», тогда показываем все приёмы.
 */
const props = defineProps<{ trip: Trip; canEdit?: boolean }>()

const auth = useAuthStore()

const plan = ref<TripMealPlan | null>(null)
const dishes = ref<Dish[]>([])
const isLoading = ref(true)
const error = ref<string | null>(null)
/** Что сейчас в полёте: ключ действия, чтобы не жать дважды. */
const busy = ref<string | null>(null)

/** Выбранное блюдо в форме добавления: ключ приёма → dishId. */
const dishDrafts = ref<Record<string, string>>({})
/** Черновик ручной строки: ключ приёма → продукт и количество. */
const lineDrafts = ref<
  Record<string, { product: Product | null; text: string; amount: string }>
>({})

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof ApiError ? cause.message : fallback
}

function mealKey(dayIndex: number, kind: TripMealKind): string {
  return `${dayIndex}:${kind}`
}

function mealOf(dayIndex: number, kind: TripMealKind): TripMeal | undefined {
  return plan.value?.meals.find(
    (meal) => meal.dayIndex === dayIndex && meal.kind === kind,
  )
}

function dishDraft(key: string): string {
  return dishDrafts.value[key] ?? ''
}

function lineDraft(key: string): {
  product: Product | null
  text: string
  amount: string
} {
  lineDrafts.value[key] ??= { product: null, text: '', amount: '' }

  return lineDrafts.value[key]!
}

/**
 * Свёрнутая плашка: «только результат».
 *
 * Прячем всё, что нужно в момент сборки и мешает в момент просмотра:
 * кнопки формы приёма (готовка/перекус), колонку «ФАСОВКА по пакетам»
 * с кульком и выбор блюда с продуктом. Остаются название приёма, его вес,
 * блюда с составом и строки продуктов — по ним и видно, что человек ест.
 *
 * Состояние живёт в памяти вкладки: это режим просмотра на минуту, а не
 * настройка, которую надо запоминать между заходами.
 */
const editHidden = ref<Record<string, boolean>>({})

function isEditHidden(key: string): boolean {
  return editHidden.value[key] === true
}

function toggleEdit(key: string): void {
  editHidden.value[key] = !isEditHidden(key)
}

/**
 * Ключи всех плашек раскладки: дни × приёмы.
 *
 * Считаем по дням, а не по заполненным приёмам: сворачивать нужно и пустые
 * плашки — с автономным питанием их стало заметно больше, и листать
 * полотно пустых форм тоже утомительно.
 */
const slotKeys = computed(() =>
  days.value.flatMap((day) =>
    day.kinds.map((kind) => mealKey(day.index, kind)),
  ),
)

/**
 * Все плашки свёрнуты — тогда иконка «все» показывает разворот, а не
 * повторное свёртывание.
 */
const allCollapsed = computed(
  () =>
    slotKeys.value.length > 0 &&
    slotKeys.value.every((key) => isEditHidden(key)),
)

/** Свернуть или развернуть все плашки разом — со своего места на странице. */
function toggleAll(): void {
  const next = !allCollapsed.value

  editHidden.value = Object.fromEntries(
    slotKeys.value.map((key) => [key, next]),
  )
}

/** Кто из смотрящих — едок (для флага «питаюсь отдельно»). */
const me = computed(
  () =>
    plan.value?.eaters.people.find(
      (person) => person.userId === auth.user?.id,
    ) ?? null,
)

/**
 * Блюда, которые уже стоят в общей раскладке.
 *
 * Их можно взять в свою еду: рецепт группы — общий, даже если книга
 * рецептов у каждого своя. Поэтому личный слой не прячет то, что готовит
 * весь поход.
 */
const sharedDishes = computed(() => {
  const rows = new Map<string, string>()

  for (const meal of plan.value?.meals ?? []) {
    for (const dish of meal.dishes) rows.set(dish.dishId, dish.title)
  }

  return [...rows].map(([dishId, title]) => ({ dishId, title }))
})

const start = computed(() =>
  props.trip.startsAt ? new Date(props.trip.startsAt) : null,
)
function dateLabel(dayIndex: number): string {
  if (!start.value) return ''

  const date = new Date(start.value)
  date.setDate(date.getDate() + dayIndex - 1)

  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

const days = computed(() => {
  const count = plan.value?.dayCount ?? 0

  return Array.from({ length: count }, (_, index) => {
    const dayIndex = index + 1

    return {
      index: dayIndex,
      date: dateLabel(dayIndex),
      kinds: [...TRIP_MEAL_KINDS],
    }
  })
})

/** Мясное на «едоков минус вегетарианцы»: подпись «на 4 из 6». */
const meatPortion = computed(() => {
  if (!plan.value) return ''

  const eaters = plan.value.eaters.total - plan.value.eaters.vegetarians

  return `на ${eaters} из ${plan.value.eaters.total}`
})

/**
 * Убрать или вернуть ингредиент блюда в этом приёме. Рецепт не меняется:
 * исключение живёт только в строке приёма.
 *
 * **Убрали последний — блюдо уходит целиком.** Блюдо без ингредиентов
 * ничего не весит и ничего не раскладывает: оставлять его в плашке
 * с шапкой «в пакет / кол-во» и пустыми строками незачем.
 */
function toggleDishIngredient(
  dayIndex: number,
  kind: TripMealKind,
  dish: TripMealDish,
  productId: number,
): void {
  if (!props.canEdit) return

  const excluded = dish.excludedProductIds.includes(productId)
    ? dish.excludedProductIds.filter((id) => id !== productId)
    : [...dish.excludedProductIds, productId]

  const emptied =
    !dish.excludedProductIds.includes(productId) &&
    dish.ingredients.length > 0 &&
    dish.ingredients.every((row) => excluded.includes(row.productId))

  if (emptied) {
    void run(`${dish.dishId}:empty`, () =>
      removeMealDish(props.trip.id, dayIndex, kind, dish.dishId),
    )

    return
  }

  void run(`${dish.dishId}:${productId}:exclude`, () =>
    setMealDishExclusions(
      props.trip.id,
      dayIndex,
      kind,
      dish.dishId,
      excluded,
    ),
  )
}

async function load() {
  isLoading.value = true
  error.value = null

  try {
    plan.value = await fetchMealPlan(props.trip.id)
  } catch (problem) {
    error.value = messageOf(problem, 'Не удалось загрузить раскладку')
    plan.value = null
  } finally {
    isLoading.value = false
  }
}

async function loadDishes() {
  try {
    dishes.value = await listDishes()
  } catch {
    // Блюда нужны только для добавления: без них раскладка читается.
    dishes.value = []
  }
}

async function run(key: string, action: () => Promise<TripMealPlan>) {
  busy.value = key
  error.value = null

  try {
    plan.value = await action()
  } catch (problem) {
    error.value = messageOf(problem, 'Не удалось сохранить')
  } finally {
    busy.value = null
  }
}

function changeForm(meal: TripMeal, form: TripMealForm) {
  if (!props.canEdit || meal.form === form) return

  void run(`${meal.id}:form`, () =>
    setMealForm(props.trip.id, meal.dayIndex, meal.kind, form),
  )
}

function addDish(dayIndex: number, kind: TripMealKind) {
  const key = mealKey(dayIndex, kind)
  const dishId = dishDraft(key)
  if (!dishId) return

  void run(`${key}:dish`, async () => {
    const next = await addMealDish(props.trip.id, dayIndex, kind, dishId)
    dishDrafts.value[key] = ''

    return next
  })
}

function removeDish(dayIndex: number, kind: TripMealKind, dishId: string) {
  void run(`${mealKey(dayIndex, kind)}:dish:${dishId}`, () =>
    removeMealDish(props.trip.id, dayIndex, kind, dishId),
  )
}

/** Текст в поле поиска продукта: он и станет названием своего продукта. */
function onLineQuery(dayIndex: number, kind: TripMealKind, text: string) {
  lineDraft(mealKey(dayIndex, kind)).text = text
}

function chooseLineProduct(key: string, product: Product) {
  const draft = lineDraft(key)
  draft.product = product
  draft.text = product.name
  draft.amount = ''
}

/** Рецепты, которых ещё нет в этом приёме: выбранные не предлагаем. */
function dishesFor(meal: TripMeal | undefined): Dish[] {
  if (!meal) return dishes.value

  return dishes.value.filter(
    (dish) => !meal.dishes.some((row) => row.dishId === String(dish.id)),
  )
}

function lineReady(key: string): boolean {
  const draft = lineDraft(key)
  const amount = Number(String(draft.amount).trim())

  return draft.text.trim().length > 0 && Number.isInteger(amount) && amount > 0
}

function addLine(dayIndex: number, kind: TripMealKind) {
  const key = mealKey(dayIndex, kind)
  const draft = lineDraft(key)

  if (!lineReady(key)) return

  const amount = Number(String(draft.amount).trim())
  const name = draft.text.trim()
  // Продукт из справочника копируется в поход; если текст правили руками —
  // это уже свой продукт похода, справочник тут не при чём.
  const catalogProductId =
    draft.product && draft.product.name === name ? draft.product.id : undefined

  void run(`${key}:line`, async () => {
    const next = await addMealLine(props.trip.id, dayIndex, kind, {
      amount,
      ...(catalogProductId === undefined
        ? { name }
        : { catalogProductId }),
    })
    lineDrafts.value[key] = { product: null, text: '', amount: '' }

    return next
  })
}

function removeLine(
  dayIndex: number,
  kind: TripMealKind,
  productId: number,
) {
  void run(`${mealKey(dayIndex, kind)}:line:${productId}`, () =>
    removeMealLine(props.trip.id, dayIndex, kind, productId),
  )
}

async function toggleSeparate() {
  if (!me.value) return

  await run('separate', async () => {
    await setMyStatus(props.trip.id, 'going', !me.value!.eatsSeparately)

    return fetchMealPlan(props.trip.id)
  })
}

// ─── фасовка: пакеты и доли ───

const confirmingPackageId = ref<string | null>(null)

/** Обычные пакеты: кулёк в списках чужих приёмов не участвует. */
const normalPackages = computed(() =>
  (plan.value?.packages ?? []).filter((pack) => pack.kind === 'normal'),
)

function kulekOf(meal: TripMeal): TripMealPackage | undefined {
  return plan.value?.packages.find(
    (pack) => pack.kind === 'kulek' && pack.mealId === meal.id,
  )
}

/**
 * Пакеты, видимые в списках этого приёма: обычные плюс кулёк этого приёма.
 *
 * Кулёк — тара одного приёма, поэтому в чужих списках его нет. А в своём
 * он честно стоит в списке: иначе, собрав всё в кулёк, человек видел бы
 * пустые поля выбора пакета и не понимал, куда делась фасовка.
 */
function packsFor(meal: TripMeal | undefined): TripMealPackage[] {
  const kulek = meal ? kulekOf(meal) : undefined

  return kulek ? [...normalPackages.value, kulek] : normalPackages.value
}

/** Подпись пакета в списке: у кулька видно, что это он. */
function packLabel(pack: TripMealPackage): string {
  return pack.kind === 'kulek' ? `${pack.name} · кулёк` : pack.name
}

/** Строка кулька: количество у него всегда «всё», менять нечего. */
function isKulekRow(meal: TripMeal | undefined, row: PackRow): boolean {
  return Boolean(
    meal &&
      packsFor(meal).some(
        (pack) => pack.kind === 'kulek' && pack.id === row.packageId,
      ),
  )
}

/**
 * Пакеты в списке этой строки.
 *
 * Кулёк виден только там, где он и так стоит: в чужих строках его нет.
 * Причина техническая: любая правка долей расформировывает кулёк (правило
 * «ручная фасовка отменяет кулёк»), и если бы его можно было выбрать
 * из обычной строки, запрос пришёл бы с пакетом, которого уже нет, —
 * бэкенд ответил бы 400. Собрать всё в кулёк по-прежнему кнопка
 * «всё в отдельный кулёк».
 */
function packOptions(
  meal: TripMeal | undefined,
  row: PackRow,
): TripMealPackage[] {
  const packs = normalPackages.value
  const kulek = meal ? kulekOf(meal) : undefined

  return kulek && kulek.id === row.packageId ? [...packs, kulek] : packs
}

/** Строка продукта приёма по продукту рецепта. */
function productById(meal: TripMeal, productId: number): TripMealProduct | undefined {
  return meal.products.find((product) => product.productId === productId)
}

/**
 * Строка фасовки: доля продукта в пакете или ещё не разложенный остаток.
 *
 * Остаток — **такая же строка**, только без пакета: тот же выбор пакета,
 * то же «кол-во», название и вес. Никаких подписей «остаток» и цвета:
 * человек видит две одинаковые строки продукта с разными весами и кладёт
 * каждую в свою тару.
 */
interface PackRow {
  /** Позиция строки у продукта: 0 — первая, по ней строится id. */
  position: number
  /** Доля в `product.allocations`; −1 у остатка. */
  index: number
  key: string
  packageId: string
  amount: number
  isElastic: boolean
  /** Пакета ещё нет — поле количества заблокировано, как у продуктов. */
  isFree: boolean
}

/** Доли продукта плюс (если есть) строка остатка. */
function packRows(product: TripMealProduct | undefined): PackRow[] {
  if (!product) return []

  const rows: PackRow[] = product.allocations.map((share, index) => ({
    position: index,
    index,
    key: `${product.productId}:${index}:${share.packageId}`,
    packageId: share.packageId,
    amount: share.amount,
    isElastic: share.isElastic,
    isFree: false,
  }))

  const left = leftoverOf(product)
  if (rows.length === 0 || left > 0) {
    rows.push({
      position: rows.length,
      index: -1,
      key: `${product.productId}:left`,
      packageId: '',
      amount: rows.length === 0 ? product.amount : left,
      isElastic: false,
      isFree: true,
    })
  }

  return rows
}

/** Значение селекта «кол-во»: «всё» у эластичной доли и у строки без пакета. */
function amountValue(row: PackRow): string {
  // У строки без пакета количество — это весь её остаток, то есть «всё».
  // Показывать там число значило бы предлагать выбрать его меньше, хотя
  // без пакета выбор ни на что не влияет.
  return row.isElastic || row.isFree ? 'all' : String(row.amount)
}

/**
 * Строки ингредиента: доли продукта в пакетах и остаток.
 *
 * У исключённого ингредиента продукта в приёме нет, но чип с названием
 * остаётся: иначе ингредиент было бы не вернуть.
 */
function ingredientRows(
  meal: TripMeal | undefined,
  ingredient: TripMealDishIngredient,
): PackRow[] {
  const product = meal ? productById(meal, ingredient.productId) : undefined
  const rows = packRows(product)

  if (rows.length > 0) return rows

  return [
    {
      position: 0,
      index: -1,
      key: `${ingredient.productId}:chip`,
      packageId: '',
      amount: ingredient.amount,
      isElastic: false,
      isFree: true,
    },
  ]
}

/**
 * Варианты «кол-во» для строки: от 1 до того, сколько всего может лежать
 * в этой строке.
 *
 * Верхняя граница — «количество продукта минус всё, что уже лежит в других
 * строках». Без неё две строки по 5 яблок давали бы 10 при плане в 5:
 * строка может забрать остаток, но не больше.
 */
function amountOptions(
  product: TripMealProduct | undefined,
  row: PackRow,
): number[] {
  if (!product) return [1]

  // У остатка своей доли в сумме нет — он и есть несложенное.
  const others = row.isFree
    ? allocatedOf(product)
    : allocatedOf(product) - row.amount
  const limit = Math.max(1, product.amount - others)

  return Array.from({ length: limit }, (_, index) => index + 1)
}

/** Подсказка крестика: он убирает либо порцию, либо весь продукт. */
function removeHint(
  row: PackRow,
  meal: TripMeal | undefined,
  what: string,
): string {
  return row.isFree || isKulekRow(meal, row)
    ? `Убрать ${what}`
    : 'Убрать порцию'
}

/** data-test строки: у первой — прежний, у остальных — с номером строки. */
function shareTest(prefix: string, base: string, row: PackRow): string {
  return row.position === 0
    ? `${prefix}-${base}`
    : `${prefix}-${base}-${row.position + 1}`
}

function currentShares(
  product: TripMealProduct,
): Array<{ packageId: string; amount: number; isElastic: boolean }> {
  return product.allocations.map((share) => ({
    packageId: share.packageId,
    amount: share.amount,
    isElastic: share.isElastic,
  }))
}

/**
 * Нормализация перед сохранением: один пакет — одна доля, «всё» — одна
 * на продукт.
 *
 * Две строки одного пакета бэкенд не примет (уникальный индекс), а это
 * легко получить, перетасовав строки между пакетами. Лучше сложить самому,
 * чем показать человеку 400.
 */
function normalizedShares(
  rows: Array<{ packageId: string; amount: number; isElastic: boolean }>,
): Array<{ packageId: string; amount: number; isElastic: boolean }> {
  const merged = new Map<string, { amount: number; isElastic: boolean }>()

  for (const row of rows) {
    if (!row.packageId) continue
    const existing = merged.get(row.packageId)
    if (!existing) {
      merged.set(row.packageId, {
        amount: row.isElastic ? 0 : row.amount,
        isElastic: row.isElastic,
      })
      continue
    }
    existing.isElastic = existing.isElastic || row.isElastic
    existing.amount = existing.isElastic ? 0 : existing.amount + row.amount
  }

  let elasticSeen = false

  return [...merged].map(([packageId, share]) => {
    const isElastic = share.isElastic && !elasticSeen
    if (isElastic) elasticSeen = true

    return { packageId, amount: isElastic ? 0 : share.amount, isElastic }
  })
}

function saveShares(
  dayIndex: number,
  kind: TripMealKind,
  product: TripMealProduct,
  rows: Array<{ packageId: string; amount: number; isElastic: boolean }>,
): void {
  void run(`${product.productId}:alloc`, () =>
    setMealAllocations(
      props.trip.id,
      dayIndex,
      kind,
      product.productId,
      normalizedShares(rows),
    ),
  )
}

/** Новый пакет прямо из строки: создаём и сразу кладём в него долю. */
async function saveWithNewPack(
  dayIndex: number,
  kind: TripMealKind,
  product: TripMealProduct,
  build: (
    packageId: string,
  ) => Array<{ packageId: string; amount: number; isElastic: boolean }>,
): Promise<void> {
  const key = `${product.productId}:new-pack`
  if (busy.value === key) return

  busy.value = key
  error.value = null

  try {
    const next = await createMealPackage(props.trip.id)
    const pack = next.packages[next.packages.length - 1]
    plan.value = pack
      ? await setMealAllocations(
          props.trip.id,
          dayIndex,
          kind,
          product.productId,
          normalizedShares(build(pack.id)),
        )
      : next
  } catch (cause) {
    error.value = messageOf(cause, 'Не удалось создать пакет')
  } finally {
    busy.value = null
  }
}

/**
 * Выбрали пакет в строке: доля переезжает, остальные доли стоят.
 *
 * Остаток (строка без пакета) становится новой долей. Если выбрали кулёк
 * другого приёма — его здесь нет в списке, поэтому случай не возникает.
 */
function setRowPack(
  dayIndex: number,
  kind: TripMealKind,
  product: TripMealProduct,
  row: PackRow,
  event: Event,
): void {
  const value = (event.target as HTMLSelectElement).value
  if (!value) return

  const apply = (packageId: string) => {
    const shares = currentShares(product)
    if (row.isFree) {
      shares.push({ packageId, amount: row.amount, isElastic: false })
    } else {
      const share = shares[row.index]
      if (share) share.packageId = packageId
    }

    return shares
  }

  if (value === '__new__') {
    void saveWithNewPack(dayIndex, kind, product, apply)

    return
  }

  saveShares(dayIndex, kind, product, apply(value))
}

/** Выбрали количество: «всё» делает долю эластичной, число — фиксированной. */
function setRowAmount(
  dayIndex: number,
  kind: TripMealKind,
  product: TripMealProduct,
  row: PackRow,
  event: Event,
): void {
  // У кулька количество всегда «всё»: любая правка долей его расформирует.
  if (row.isFree || isKulekRow(mealOf(dayIndex, kind), row)) return

  const value = (event.target as HTMLSelectElement).value
  if (!value) return

  const shares = currentShares(product)
  const share = shares[row.index]
  if (!share) return

  if (value === 'all') {
    share.amount = 0
    share.isElastic = true
    saveShares(dayIndex, kind, product, shares)

    return
  }

  const amount = Number(value)
  if (!Number.isInteger(amount) || amount <= 0) return

  share.amount = amount
  share.isElastic = false
  saveShares(dayIndex, kind, product, shares)
}

/** Фасовка ингредиента блюда — та же строка продукта приёма. */
function setIngredientPack(
  dayIndex: number,
  kind: TripMealKind,
  productId: number,
  row: PackRow,
  event: Event,
): void {
  const meal = mealOf(dayIndex, kind)
  if (!meal) return
  const product = productById(meal, productId)
  if (!product) return

  setRowPack(dayIndex, kind, product, row, event)
}

function setIngredientAmount(
  dayIndex: number,
  kind: TripMealKind,
  productId: number,
  row: PackRow,
  event: Event,
): void {
  const meal = mealOf(dayIndex, kind)
  if (!meal) return
  const product = productById(meal, productId)
  if (!product) return

  setRowAmount(dayIndex, kind, product, row, event)
}

/**
 * Убрать строку: и её количество из плана приёма.
 *
 * Строка — это порция продукта. Крестик убирает порцию целиком: количество
 * уходит из плана (убавка ручной строкой), а не превращается в «остаток».
 * Поэтому после удаления 3 г из 2+5+3 остаются 2 и 5, а не 2, 5 и «3
 * не расфасовано». Если убирать больше нечего — продукт уходит из приёма.
 */
async function removePortion(
  dayIndex: number,
  kind: TripMealKind,
  product: TripMealProduct,
  row: PackRow,
  removeProduct: () => void,
): Promise<void> {
  // Пока идёт сохранение, второй клик считался бы по старому снимку.
  if (busy.value) return

  if (product.amount - row.amount <= 0) {
    removeProduct()

    return
  }

  const newManual = product.manualAmount - row.amount
  const shares = row.isFree
    ? null
    : currentShares(product).filter(
        (share) => share.packageId !== row.packageId,
      )

  await run(`${product.productId}:remove`, async () => {
    if (shares) {
      await setMealAllocations(
        props.trip.id,
        dayIndex,
        kind,
        product.productId,
        normalizedShares(shares),
      )
    }

    // Ноль в ручной строке запрещён: убавка до нуля — это её удаление.
    return newManual === 0
      ? removeMealLine(props.trip.id, dayIndex, kind, product.productId)
      : setMealLine(props.trip.id, dayIndex, kind, product.productId, newManual)
  })
}

/** Крестик строки продукта: убрать порцию, а когда порции кончились — продукт. */
function removeProductRow(
  dayIndex: number,
  kind: TripMealKind,
  product: TripMealProduct,
  row: PackRow,
): void {
  void removePortion(dayIndex, kind, product, row, () =>
    removeLine(dayIndex, kind, product.productId),
  )
}

/** Крестик строки ингредиента — те же правила, что у продукта. */
function ingredientAction(
  dayIndex: number,
  kind: TripMealKind,
  dish: TripMealDish,
  ingredient: TripMealDishIngredient,
  row: PackRow,
): void {
  // Исключённый ингредиент возвращаем тем же кликом.
  if (dish.excludedProductIds.includes(ingredient.productId)) {
    toggleDishIngredient(dayIndex, kind, dish, ingredient.productId)

    return
  }

  const meal = mealOf(dayIndex, kind)
  const product = meal ? productById(meal, ingredient.productId) : undefined
  if (!product) return

  void removePortion(dayIndex, kind, product, row, () =>
    toggleDishIngredient(dayIndex, kind, dish, ingredient.productId),
  )
}

/** Всего разложено по пакетам. */
function allocatedOf(product: TripMealProduct): number {
  return product.allocations.reduce((sum, row) => sum + row.amount, 0)
}

/** Сколько ещё не разложено: остаток — такая же строка, только без пакета. */
function leftoverOf(product: TripMealProduct | undefined): number {
  if (!product) return 0

  return Math.max(0, product.amount - allocatedOf(product))
}

/** Насколько пакеты превысили рецепт — лишнее можно убрать. */
function overAllocated(product: TripMealProduct): number {
  return Math.max(0, allocatedOf(product) - product.amount)
}

/** Нерасфасованное: продукты, которых пакеты не добрали. */
const unpackedRows = computed(() => {
  const rows: Array<{
    key: string
    meal: string
    name: string
    left: number
    unit: TripMealProduct['unit']
  }> = []

  for (const meal of plan.value?.meals ?? []) {
    for (const product of meal.products) {
      const left = product.amount - allocatedOf(product)
      if (left <= 0) continue

      rows.push({
        key: `${meal.id}:${product.productId}`,
        meal: `${meal.dayIndex}${TRIP_MEAL_CODES[meal.kind]} ${TRIP_MEAL_LABELS[meal.kind]}`,
        name: product.name,
        left,
        unit: product.unit,
      })
    }
  }

    return rows
})

function toggleKulek(meal: TripMeal): void {
  const kulek = kulekOf(meal)

  void run(`${meal.id}:kulek`, () =>
    setMealKulek(props.trip.id, meal.dayIndex, meal.kind, !kulek),
  )
}

function addPackage(): void {
  void run('package:add', () => createMealPackage(props.trip.id))
}

function savePackageName(pack: TripMealPackage, event: Event): void {
  const name = (event.target as HTMLInputElement).value.trim()
  if (!name || name === pack.name) return

  void run(`${pack.id}:name`, () =>
    updateMealPackage(props.trip.id, pack.id, { name }),
  )
}

function savePackageWeight(pack: TripMealPackage, event: Event): void {
  const raw = (event.target as HTMLInputElement).value.trim()
  const grams = raw === '' ? null : Number(raw)
  if (grams !== null && (!Number.isInteger(grams) || grams <= 0)) return

  void run(`${pack.id}:weight`, () =>
    updateMealPackage(props.trip.id, pack.id, { weightActualGrams: grams }),
  )
}

function removePackage(pack: TripMealPackage): void {
  confirmingPackageId.value = null

  void run(`${pack.id}:delete`, () => removeMealPackage(props.trip.id, pack.id))
}

// ─── личная еда: моё в тех же плашках ───

/**
 * Личный слой участника: `fetchMyMealPlan` и `/my-meals/...`.
 *
 * Его видит и ведёт любой идущий — флаг «питаюсь отдельно» больше не
 * нужен: личные поля стоят в тех же плашках приёма, только отдельным
 * цветом. Кто в поход не идёт, получит 400 — личный интерфейс просто
 * не появится.
 */
const myPlan = ref<TripMealPlan | null>(null)

const myDishDrafts = ref<Record<string, string>>({})
const myLineDrafts = ref<
  Record<string, { product: Product | null; text: string; amount: string }>
>({})

/** «Список моих продуктов» — модалка личного чек-листа. */
const myShoppingOpen = ref(false)

/**
 * Свёрнутость личных полей — отдельно от общих.
 *
 * Две независимые пары треугольников: свернуть свои поля не значит
 * свернуть чужие, и наоборот.
 */
const myEditHidden = ref<Record<string, boolean>>({})

function isMyEditHidden(key: string): boolean {
  return myEditHidden.value[key] === true
}

function toggleMyEdit(key: string): void {
  myEditHidden.value[key] = !isMyEditHidden(key)
}

const allMyCollapsed = computed(
  () =>
    slotKeys.value.length > 0 &&
    slotKeys.value.every((key) => isMyEditHidden(key)),
)

/** Свернуть или развернуть личные поля во всех плашках. */
function toggleAllMy(): void {
  const next = !allMyCollapsed.value

  myEditHidden.value = Object.fromEntries(
    slotKeys.value.map((key) => [key, next]),
  )
}

function myMealOf(dayIndex: number, kind: TripMealKind): TripMeal | undefined {
  return myPlan.value?.meals.find(
    (meal) => meal.dayIndex === dayIndex && meal.kind === kind,
  )
}

function myLineDraft(key: string): {
  product: Product | null
  text: string
  amount: string
} {
  myLineDrafts.value[key] ??= { product: null, text: '', amount: '' }

  return myLineDrafts.value[key]!
}

/** Вес личного приёма: сколько человек берёт на этот приём. */
function myMealWeight(dayIndex: number, kind: TripMealKind): number {
  return myMealOf(dayIndex, kind)?.weightGrams ?? 0
}

/**
 * Рецепты для личного приёма: свои из книги плюс общие из раскладки похода.
 *
 * Дубль по id снимается: одно и то же блюдо может быть и своим, и общим —
 * выбирать его дважды незачем.
 */
function myDishesFor(
  meal: TripMeal | undefined,
): Array<{ id: string; title: string }> {
  const rows = [
    ...dishes.value.map((dish) => ({ id: dish.id, title: dish.title })),
    ...sharedDishes.value.map((dish) => ({
      id: dish.dishId,
      title: dish.title,
    })),
  ]
  const unique = new Map(rows.map((row) => [row.id, row]))
  const taken = new Set(meal?.dishes.map((dish) => dish.dishId) ?? [])

  return [...unique.values()].filter((row) => !taken.has(row.id))
}

/** Правка личного слоя: план обновляется из ответа, общий не трогаем. */
async function runMy(key: string, action: () => Promise<TripMealPlan>) {
  busy.value = key
  error.value = null

  try {
    myPlan.value = await action()
  } catch (problem) {
    error.value = messageOf(problem, 'Не удалось сохранить')
  } finally {
    busy.value = null
  }
}

function addMyDish(dayIndex: number, kind: TripMealKind): void {
  const key = mealKey(dayIndex, kind)
  const dishId = myDishDrafts.value[key]
  if (!dishId) return

  void runMy(`${key}:my-dish`, async () => {
    const next = await addMyMealDish(props.trip.id, dayIndex, kind, dishId)
    myDishDrafts.value[key] = ''

    return next
  })
}

function removeMyDish(
  dayIndex: number,
  kind: TripMealKind,
  dishId: string,
): void {
  void runMy(`${mealKey(dayIndex, kind)}:my-dish:${dishId}`, () =>
    removeMyMealDish(props.trip.id, dayIndex, kind, dishId),
  )
}

/**
 * Убрать или вернуть ингредиент в моём приёме.
 *
 * Как и в общем слое: исключение живёт в строке приёма, рецепт не меняется.
 * Убрали последний ингредиент — блюдо уходит целиком, иначе осталась бы
 * пустая строка без состава.
 */
function toggleMyDishIngredient(
  dayIndex: number,
  kind: TripMealKind,
  dish: TripMealDish,
  productId: number,
): void {
  const excluded = dish.excludedProductIds.includes(productId)
    ? dish.excludedProductIds.filter((id) => id !== productId)
    : [...dish.excludedProductIds, productId]

  const emptied =
    !dish.excludedProductIds.includes(productId) &&
    dish.ingredients.length > 0 &&
    dish.ingredients.every((row) => excluded.includes(row.productId))

  if (emptied) {
    removeMyDish(dayIndex, kind, dish.dishId)

    return
  }

  void runMy(`${dish.dishId}:${productId}:my-exclude`, () =>
    setMyMealDishExclusions(
      props.trip.id,
      dayIndex,
      kind,
      dish.dishId,
      excluded,
    ),
  )
}

function onMyLineQuery(
  dayIndex: number,
  kind: TripMealKind,
  text: string,
): void {
  myLineDraft(mealKey(dayIndex, kind)).text = text
}

function chooseMyLineProduct(key: string, product: Product): void {
  const draft = myLineDraft(key)
  draft.product = product
  draft.text = product.name
  draft.amount = ''
}

function myLineReady(key: string): boolean {
  const draft = myLineDraft(key)
  const amount = Number(String(draft.amount).trim())

  return draft.text.trim().length > 0 && Number.isInteger(amount) && amount > 0
}

function addMyLine(dayIndex: number, kind: TripMealKind): void {
  const key = mealKey(dayIndex, kind)
  const draft = myLineDraft(key)

  if (!myLineReady(key)) return

  const amount = Number(String(draft.amount).trim())
  const name = draft.text.trim()
  // Продукт из справочника копируется в поход; если текст правили руками —
  // это уже свой продукт, и он уедет только в личный слой.
  const catalogProductId =
    draft.product && draft.product.name === name ? draft.product.id : undefined

  void runMy(`${key}:my-line`, async () => {
    const next = await addMyMealLine(props.trip.id, dayIndex, kind, {
      amount,
      ...(catalogProductId === undefined ? { name } : { catalogProductId }),
    })
    myLineDrafts.value[key] = { product: null, text: '', amount: '' }

    return next
  })
}

function removeMyLine(
  dayIndex: number,
  kind: TripMealKind,
  productId: number,
): void {
  void runMy(`${mealKey(dayIndex, kind)}:my-line:${productId}`, () =>
    removeMyMealLine(props.trip.id, dayIndex, kind, productId),
  )
}

/** Мои продукты целиком: агрегат по всем личным приёмам для карточки. */
const myProducts = computed(() => {
  const rows = new Map<number, { key: string; name: string; weightGrams: number }>()

  for (const meal of myPlan.value?.meals ?? []) {
    for (const product of meal.products) {
      const row = rows.get(product.productId) ?? {
        key: String(product.productId),
        name: product.name,
        weightGrams: 0,
      }
      row.weightGrams += product.amount * product.weightPerUnitGrams
      rows.set(product.productId, row)
    }
  }

  return [...rows.values()]
})

const myProductsWeight = computed(() =>
  myProducts.value.reduce((sum, row) => sum + row.weightGrams, 0),
)

// ─── мои продукты: контрольное взвешивание ───

/**
 * Вес моих продуктов после контрольного взвешивания.
 *
 * Хранится в браузере: это отметка для себя, а не данные похода — сервер
 * про личный вес ничего не знает. Когда личные продукты поедут в
 * «Снаряжение» одной позицией, вес переедет в базу вместе с рюкзаком.
 */
const MY_FOOD_WEIGHT_KEY = 'ph.myFoodWeight'

const myFoodActualGrams = ref<number | null>(null)

function myFoodWeightKey(): string {
  return `${MY_FOOD_WEIGHT_KEY}.${props.trip.id}.${auth.user?.id ?? ''}`
}

function readMyFoodWeight(): void {
  try {
    const raw = window.localStorage.getItem(myFoodWeightKey())
    myFoodActualGrams.value =
      raw === null || Number.isNaN(Number(raw)) ? null : Number(raw)
  } catch {
    myFoodActualGrams.value = null
  }
}

function saveMyFoodWeight(event: Event): void {
  const raw = (event.target as HTMLInputElement).value.trim()
  const grams = raw === '' ? null : Number(raw)
  if (grams !== null && (!Number.isInteger(grams) || grams <= 0)) return

  myFoodActualGrams.value = grams

  try {
    if (grams === null) window.localStorage.removeItem(myFoodWeightKey())
    else window.localStorage.setItem(myFoodWeightKey(), String(grams))
  } catch {
    // Без хранилища отметка просто не переживёт перезагрузку.
  }
}

/**
 * Правый отступ колонки форм: под треугольники в углу плашки.
 *
 * Пара кнопок — около 48 px; пар может быть две (общая и личная), одна
 * или ни одной. Лишний отступ съедает ширину селекта, поэтому считаем.
 */
const formsPad = computed(() => {
  const pairs = (props.canEdit ? 1 : 0) + (myPlan.value ? 1 : 0)

  if (pairs === 0) return 'pr-2'

  return pairs === 1 ? 'pr-12' : 'pr-24'
})

async function loadMyPlan(): Promise<void> {
  try {
    myPlan.value = await fetchMyMealPlan(props.trip.id)
  } catch {
    // Не идёт в поход или личный слой недоступен — живём без личных полей.
    myPlan.value = null
  }
}

// ─── список покупок ───

/**
 * «Список покупок» — модалка, а не раздел страницы: в него заглядывают,
 * чтобы сходить в магазин, и он не должен растягивать раскладку. Содержимое
 * грузит сама модалка при открытии — об этом знает `TripMealShoppingModal`.
 */
const shoppingOpen = ref(false)

onMounted(() => {
  void load()
  void loadDishes()
  void loadMyPlan()
  readMyFoodWeight()
})
</script>

<template>
  <section class="flex flex-col gap-6" data-test="trip-meals">
    <p v-if="isLoading" class="text-sm text-muted" data-test="meals-loading">Загружаем раскладку…</p>

    <p v-else-if="error" class="text-sm text-red-600" data-test="meals-error">{{ error }}</p>

    <template v-else-if="plan">
      <!-- Едоки -->
      <div class="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4" data-test="eaters">
        <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 class="text-sm text-muted">Едоки</h2>

          <p class="text-sm text-text" data-test="eaters-counts">
          {{ plan.eaters.total }} в общей раскладке
          (М-{{ plan.eaters.men }}, Ж-{{ plan.eaters.women }}),
          <template v-if="plan.eaters.vegetarians === 0">вегетарианцев нет</template>
          <template v-else>вегетарианцев {{ plan.eaters.vegetarians }}</template>
          </p>

          <!-- Список общих продуктов — наверху: за ним идут перед закупкой,
               а не после того, как пролистали всю раскладку -->
          <button
            type="button"
            class="ml-auto cursor-pointer rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
            data-test="checklist-toggle"
            @click="shoppingOpen = true"
          >
            Список общих продуктов
          </button>
        </div>

        <ul class="flex flex-col gap-1" data-test="eaters-list">
          <li
            v-for="person in plan.eaters.people"
            :key="person.userId"
            class="flex flex-wrap items-baseline gap-2 text-sm text-text"
            data-test="eater"
          >
            <span class="text-xs text-muted">{{ person.gender === 'm' ? 'м' : 'ж' }}</span>
            <span>{{ person.displayName }}</span>
            <span v-if="person.isVegetarian" class="text-xs text-muted">вегетарианец</span>
            <span v-if="person.allergies" class="text-xs text-muted">аллергии: {{ person.allergies }}</span>
            <span v-if="person.eatsSeparately" class="text-xs text-muted">питается отдельно</span>
          </li>
        </ul>

        <div
          v-if="me || myPlan"
          class="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-2"
          data-test="eats-separately-block"
        >
          <label v-if="me" class="flex cursor-pointer items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              class="h-4 w-4 cursor-pointer accent-[var(--theme-primary)]"
              :checked="me.eatsSeparately"
              :disabled="busy === 'separate'"
              data-test="eats-separately"
              @change="toggleSeparate"
            />
            Я буду питаться отдельно
          </label>

          <!-- Личный список продуктов — рядом с флагом: своя закупка -->
          <button
            v-if="myPlan"
            type="button"
            class="ml-auto cursor-pointer rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
            data-test="my-checklist-toggle"
            @click="myShoppingOpen = true"
          >
            Список моих продуктов
          </button>
        </div>
      </div>

      <!-- Раскладка по дням. <details>: длинную раскладку хочется свернуть,
           не уходя со вкладки; содержимое остаётся на своих местах. Свой
           желтоватый фон — чтобы переход к разделу читался глазами -->
      <details
        open
        class="group flex flex-col gap-4 rounded-2xl border border-amber-300 bg-amber-100 p-3"
        data-test="schedule"
      >
        <summary class="cursor-pointer select-none text-sm text-amber-900">Раскладка</summary>

        <section
          v-for="day in days"
          :key="day.index"
          class="flex flex-col gap-2"
          data-test="meal-day"
        >
          <h3 class="text-sm font-medium text-text">
            День {{ day.index }}
            <span v-if="day.date" class="text-muted"> · {{ day.date }}</span>
          </h3>

          <div class="flex flex-col gap-3">
            <article
              v-for="kind in day.kinds"
              :key="kind"
              class="relative flex flex-col gap-2 rounded-xl border border-border bg-surface p-3"
              :data-test="`meal-${day.index}-${kind}`"
            >
              <!--
                Четыре кнопки в углу плашки: две пары треугольников. Общая
                пара (одинарный — эта плашка, двойной — все) и личная, синяя,
                — сворачивает только свои поля. Живут в углу, а не
                в скрываемых полях: свёрнутая колонка исчезает вместе
                с кнопкой, и развернуть приём было бы нечем.
              -->
              <div
                v-if="canEdit || myPlan"
                class="absolute right-1.5 top-1.5 flex items-center gap-2"
                data-test="meal-toggles"
              >
                <span v-if="canEdit" class="flex items-center gap-1">
                  <button
                    type="button"
                    class="flex h-5 w-5 cursor-pointer items-center justify-center rounded-md border border-border text-muted transition-colors hover:border-primary hover:text-text"
                    :aria-expanded="!isEditHidden(mealKey(day.index, kind))"
                    :aria-label="
                      isEditHidden(mealKey(day.index, kind))
                        ? 'Показать поля приёма'
                        : 'Свернуть поля приёма'
                    "
                    :title="
                      isEditHidden(mealKey(day.index, kind))
                        ? 'Показать поля приёма'
                        : 'Свернуть поля приёма'
                    "
                    :data-test="`meal-add-toggle-${day.index}-${kind}`"
                    @click="toggleEdit(mealKey(day.index, kind))"
                  >
                    <svg
                      viewBox="0 0 16 16"
                      class="h-3 w-3"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.6"
                      aria-hidden="true"
                    >
                      <path
                        v-if="isEditHidden(mealKey(day.index, kind))"
                        d="M4 6l4 4 4-4"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                      <path
                        v-else
                        d="M4 10l4-4 4 4"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                    </svg>
                  </button>

                  <button
                    type="button"
                    class="flex h-5 w-5 cursor-pointer items-center justify-center rounded-md border border-border text-muted transition-colors hover:border-primary hover:text-text"
                    :aria-expanded="!allCollapsed"
                    :aria-label="
                      allCollapsed
                        ? 'Развернуть все приёмы'
                        : 'Свернуть все приёмы'
                    "
                    :title="
                      allCollapsed
                        ? 'Развернуть все приёмы'
                        : 'Свернуть все приёмы'
                    "
                    :data-test="`meals-collapse-all-${day.index}-${kind}`"
                    @click="toggleAll"
                  >
                    <svg
                      viewBox="0 0 16 16"
                      class="h-3 w-3"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.6"
                      aria-hidden="true"
                    >
                      <template v-if="allCollapsed">
                        <path
                          d="M3 7l5 5 5-5"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                        <path
                          d="M3 2l5 5 5-5"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                      </template>
                      <template v-else>
                        <path
                          d="M3 9l5-5 5 5"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                        <path
                          d="M3 14l5-5 5 5"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                      </template>
                    </svg>
                  </button>
                </span>

                <span v-if="myPlan" class="flex items-center gap-1">
                  <button
                    type="button"
                    class="flex h-5 w-5 cursor-pointer items-center justify-center rounded-md border border-blue-300 text-blue-600 transition-colors hover:border-blue-500 hover:text-blue-700"
                    :aria-expanded="!isMyEditHidden(mealKey(day.index, kind))"
                    :aria-label="
                      isMyEditHidden(mealKey(day.index, kind))
                        ? 'Показать мои поля'
                        : 'Свернуть мои поля'
                    "
                    :title="
                      isMyEditHidden(mealKey(day.index, kind))
                        ? 'Показать мои поля'
                        : 'Свернуть мои поля'
                    "
                    :data-test="`my-meal-add-toggle-${day.index}-${kind}`"
                    @click="toggleMyEdit(mealKey(day.index, kind))"
                  >
                    <svg
                      viewBox="0 0 16 16"
                      class="h-3 w-3"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.6"
                      aria-hidden="true"
                    >
                      <path
                        v-if="isMyEditHidden(mealKey(day.index, kind))"
                        d="M4 6l4 4 4-4"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                      <path
                        v-else
                        d="M4 10l4-4 4 4"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                    </svg>
                  </button>

                  <button
                    type="button"
                    class="flex h-5 w-5 cursor-pointer items-center justify-center rounded-md border border-blue-300 text-blue-600 transition-colors hover:border-blue-500 hover:text-blue-700"
                    :aria-expanded="!allMyCollapsed"
                    :aria-label="
                      allMyCollapsed
                        ? 'Развернуть мои поля везде'
                        : 'Свернуть мои поля везде'
                    "
                    :title="
                      allMyCollapsed
                        ? 'Развернуть мои поля везде'
                        : 'Свернуть мои поля везде'
                    "
                    :data-test="`my-meals-collapse-all-${day.index}-${kind}`"
                    @click="toggleAllMy"
                  >
                    <svg
                      viewBox="0 0 16 16"
                      class="h-3 w-3"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.6"
                      aria-hidden="true"
                    >
                      <template v-if="allMyCollapsed">
                        <path
                          d="M3 7l5 5 5-5"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                        <path
                          d="M3 2l5 5 5-5"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                      </template>
                      <template v-else>
                        <path
                          d="M3 9l5-5 5 5"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                        <path
                          d="M3 14l5-5 5 5"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                      </template>
                    </svg>
                  </button>
                </span>
              </div>

              <!-- Строка 1: приём | фасовка | блюда -->
              <div class="grid gap-x-4 md:grid-cols-[9rem_12rem_1fr]">
                <div
                  class="flex"
                  :class="
                    isEditHidden(mealKey(day.index, kind))
                      ? 'flex-row flex-wrap items-baseline gap-2'
                      : 'flex-col items-start gap-1'
                  "
                >
                  <span class="text-sm font-medium text-text">
                    {{ day.index }}{{ TRIP_MEAL_CODES[kind] }} · {{ TRIP_MEAL_LABELS[kind] }}
                  </span>

                  <div
                    v-if="canEdit && !isEditHidden(mealKey(day.index, kind))"
                    class="flex flex-col items-start gap-1"
                    data-test="meal-form"
                  >
                    <button
                      v-for="form in TRIP_MEAL_FORMS"
                      :key="form"
                      type="button"
                      class="cursor-pointer rounded-lg border px-2 py-1 text-xs transition-colors disabled:opacity-60"
                      :class="
                        mealOf(day.index, kind)?.form === form
                          ? 'border-primary font-medium text-primary'
                          : 'border-border text-muted hover:text-text'
                      "
                      :disabled="busy === `${mealOf(day.index, kind)?.id}:form`"
                      :data-test="`meal-form-${form}`"
                      @click="mealOf(day.index, kind) && changeForm(mealOf(day.index, kind)!, form)"
                    >
                      {{ TRIP_MEAL_FORM_LABELS[form] }}
                    </button>
                  </div>

                  <p v-if="mealOf(day.index, kind) && mealOf(day.index, kind)!.weightGrams > 0" class="text-xs text-muted" data-test="meal-weight">
                    {{ formatWeight(mealOf(day.index, kind)?.weightGrams ?? 0) }}
                  </p>

                  <p
                    v-if="myMealWeight(day.index, kind) > 0"
                    class="text-xs text-blue-600"
                    data-test="my-meal-weight"
                  >
                    Мои продукты: {{ formatWeight(myMealWeight(day.index, kind)) }}
                  </p>
                </div>

                <div
                  v-if="!isEditHidden(mealKey(day.index, kind))"
                  class="flex flex-col gap-1 md:col-start-2"
                >
                  <span class="text-xs uppercase tracking-wide text-muted">ФАСОВКА по пакетам</span>
                  <button
                    v-if="canEdit && mealOf(day.index, kind)"
                    type="button"
                    class="cursor-pointer text-left text-xs transition-colors"
                    :class="
                      kulekOf(mealOf(day.index, kind)!)
                        ? 'font-medium text-primary'
                        : 'text-muted underline hover:text-text'
                    "
                    :data-test="`meal-kulek-${day.index}-${kind}`"
                    @click="toggleKulek(mealOf(day.index, kind)!)"
                  >
                    <template v-if="kulekOf(mealOf(day.index, kind)!)">кулёк собран</template>
                    <template v-else>всё в отдельный кулёк</template>
                  </button>
                </div>

                <div class="flex flex-col gap-2 md:col-start-3" :class="formsPad">
                  <!-- 1. Мои блюда -->
                  <div
                    v-if="myPlan && !isMyEditHidden(mealKey(day.index, kind))"
                    class="flex flex-col gap-1"
                    data-test="my-meal-dish-block"
                  >
                    <span class="text-xs uppercase tracking-wide text-blue-700">Блюда мои</span>
                    <select
                      v-model="myDishDrafts[mealKey(day.index, kind)]"
                      class="w-full rounded-lg border border-blue-300 bg-field px-2 py-1 text-xs text-blue-700 focus:border-blue-500 focus:outline-none"
                      :data-test="`my-meal-dish-select-${day.index}-${kind}`"
                      @change="addMyDish(day.index, kind)"
                    >
                      <option value="" disabled hidden>Выберите рецепт блюда</option>
                      <option
                        v-for="dish in myDishesFor(myMealOf(day.index, kind))"
                        :key="dish.id"
                        :value="dish.id"
                      >
                        {{ dish.title }}
                      </option>
                    </select>
                  </div>

                  <!-- 2. Мои продукты -->
                  <div
                    v-if="myPlan && !isMyEditHidden(mealKey(day.index, kind))"
                    class="flex flex-col gap-1"
                  >
                    <span class="text-xs uppercase tracking-wide text-blue-700">Продукты мои</span>

                    <div class="flex flex-col" data-test="my-meal-add">
                      <ProductPicker
                        :product="myLineDraft(mealKey(day.index, kind)).product"
                        :query="myLineDraft(mealKey(day.index, kind)).text"
                        class="[&_input]:rounded-b-none [&_input]:border-blue-300"
                        @select="chooseMyLineProduct(mealKey(day.index, kind), $event)"
                        @update:query="onMyLineQuery(day.index, kind, $event)"
                      />
                      <div class="flex items-center gap-1">
                        <input
                          v-model="myLineDraft(mealKey(day.index, kind)).amount"
                          type="number"
                          min="1"
                          step="1"
                          placeholder="кол-во"
                          class="-mt-px w-20 shrink-0 rounded-t-none rounded-b-lg border border-blue-300 bg-field px-2 py-1.5 text-xs text-text focus:border-blue-500 focus:outline-none"
                          :data-test="`my-meal-line-amount-${day.index}-${kind}`"
                        />
                        <button
                          type="button"
                          class="ml-auto shrink-0 cursor-pointer rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                          :disabled="!myLineReady(mealKey(day.index, kind)) || busy !== null"
                          :data-test="`my-meal-line-add-${day.index}-${kind}`"
                          @click="addMyLine(day.index, kind)"
                        >
                          Добавить
                        </button>
                      </div>
                    </div>
                  </div>

                  <!-- 3. Общие блюда -->
                  <template v-if="canEdit && !isEditHidden(mealKey(day.index, kind))">
                    <div class="flex flex-col gap-1">
                      <span class="text-xs uppercase tracking-wide text-muted">Блюда общие</span>
                      <select
                        v-model="dishDrafts[mealKey(day.index, kind)]"
                        class="w-full rounded-lg border border-border bg-field px-2 py-1 text-xs text-text focus:border-primary focus:outline-none"
                        :data-test="`meal-dish-select-${day.index}-${kind}`"
                        @change="addDish(day.index, kind)"
                      >
                        <option value="" disabled hidden>Выберите рецепт блюда</option>
                        <option
                          v-for="dish in dishesFor(mealOf(day.index, kind))"
                          :key="dish.id"
                          :value="dish.id"
                        >
                          {{ dish.title }}
                        </option>
                      </select>
                    </div>

                    <!-- 4. Общие продукты -->
                    <div class="flex flex-col gap-1">
                      <span class="text-xs uppercase tracking-wide text-muted">Продукты общие</span>

                      <div class="flex flex-col" data-test="meal-add">
                        <ProductPicker
                          :product="lineDraft(mealKey(day.index, kind)).product"
                          :query="lineDraft(mealKey(day.index, kind)).text"
                          class="[&_input]:rounded-b-none"
                          @select="chooseLineProduct(mealKey(day.index, kind), $event)"
                          @update:query="onLineQuery(day.index, kind, $event)"
                        />
                        <div class="flex items-center gap-1">
                          <input
                            v-model="lineDraft(mealKey(day.index, kind)).amount"
                            type="number"
                            min="1"
                            step="1"
                            placeholder="кол-во"
                            class="-mt-px w-20 shrink-0 rounded-t-none rounded-b-lg border border-border bg-field px-2 py-1.5 text-xs text-text focus:border-primary focus:outline-none"
                            :data-test="`meal-line-amount-${day.index}-${kind}`"
                          />
                          <button
                            type="button"
                            class="ml-auto shrink-0 cursor-pointer rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                            :disabled="!lineReady(mealKey(day.index, kind)) || busy !== null"
                            :data-test="`meal-line-add-${day.index}-${kind}`"
                            @click="addLine(day.index, kind)"
                          >
                            Добавить
                          </button>
                        </div>
                      </div>
                    </div>
                  </template>
                </div>
              </div>

              <!-- Результат личной еды: свои блюда и продукты, выше общих -->
              <template v-if="myMealOf(day.index, kind)">
                <div
                  v-for="dish in myMealOf(day.index, kind)!.dishes"
                  :key="`my-dish-${dish.dishId}`"
                  class="grid gap-x-4 md:grid-cols-[9rem_12rem_1fr]"
                  data-test="my-meal-dish"
                >
                  <div class="flex flex-col gap-1 md:col-start-3">
                    <div class="flex items-start justify-between gap-2">
                      <span class="font-medium text-blue-700">{{ dish.title }}</span>
                      <button
                        type="button"
                        class="cursor-pointer text-xs text-blue-600 underline transition-colors hover:text-blue-800"
                        :data-test="`my-meal-dish-remove-${dish.dishId}`"
                        @click="removeMyDish(day.index, kind, dish.dishId)"
                      >
                        убрать
                      </button>
                    </div>

                    <!-- Состав: такой же чип, как в общем слое, только синий -->
                    <div v-if="dish.ingredients.length" class="flex flex-wrap gap-1">
                      <span
                        v-for="ingredient in dish.ingredients"
                        :key="ingredient.productId"
                        class="flex items-center gap-1"
                      >
                        <span
                          class="rounded-full border px-2 py-0.5 text-xs transition-colors"
                          :class="
                            dish.excludedProductIds.includes(ingredient.productId)
                              ? 'border-dashed border-blue-300 text-blue-300 line-through'
                              : 'border-blue-300 text-blue-700'
                          "
                        >
                          {{ ingredient.name }}
                          {{ formatProductAmount(ingredient.amount, ingredient.unit) }}
                        </span>
                        <button
                          type="button"
                          class="cursor-pointer text-xs text-blue-600 transition-colors hover:text-blue-800"
                          :title="
                            dish.excludedProductIds.includes(ingredient.productId)
                              ? 'Вернуть ингредиент'
                              : 'Убрать ингредиент'
                          "
                          :data-test="`my-dish-ing-${dish.dishId}-${ingredient.productId}`"
                          @click="toggleMyDishIngredient(day.index, kind, dish, ingredient.productId)"
                        >
                          {{ dish.excludedProductIds.includes(ingredient.productId) ? '+' : '×' }}
                        </button>
                      </span>
                    </div>
                  </div>
                </div>

                <ul class="flex flex-col gap-1" data-test="my-meal-products">
                  <li
                    v-for="product in myMealOf(day.index, kind)!.products.filter((row) => row.manualAmount > 0)"
                    :key="`my-product-${product.productId}`"
                    class="grid gap-x-4 md:grid-cols-[9rem_12rem_1fr]"
                    data-test="my-meal-product"
                  >
                    <div class="flex flex-wrap items-baseline gap-2 md:col-start-3">
                      <span class="font-medium text-blue-700">{{ product.name }}</span>
                      <span class="text-xs text-blue-600">
                        {{ formatProductAmount(product.amount, product.unit) }}
                      </span>
                      <button
                        type="button"
                        class="ml-auto cursor-pointer text-xs text-blue-600 transition-colors hover:text-blue-800"
                        title="Убрать продукт"
                        :data-test="`my-meal-line-remove-${product.productId}`"
                        @click="removeMyLine(day.index, kind, product.productId)"
                      >
                        ×
                      </button>
                    </div>
                  </li>
                </ul>
              </template>

              <template v-if="mealOf(day.index, kind)">
                <!-- Строки блюд: пары фасовки слева, блюдо справа -->
                <div
                  v-for="dish in mealOf(day.index, kind)!.dishes"
                  :key="dish.dishId"
                  class="flex flex-col gap-1"
                  data-test="meal-dish"
                >
                  <div class="grid gap-x-4 md:grid-cols-[9rem_12rem_1fr]">
                    <div class="flex items-start justify-between gap-2 md:col-start-3">
                      <span class="font-medium text-text">{{ dish.title }}</span>
                      <button
                        v-if="canEdit"
                        type="button"
                        class="cursor-pointer text-xs text-muted underline transition-colors hover:text-text"
                        :data-test="`meal-dish-remove-${dish.dishId}`"
                        @click="removeDish(day.index, kind, dish.dishId)"
                      >
                        убрать
                      </button>
                    </div>
                  </div>

                  <div
                    v-if="dish.ingredients.length"
                    class="grid gap-x-4 text-[10px] uppercase leading-none text-muted md:grid-cols-[9rem_12rem_1fr]"
                  >
                    <span class="hidden md:col-start-1 md:block"></span>
                    <span class="flex gap-1 md:col-start-2">
                      <span class="flex-1">в пакет</span>
                      <span class="w-16 text-center">КОЛ-ВО</span>
                    </span>
                  </div>

                  <template
                    v-for="ingredient in dish.ingredients"
                    :key="ingredient.productId"
                  >
                    <div
                      v-for="row in ingredientRows(mealOf(day.index, kind), ingredient)"
                      :key="row.key"
                      class="grid gap-x-4 md:grid-cols-[9rem_12rem_1fr]"
                      :data-test="`ing-row-${dish.dishId}-${ingredient.productId}-${row.position}`"
                    >
                      <div
                        v-if="productById(mealOf(day.index, kind)!, ingredient.productId)"
                        class="flex gap-1 md:col-start-2"
                      >
                        <select
                          :value="row.packageId"
                          :data-test="shareTest('ing-pack', dish.dishId + '-' + ingredient.productId, row)"
                          class="min-w-0 flex-1 rounded border border-border bg-field px-1 py-0.5 text-xs text-text"
                          @change="setIngredientPack(day.index, kind, ingredient.productId, row, $event)"
                        >
                          <option value="" disabled></option>
                          <option value="__new__">новый пакет</option>
                          <option
                            v-for="pack in packOptions(mealOf(day.index, kind), row)"
                            :key="pack.id"
                            :value="pack.id"
                          >
                            {{ packLabel(pack) }}
                          </option>
                        </select>
                        <select
                          :value="amountValue(row)"
                          :disabled="row.isFree || isKulekRow(mealOf(day.index, kind), row)"
                          :data-test="shareTest('ing-amount', dish.dishId + '-' + ingredient.productId, row)"
                          class="w-16 shrink-0 rounded border border-border bg-field px-1 py-0.5 text-xs text-text disabled:opacity-50"
                          @change="setIngredientAmount(day.index, kind, ingredient.productId, row, $event)"
                        >
                          <option value="" disabled></option>
                          <option value="all">всё</option>
                          <option
                            v-for="n in amountOptions(productById(mealOf(day.index, kind)!, ingredient.productId), row)"
                            :key="n"
                            :value="String(n)"
                          >
                            {{ n }}
                          </option>
                        </select>
                      </div>

                      <div class="flex items-center gap-1 md:col-start-3">
                        <!--
                          Родитель показывает ровно то, что лежит в пакете,
                          остаток — то, что осталось: обводка и крестик у них
                          одинаковые, отличается только вес.
                        -->
                        <span
                          class="rounded-full border px-2 py-0.5 text-xs transition-colors"
                          :class="
                            dish.excludedProductIds.includes(ingredient.productId)
                              ? 'border-dashed border-border text-muted line-through'
                              : 'border-border text-text'
                          "
                          :data-test="shareTest('dish-ing', dish.dishId + '-' + ingredient.productId, row)"
                        >
                          {{ ingredient.name }}
                          {{ formatProductAmount(row.amount, ingredient.unit) }}
                        </span>

                        <button
                          v-if="canEdit"
                          type="button"
                          class="cursor-pointer text-xs text-muted transition-colors hover:text-text"
                          :title="
                            dish.excludedProductIds.includes(ingredient.productId)
                              ? 'Вернуть ингредиент'
                              : removeHint(row, mealOf(day.index, kind), 'ингредиент')
                          "
                          :data-test="`ing-action-${dish.dishId}-${ingredient.productId}-${row.position}`"
                          @click="ingredientAction(day.index, kind, dish, ingredient, row)"
                        >
                          {{ dish.excludedProductIds.includes(ingredient.productId) ? '+' : '×' }}
                        </button>
                      </div>
                    </div>
                  </template>
                </div>

                <div
                  v-if="mealOf(day.index, kind)!.products.some((row) => row.manualAmount > 0)"
                  class="grid gap-x-4 text-[10px] uppercase leading-none text-muted md:grid-cols-[9rem_12rem_1fr]"
                >
                  <span class="hidden md:col-start-1 md:block"></span>
                  <span class="flex gap-1 md:col-start-2">
                    <span class="flex-1">в пакет</span>
                    <span class="w-16 text-center">КОЛ-ВО</span>
                  </span>
                </div>

                <!-- Строки продуктов: пара фасовки + продукт -->
                <ul class="flex flex-col gap-1" data-test="meal-products">
                  <template
                    v-for="product in mealOf(day.index, kind)!.products.filter((row) => row.manualAmount > 0)"
                    :key="product.productId"
                  >
                    <li
                      v-for="row in packRows(product)"
                      :key="row.key"
                      class="grid gap-x-4 md:grid-cols-[9rem_12rem_1fr]"
                      :data-test="`meal-product-${product.productId}-${row.position}`"
                    >
                      <div class="flex flex-col gap-0.5 md:col-start-2">
                        <template v-if="canEdit && packsFor(mealOf(day.index, kind)).length > 0">
                          <div class="flex gap-1" :data-test="`product-packs-${product.productId}`">
                            <select
                              :value="row.packageId"
                              :data-test="shareTest('alloc-pack', String(product.productId), row)"
                              class="min-w-0 flex-1 rounded border border-border bg-field px-1 py-0.5 text-xs text-text"
                              @change="setRowPack(day.index, kind, product, row, $event)"
                            >
                              <option value="" disabled></option>
                              <option value="__new__">новый пакет</option>
                              <option
                                v-for="pack in packOptions(mealOf(day.index, kind), row)"
                                :key="pack.id"
                                :value="pack.id"
                              >
                                {{ packLabel(pack) }}
                              </option>
                            </select>
                            <select
                              :value="amountValue(row)"
                              :disabled="row.isFree || isKulekRow(mealOf(day.index, kind), row)"
                              :data-test="shareTest('alloc-amount', String(product.productId), row)"
                              class="rounded border border-border bg-field px-1 py-0.5 text-xs text-text disabled:opacity-50"
                              @change="setRowAmount(day.index, kind, product, row, $event)"
                            >
                              <option value="" disabled></option>
                              <option value="all">всё</option>
                              <option v-for="n in amountOptions(product, row)" :key="n" :value="String(n)">
                                {{ n }}
                              </option>
                            </select>
                          </div>
                          <span
                            v-if="row.position === 0 && overAllocated(product) > 0"
                            class="text-xs text-amber-700"
                          >
                            сверх рецепта: {{ formatProductAmount(overAllocated(product), product.unit) }}
                          </span>
                        </template>
                      </div>

                      <div class="flex flex-wrap items-baseline gap-2 text-sm text-text md:col-start-3">
                        <span class="font-medium">{{ product.name }}</span>
                        <span class="text-xs text-muted">
                          {{ formatProductAmount(row.amount, product.unit) }}
                        </span>
                        <span
                          v-if="row.position === 0 && product.isMeat"
                          class="text-xs text-muted"
                        >
                          мясное · {{ meatPortion }}
                        </span>
                        <button
                          v-if="canEdit"
                          type="button"
                          class="cursor-pointer text-xs text-muted transition-colors hover:text-text"
                          :title="removeHint(row, mealOf(day.index, kind), 'продукт')"
                          :data-test="shareTest('meal-line-remove', String(product.productId), row)"
                          @click="removeProductRow(day.index, kind, product, row)"
                        >
                          ×
                        </button>
                      </div>
                    </li>
                  </template>
                </ul>


              </template>

              <p v-else class="text-sm text-muted" data-test="meal-empty">Пусто</p>
            </article>
          </div>
        </section>
      </details>

      <!-- Фасовка: пакеты. Свёртывается так же, как раскладка; свой
           фиолетовый фон отличает её от раскладки -->
      <details
        open
        class="flex flex-col gap-3 rounded-2xl border border-violet-300 bg-violet-100 p-3"
        data-test="packages"
      >
        <summary class="cursor-pointer select-none text-sm text-violet-900">Пакеты</summary>


        <!--
          Мои продукты: итог по личным приёмам, без пакета в БД. В общее
          распределение не входит — это своя ноша в рюкзаке; здесь только
          вес и контрольное взвешивание.
        -->
        <div
          v-if="myProductsWeight > 0"
          class="flex flex-col gap-2 rounded-xl border border-blue-300 bg-blue-50 p-3"
          data-test="my-products"
        >
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <h3 class="text-sm font-medium text-blue-700">Мои продукты</h3>
            <span class="text-xs text-blue-600">
              расчётно: {{ formatWeight(myProductsWeight) }}
            </span>
          </div>

          <label class="flex items-center gap-1 text-xs text-blue-700">
            факт:
            <input
              type="number"
              min="1"
              step="1"
              :value="myFoodActualGrams ?? ''"
              placeholder="—"
              class="w-20 rounded-lg border border-blue-300 bg-field px-2 py-1 text-xs text-text focus:border-blue-500 focus:outline-none"
              data-test="my-products-weight"
              @change="saveMyFoodWeight($event)"
            />
            г
          </label>

          <ul class="flex flex-col gap-0.5">
            <li v-for="row in myProducts" :key="row.key" class="text-xs text-blue-600">
              {{ row.name }} — {{ formatWeight(row.weightGrams) }}
            </li>
          </ul>
        </div>
        <p v-if="plan.packages.length === 0" class="text-sm text-muted" data-test="packages-empty">
          Пакетов пока нет.
        </p>

        <ul v-else class="mt-1 flex flex-col gap-2">
          <li
            v-for="pack in plan.packages"
            :key="pack.id"
            class="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3 text-sm"
            data-test="package"
          >
            <div class="flex w-full flex-wrap items-center gap-2">
              <input
                v-if="canEdit && pack.kind !== 'kulek'"
                :value="pack.name"
                type="text"
                maxlength="60"
                class="w-32 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm text-text transition-colors hover:border-border focus:border-primary focus:bg-field focus:outline-none"
                data-test="package-name"
                @change="savePackageName(pack, $event)"
              />
              <span v-else class="text-text">{{ pack.name }}</span>

              <span v-if="pack.kind === 'kulek'" class="text-xs text-muted">кулёк</span>

              <template v-if="canEdit">
                <template v-if="confirmingPackageId === pack.id && pack.items.length > 0">
                  <span class="text-xs text-muted">Удалить?</span>
                  <button
                    type="button"
                    class="cursor-pointer rounded-lg border border-red-600 px-2 py-0.5 text-xs text-red-600"
                    data-test="package-delete-confirm"
                    @click="removePackage(pack)"
                  >
                    Да
                  </button>
                  <button
                    type="button"
                    class="cursor-pointer rounded-lg border border-border px-2 py-0.5 text-xs text-muted"
                    data-test="package-delete-cancel"
                    @click="confirmingPackageId = null"
                  >
                    Нет
                  </button>
                </template>
                <button
                  v-else
                  type="button"
                  class="ml-auto cursor-pointer text-xs text-muted underline"
                  data-test="package-delete"
                  @click="
                    pack.items.length === 0
                      ? removePackage(pack)
                      : (confirmingPackageId = pack.id)
                  "
                >
                  Удалить
                </button>
              </template>
            </div>

            <div
              v-if="pack.items.length"
              class="flex w-full flex-wrap items-center gap-2"
            >
              <span class="text-xs text-muted">
                расчётно: {{ formatWeight(pack.weightEstimatedGrams) }}
              </span>

              <label v-if="canEdit" class="flex items-center gap-1 text-xs text-muted">
                факт:
                <input
                  type="number"
                  min="1"
                  step="1"
                  :value="pack.weightActualGrams ?? ''"
                  placeholder="—"
                  class="w-20 rounded-lg border border-border bg-field px-2 py-1 text-xs text-text focus:border-primary focus:outline-none"
                  data-test="package-weight"
                  @change="savePackageWeight(pack, $event)"
                />
                г
              </label>
              <span v-else-if="pack.weightActualGrams !== null" class="text-xs text-muted">
                факт: {{ formatWeight(pack.weightActualGrams) }}
              </span>

              <!-- Невзвешенному нужен первый вес, взвешенному — новый,
                   если содержимое поменялось. Два разных повода, две метки. -->
              <span
                v-if="pack.weightActualGrams === null"
                class="text-xs text-amber-700"
                data-test="package-unweighed"
              >
                не взвешен
              </span>
              <span
                v-else-if="pack.weightActualStale"
                class="text-xs text-amber-700"
                data-test="package-stale"
              >
                требуется перевзвесить
              </span>
            </div>

            <p v-else class="w-full text-xs text-muted">пустой</p>

            <ul v-if="pack.items.length" class="w-full border-t border-border pt-2">
              <li
                v-for="item in pack.items"
                :key="item.mealId + String(item.productId)"
                class="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted"
              >
                {{ item.name }} — {{ formatWeight(item.weightGrams) }}
              </li>
            </ul>
          </li>
        </ul>

        <div v-if="canEdit" class="mt-1 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            class="cursor-pointer rounded-lg border border-border bg-surface px-2 py-1 text-xs text-violet-900 shadow-sm transition-colors hover:border-violet-400"
            data-test="package-add"
            @click="addPackage"
          >
            Добавить пакет
          </button>
        </div>

        <div v-if="unpackedRows.length" class="mt-1 flex flex-col gap-1" data-test="unpacked">
          <p class="text-xs text-muted">Не расфасовано:</p>
          <ul class="flex flex-col gap-0.5">
            <li v-for="row in unpackedRows" :key="row.key" class="text-xs text-muted">
              {{ row.meal }} · {{ row.name }} — {{ formatProductAmount(row.left, row.unit) }}
            </li>
          </ul>
        </div>
      </details>

      <!-- Список покупок: модалка, содержимое грузит она сама -->
      <TripMealShoppingModal
        v-if="shoppingOpen"
        :trip-id="trip.id"
        @close="shoppingOpen = false"
      />

      <!-- Список моих продуктов: тот же экран, личные строки и отметки -->
      <TripMealShoppingModal
        v-if="myShoppingOpen"
        :trip-id="trip.id"
        personal
        @close="myShoppingOpen = false"
      />

      <!-- Чат питания: обсуждение раскладки и закупки -->
      <TripChat :trip-id="trip.id" kind="trip_meals" />
    </template>
  </section>
</template>
