<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import type { GearItem } from '@/types/gear'
import { weightInGrams } from '@/utils/gearWeight'

/**
 * Выбор вещи для кнопки «Добавить ещё» (01.11.2026).
 *
 * Заказчик: «Добавить на всех секциях (Палатки, Готовка (3 шт), Спальник)
 * кнопку „Добавить ещё“. По этой кнопке выбор из личного снаряжения или
 * добавка вручную незабинденного снаряжения. Например, вкладыш в спальник,
 * грелка, губка для мытья посуды. Предлагать в фильтре выбора сначала
 * соответствующую группу, но вообще, может хоть лодку выбрать. Кнопка
 * всегда белая».
 *
 * Отсюда три правила компонента:
 *
 * 1. **Список — весь личный каталог**, а не только типы секции: фильтра
 *    по типу здесь нет вовсе («может хоть лодку выбрать»). Вещь, которая
 *    уже в походе, не предлагается: второй раз её не добавят (409).
 * 2. **Сначала — соответствующая полка.** `preferredGroupCodes` — полки
 *    секции (у «Палаток» это «Кров», у «Кострового» — «Костровое»);
 *    остальные идут после, и внутри полки первыми стоят вещи типов секции.
 *    Порядок влияет только на показ: выбрать можно что угодно.
 * 3. **Компонент не сохраняет.** Выбранную вещь и «Добавить вручную» он
 *    отдаёт событиями: сохраняет секция, потому что у «Палаток» это
 *    снаряжение похода, а у «Спальника» — личная строка ночёвки, и пути
 *    у них разные.
 *
 * Поиск — по названию, типу и полке: каталог бывает длинным, а человек
 * помнит слово («котёл», «спальник»), а не полку.
 *
 * **Фильтр по группам (03.11.2026).** Заказчик попросил рядом с поиском
 * список групп: длинный каталог быстрее сузить полкой, чем вспоминать
 * название. Полки идут в том же порядке, что и в списке (полки секции
 * первыми), «Все» снимает фильтр. Фильтр складывается с поиском: выбрать
 * «Кров» и набрать «2» — значит «двушка в „Крове“».
 *
 * **Список прокручивается внутри модалки (03.11.2026).** «Все» показывает
 * весь свободный каталог, и на 100+ вещах страница уезжала: «Отмена»
 * и «Добавить вручную» оказывались под длинным списком. Теперь прокрутка
 * живёт в середине, а поиск, чипы и нижние кнопки стоят на месте. До сотни
 * записей это дешевле серверной пагинации; если каталоги вырастут
 * до тысяч, понадобится поиск на сервере.
 *
 * **Группы сворачиваются и помнят состояние (05.11.2026).** Заказчик:
 * «Снаряги может быть очень много… добавь кнопку-галочку „Свернуть/Развернуть
 * группу“ и пусть при первом открытии модалки они будут свёрнуты, а потом
 * страница помнит что свёрнуто и повторное открытие воссоздаёт последнее
 * состояние». Помним именно **развёрнутые** группы: новая группа и новый
 * каталог показываются свёрнутыми, как при первом открытии. Ключ памяти —
 * проп `storageKey`: у вкладки «Снаряжение» похода будет свой набор групп
 * и своя память, а все секции «Ночёвок» делят один ключ, поэтому «Кров»
 * свёрнут одинаково в «Палатках» и в «Готовке». Поиск раскрывает найденные
 * группы, не трогая память: иначе слово в поиске давало бы одни заголовки.
 *
 * **Модалка — общая для всех, кто собирает снаряжение (05.11.2026).**
 * Её же откроет вкладка «Снаряжение» похода; поэтому подпись, ключ памяти
 * и показ «уже взятого» — пропы, а не константы. Сохранение остаётся
 * за родителем: у «Ночёвок» это снаряжение похода или личная строка,
 * у вкладки «Снаряжение» будет свой путь.
 */
const props = defineProps<{
  /** Весь личный каталог: `GET /api/gear`. */
  items: readonly GearItem[]
  /** Что уже в походе: повторно не предлагаем. */
  excludeIds?: readonly string[]
  /** Полки секции — их показываем первыми, в этом порядке. */
  preferredGroupCodes?: readonly string[]
  /** Типы секции — они стоят первыми внутри любой полки. */
  preferredTypeCodes?: readonly string[]
  /** Заголовок модалки: «Добавить ещё» у всех секций один и тот же. */
  title?: string
  /** Подпись под заголовком; у «Снаряжения» похода будет своя. */
  subtitle?: string
  /**
   * Ключ localStorage для развёрнутых групп.
   *
   * Общий для всех секций «Ночёвок»: состояние группы не зависит от того,
   * из какой секции открыли каталог.
   */
  storageKey?: string
  /** Каталог ещё едет: показываем «Загружаем…», а не пустой список. */
  loading?: boolean
}>()

const emit = defineEmits<{
  /** Вещь выбрали: сохраняет родитель. */
  pick: [item: GearItem]
  /** Вещи нет в каталоге — открываем «Добавить вручную». */
  manual: []
  close: []
}>()

const search = ref('')

/** Выбранная полка; `null` — «Все». */
const selectedGroup = ref<string | null>(null)

/** Что можно предложить: всё, кроме уже добавленного в поход. */
const available = computed(() => {
  const taken = new Set(props.excludeIds ?? [])

  return props.items.filter((item) => !taken.has(item.id))
})

/** Полка в списке: её имя и вещи в нужном порядке. */
interface PickerGroup {
  code: string
  name: string
  items: GearItem[]
}

/**
 * Порядок полок: сначала «свои» полки секции, потом остальные.
 *
 * `indexOf` по двум спискам, а не `sort` по имени: порядок, который задал
 * заказчик («сначала соответствующую группу»), важнее алфавита.
 */
function groupRank(code: string): number {
  const preferred = props.preferredGroupCodes ?? []
  const index = preferred.indexOf(code)

  return index === -1 ? preferred.length : index
}

function typeRank(typeCode: string): number {
  const preferred = props.preferredTypeCodes ?? []
  const index = preferred.indexOf(typeCode)

  return index === -1 ? preferred.length : index
}

/** Полки для фильтра: только те, в которых есть что предложить. */
const groupOptions = computed<{ code: string; name: string }[]>(() => {
  const byCode = new Map<string, string>()

  for (const item of available.value) {
    if (!byCode.has(item.groupCode)) byCode.set(item.groupCode, item.groupName)
  }

  return [...byCode.entries()]
    .map(([code, name]) => ({ code, name }))
    .sort(
      (left, right) =>
        groupRank(left.code) - groupRank(right.code) ||
        left.name.localeCompare(right.name, 'ru'),
    )
})

/**
 * Сколько групп ещё показываем чипами.
 *
 * Как и у мест в «Поиске снаряжения», восемь — предел: дальше ряд чипов
 * растёт в облако и съедает высоту списка. Тогда группа выбирается
 * выпадающим списком из тех же значений.
 */
const GROUP_CHIPS_LIMIT = 8

const isGroupChips = computed(() => groupOptions.value.length <= GROUP_CHIPS_LIMIT)

/**
 * Полка, которая реально фильтрует.
 *
 * Вещь убрали из похода или поиск поменял набор полок — выбранной может
 * уже не быть. Тогда фильтр считается снятым, а не пустым списком: иначе
 * модалка выглядела бы сломанной.
 */
const activeGroup = computed<string | null>(() => {
  const code = selectedGroup.value

  if (code === null) return null

  return groupOptions.value.some((group) => group.code === code) ? code : null
})

/** Отфильтровано полкой и поиском: полка сужает, поиск ищет внутри. */
const filtered = computed<GearItem[]>(() => {
  const byGroup =
    activeGroup.value === null
      ? [...available.value]
      : available.value.filter((item) => item.groupCode === activeGroup.value)

  const query = search.value.trim().toLowerCase()

  if (query === '') return byGroup

  return byGroup.filter((item) =>
    [item.title, item.typeName, item.groupName].some((field) =>
      field.toLowerCase().includes(query),
    ),
  )
})

/** Каталог полками — как «Снаряжение» в профиле и выбор вещи в чек-листах. */
const groups = computed<PickerGroup[]>(() => {
  const byCode = new Map<string, PickerGroup>()

  for (const item of filtered.value) {
    const group = byCode.get(item.groupCode) ?? {
      code: item.groupCode,
      name: item.groupName,
      items: [],
    }

    group.items.push(item)
    byCode.set(item.groupCode, group)
  }

  return [...byCode.values()]
    .sort(
      (left, right) =>
        groupRank(left.code) - groupRank(right.code) ||
        left.name.localeCompare(right.name, 'ru'),
    )
    .map((group) => ({
      ...group,
      items: [...group.items].sort(
        (left, right) =>
          typeRank(left.typeCode) - typeRank(right.typeCode) ||
          left.title.localeCompare(right.title, 'ru'),
      ),
    }))
})

// ─────────────────── свёрнутые группы и их память ───────────────────

/** Ключ по умолчанию: один на все секции «Ночёвок». */
const DEFAULT_STORAGE_KEY = 'ph.tripExtraPicker.expandedGroups'

const storageKey = computed(() => props.storageKey ?? DEFAULT_STORAGE_KEY)

/**
 * Развёрнутые группы из localStorage.
 *
 * Храним именно **развёрнутые**, чтобы новая группа появлялась свёрнутой.
 * Мусор и чужой формат считаем пустым состоянием: модалка важнее памяти.
 */
function readExpandedGroups(): Set<string> {
  try {
    const raw = window.localStorage.getItem(storageKey.value)
    if (raw === null) return new Set()

    const parsed: unknown = JSON.parse(raw)

    return Array.isArray(parsed)
      ? new Set(parsed.filter((code): code is string => typeof code === 'string'))
      : new Set()
  } catch {
    return new Set()
  }
}

const expandedGroups = ref<Set<string>>(readExpandedGroups())

watch(
  expandedGroups,
  (codes) => {
    try {
      window.localStorage.setItem(storageKey.value, JSON.stringify([...codes]))
    } catch {
      // Приватный режим Safari и переполненное хранилище: состояние остаётся
      // в памяти на эту модалку, просто не переживает закрытие.
    }
  },
  { deep: true },
)

/** Свёрнута ли группа: при первом открытии — все. */
function isGroupCollapsed(code: string): boolean {
  // Поиск показывает найденное, а не прячет за заголовком: иначе человек
  // ввёл «котёл», увидел одну строку «Кухня · 1 ед.» и решил, что поиск
  // сломан. Состояние групп при этом не трогаем — сняли поиск, вернулось.
  if (search.value.trim() !== '') return false

  return !expandedGroups.value.has(code)
}

/** Идёт поиск: группы раскрыты, кнопки сворачивания не нужны. */
const isSearching = computed(() => search.value.trim() !== '')

function toggleGroup(code: string): void {
  const next = new Set(expandedGroups.value)
  if (next.has(code)) next.delete(code)
  else next.add(code)

  expandedGroups.value = next
}

/** Все видимые группы свёрнуты — тогда общая кнопка разворачивает. */
const allGroupsCollapsed = computed(
  () => groups.value.length > 0 && groups.value.every((group) => isGroupCollapsed(group.code)),
)

function toggleAllGroups(): void {
  const next = new Set(expandedGroups.value)

  if (allGroupsCollapsed.value) {
    for (const group of groups.value) next.add(group.code)
  } else {
    for (const group of groups.value) next.delete(group.code)
  }

  expandedGroups.value = next
}

/**
 * Выбрали группу в фильтре — показываем её вещи.
 *
 * Свёрнутая группа при выбранном фильтре выглядела бы поломкой: человек
 * сузил список до пяти вещей и не увидел ни одной. Разворачиваем её
 * и запоминаем, как обычное действие человека.
 */
function selectGroup(code: string | null): void {
  selectedGroup.value = code
  if (code === null) return

  const next = new Set(expandedGroups.value)
  next.add(code)
  expandedGroups.value = next
}

/** Значение для `select`: `activeGroup` — код или `null`, у списка — пустая строка. */
const selectedGroupValue = computed<string>({
  get: () => activeGroup.value ?? '',
  set: (value) => {
    selectGroup(value === '' ? null : value)
  },
})

/** Строка вещи: «Котёл 5 л · Котёл · 900 гр.». */
function itemText(item: GearItem): string {
  const weight = weightInGrams(item.weightGrams)
  const head = item.title === item.typeName ? item.title : `${item.title} · ${item.typeName}`

  return weight === null ? head : `${head} · ${weight}`
}

/** Нажали на вещь: выбор отдаём секции. */
function pick(item: GearItem): void {
  emit('pick', item)
}
</script>

<template>
  <div
    class="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4"
    data-test="route-extra-picker"
  >
    <div
      class="flex max-h-[calc(100dvh_-_2rem)] w-full max-w-lg flex-col gap-3 rounded-xl border border-border bg-surface p-4"
    >
      <div class="flex shrink-0 flex-col gap-1">
        <h3 class="text-base font-medium text-text">{{ title ?? 'Добавить ещё' }}</h3>
        <p class="text-xs text-muted" data-test="route-extra-subtitle">
          {{ subtitle ?? 'Любую вещь из личного снаряжения или создать новую.' }}
        </p>
      </div>

      <label class="flex shrink-0 flex-col gap-1 text-xs text-muted">
        Поиск
        <input
          v-model="search"
          type="search"
          class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none"
          placeholder="Название, тип или группа"
          data-test="route-extra-search"
        />
      </label>

      <!--
        Список-фильтр по группам: полки идут в том же порядке, что и блоки
        ниже, «Все» снимает фильтр. Складывается с поиском, а не заменяет его.
      -->
      <div
        v-if="groupOptions.length > 1"
        class="flex shrink-0 flex-col gap-1"
        data-test="route-extra-chips"
      >
        <span class="text-xs text-muted">Группа</span>
        <div v-if="isGroupChips" class="flex flex-wrap gap-1.5">
          <button
            type="button"
            class="cursor-pointer rounded-xl border px-3 py-1.5 text-sm transition-colors"
            :class="
              activeGroup === null
                ? 'border-primary bg-primary/10 font-medium text-text'
                : 'border-border bg-field text-muted hover:border-primary hover:text-text'
            "
            :aria-pressed="activeGroup === null"
            data-test="route-extra-filter-all"
            @click="selectGroup(null)"
          >
            Все
          </button>

          <button
            v-for="group in groupOptions"
            :key="group.code"
            type="button"
            class="cursor-pointer rounded-xl border px-3 py-1.5 text-sm transition-colors"
            :class="
              activeGroup === group.code
                ? 'border-primary bg-primary/10 font-medium text-text'
                : 'border-border bg-field text-muted hover:border-primary hover:text-text'
            "
            :aria-pressed="activeGroup === group.code"
            :data-test="`route-extra-filter-group-${group.code}`"
            @click="selectGroup(group.code)"
          >
            {{ group.name }}
          </button>
        </div>

        <!--
          Групп больше восьми — чипы превращаются в облако и съедают список;
          тогда тот же выбор живёт в выпадающем списке.
        -->
        <select
          v-else
          v-model="selectedGroupValue"
          class="w-full cursor-pointer rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none"
          data-test="route-extra-groups-select"
        >
          <option value="">Все</option>
          <option v-for="group in groupOptions" :key="group.code" :value="group.code">
            {{ group.name }}
          </option>
        </select>

        <p class="text-xs text-muted" data-test="route-extra-groups-hint">
          Показаны группы, в которых есть свободные вещи.
        </p>
      </div>

      <!--
        Список прокручивается внутри модалки, а поиск, чипы и нижние кнопки
        остаются на месте: на 100+ вещах «Отмена» и «Добавить вручную» иначе
        уезжают под длинный список. Шапка и подвал не сжимаются.
      -->
      <div
        class="min-h-0 flex-1 overflow-y-auto pr-1"
        data-test="route-extra-list"
      >
        <!--
          Общая кнопка: при первом открытии всё свёрнуто, а каталог бывает
          длинным. Сворачивает и разворачивает только видимые группы —
          состояние отфильтрованных не теряется.
        -->
        <div v-if="!loading && !isSearching && groups.length > 1" class="mb-2 flex justify-end">
          <button
            type="button"
            class="cursor-pointer rounded-xl border border-border px-3 py-1 text-xs text-muted transition-colors hover:border-primary hover:text-text"
            data-test="route-extra-collapse-all"
            @click="toggleAllGroups"
          >
            {{ allGroupsCollapsed ? 'Развернуть все группы' : 'Свернуть все группы' }}
          </button>
        </div>

        <p v-if="loading" class="text-sm text-muted" data-test="route-extra-loading">
          Загружаем снаряжение…
        </p>

        <p
          v-else-if="available.length === 0"
          class="text-sm text-muted"
          data-test="route-extra-empty"
        >
          В личном снаряжении ничего не осталось — заведите вещь вручную.
        </p>

        <p
          v-else-if="filtered.length === 0"
          class="text-sm text-muted"
          data-test="route-extra-not-found"
        >
          Поиск ничего не нашёл — попробуйте другое слово или заведите вещь вручную.
        </p>

        <div v-else class="flex flex-col gap-3">
          <div
            v-for="group in groups"
            :key="group.code"
            class="flex flex-col gap-1"
            :data-test="`route-extra-group-${group.code}`"
          >
            <div class="flex items-center justify-between gap-2">
              <div class="flex min-w-0 items-baseline gap-1">
                <span class="text-xs font-medium text-text">{{ group.name }}</span>
                <span class="text-xs text-muted">· {{ group.items.length }} ед.</span>
              </div>

              <button
                v-if="!isSearching"
                type="button"
                class="shrink-0 cursor-pointer rounded-lg border border-border px-2 py-0.5 text-xs text-muted transition-colors hover:border-primary hover:text-text"
                :aria-expanded="!isGroupCollapsed(group.code)"
                :data-test="`route-extra-toggle-${group.code}`"
                @click="toggleGroup(group.code)"
              >
                {{ isGroupCollapsed(group.code) ? 'Развернуть группу' : 'Свернуть группу' }}
              </button>
            </div>

            <div
              v-if="!isGroupCollapsed(group.code)"
              class="flex flex-col gap-1"
              :data-test="`route-extra-items-${group.code}`"
            >
              <button
                v-for="item in group.items"
                :key="item.id"
                type="button"
                class="cursor-pointer rounded-xl border border-border bg-field px-3 py-2 text-left text-sm text-text transition-colors hover:border-primary"
                :data-test="`route-extra-item-${item.id}`"
                @click="pick(item)"
              >
                {{ itemText(item) }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!--
        Вещи нет в каталоге — тот же путь, что «Добавить вручную»: губка
        для посуды, вкладыш в спальник. Форма общая.
      -->
      <button
        type="button"
        class="cursor-pointer self-start border-0 bg-transparent p-0 text-sm text-primary underline transition-opacity hover:opacity-80"
        data-test="route-extra-manual"
        @click="emit('manual')"
      >
        Добавить вручную
      </button>

      <div class="flex shrink-0 flex-wrap items-center gap-2">
        <button
          type="button"
          class="cursor-pointer rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-text transition-colors hover:border-primary"
          data-test="route-extra-cancel"
          @click="emit('close')"
        >
          Отмена
        </button>
      </div>
    </div>
  </div>
</template>
