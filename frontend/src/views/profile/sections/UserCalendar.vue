<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import type { CalendarDayType } from '@/api/calendar'
import { OVERFLOW_ICON_KEY } from '@/assets/activity-icons'
import ActivityIcon from '@/components/ui/ActivityIcon.vue'
import DayModal from '@/components/ui/DayModal.vue'
import MonthPickerModal from '@/components/ui/MonthPickerModal.vue'
import ProductionCalendarModal from '@/components/ui/ProductionCalendarModal.vue'
import YearFillDialog from '@/components/ui/YearFillDialog.vue'
import { useCalendarStore } from '@/stores/calendar'
import { upcomingNotice } from '@/utils/calendarNotice'
import {
  buildMonthGrid,
  fromIsoDate,
  longDate,
  monthTitle,
  toIsoDate,
  WEEKDAYS_SHORT,
  type CalendarDay,
} from '@/utils/calendar'

/**
 * Раздел «Календарь» личного кабинета.
 *
 * Показывает один месяц, листается по месяцам и годам, открывает модалку
 * дня и производственный календарь. Дни приходят из стора: сетка месяца
 * запрашивается вместе с хвостами соседних месяцев и кэшируется.
 *
 * Пока день не загружен, цвет считаем по дню недели — так сетка не мигает
 * серым, пока идёт запрос, и не выглядит сломанной при ошибке сети.
 * Как только пришёл настоящий статус (праздник, перенос, отпуск), берём его.
 *
 * `today` считаем один раз при создании компонента: страница, провисевшая
 * открытой до полуночи, не должна сама переезжать на новый день.
 */
const store = useCalendarStore()

const today = new Date()
const todayLabel = longDate(today)

/**
 * Показываемый месяц — всегда первое число.
 *
 * Первое, а не текущее число месяца: с 31-м числом арифметика месяцев
 * ломается (`new Date(2026, 0, 31).setMonth(1)` даёт 3 марта, потому что
 * в феврале 31-го нет). С первым числом переполнения не бывает никогда.
 */
const anchor = ref(new Date(today.getFullYear(), today.getMonth(), 1))

const weeks = computed(() => buildMonthGrid(anchor.value, today))
const title = computed(() => monthTitle(anchor.value))

/** Границы загружаемой сетки: первая и последняя клетка, включая хвосты. */
const gridFrom = computed(() => {
  const first = weeks.value[0]?.[0]
  return first ? first.iso : toIsoDate(anchor.value)
})
const gridTo = computed(() => {
  const lastWeek = weeks.value[weeks.value.length - 1]
  const last = lastWeek?.[lastWeek.length - 1]
  return last ? last.iso : toIsoDate(anchor.value)
})

const shownYear = computed(() => anchor.value.getFullYear())
const shownMonth = computed(() => anchor.value.getMonth())

/** Состояние показанного года: заполнен ли, какой режим, есть ли шаблон. */
const yearState = computed(() => store.years[shownYear.value] ?? null)

/**
 * Режим, который пользователь выбирал раньше, — для вопроса про следующий
 * год. Берём самый поздний известный год: если человек расписал 2031-й как
 * пенсию, а потом зашёл в 2026-й, вопрос про 2032-й должен быть про пенсию.
 */
const previousMode = computed(() => {
  const years = Object.keys(store.years)
    .map(Number)
    .filter((year) => year !== shownYear.value && store.years[year]?.mode)
    .sort((a, b) => b - a)

  const latest = years[0]
  return latest === undefined ? null : (store.years[latest]?.mode ?? null)
})

/**
 * Показан ли месяц, в котором мы живём: от этого зависит кнопка «Сегодня».
 */
const isCurrentMonth = computed(
  () =>
    anchor.value.getFullYear() === today.getFullYear() &&
    anchor.value.getMonth() === today.getMonth(),
)

const isPickingMonth = ref(false)
const isEditingProduction = ref(false)
const selectedDay = ref<Date | null>(null)
const isFillingYear = ref(false)

/**
 * Фраза о том, что впереди: «завтра выходной, ты уже всё спланировал?»,
 * «послезавтра Новый год — выходной», «в субботу короткий день».
 *
 * Считается по настоящему сегодня, а не по показанному месяцу: листая
 * прошлый год, человек всё равно хочет знать про свои ближайшие выходные.
 */
/** Иконка активности для клетки: ключ, цвет группы, подпись. */
interface CellIcon {
  id: number
  icon: string
  label: string
  color: string
}

/** Сколько иконок влезает в клетку рядом. Дальше — «+N». */
const MAX_CELL_ICONS = 4

const ICONS_VISIBLE_KEY = 'ph:calendar:activity-icons'

/** Показывать ли иконки в клетках: настройка устройства, не аккаунта. */
const showActivityIcons = ref(true)

/** Иконки дня: до четырёх, остальные считаем числом. */
function cellIcons(day: CalendarDay): CellIcon[] {
  const ids = store.activities(day.iso)
  if (ids.length === 0) return []

  const all = ids.map((id) => {
    const type = store.typeById(id)
    return type ? { id, ...type } : null
  })

  return all.filter((item): item is CellIcon => item !== null).slice(0, MAX_CELL_ICONS)
}

/** Есть ли на дне хоть одна отметка. */
function hasActivities(day: CalendarDay): boolean {
  return store.activities(day.iso).length > 0
}

/**
 * Есть ли на дне заметка.
 *
 * Помечаем день буквой «Т» только когда активностей нет: если день уже
 * закрашен группами, заметка — не главное, что о нём нужно знать.
 *
 * Сейчас смотрим обе заметки, потому что календарь всегда свой. Когда
 * появятся чужие календари, приватную заметку надо будет исключить —
 * это записано в техдолг.
 */
function hasNotes(day: CalendarDay): boolean {
  const stored = store.day(day.iso)
  return Boolean(stored?.notePersonal || stored?.notePublic)
}

/**
 * Пять и больше — «кипиш».
 *
 * Больше четырёх лого в клетку не влезает, и разбирать кашу смысла нет:
 * показываем взрыв. Число активностей при этом остаётся в подписи клетки
 * для скринридера, так что информация не теряется.
 */
function isChaos(day: CalendarDay): boolean {
  return store.activities(day.iso).length > MAX_CELL_ICONS
}

/**
 * Цвет иконки поверх заливки: белый на тёмном, тёмный на светлом.
 *
 * Считаем по яркости группы: зелёный и серый требуют светлой линии,
 * жёлтый — тёмной. Без этого «дом» на жёлтом был бы невидим, а «спорт»
 * на зелёном — грязным.
 */
function contrastTextColor(hex: string): string {
  const value = hex.replace('#', '')
  const r = parseInt(value.slice(0, 2), 16) / 255
  const g = parseInt(value.slice(2, 4), 16) / 255
  const b = parseInt(value.slice(4, 6), 16) / 255

  // Относительная яркость по WCAG: глаз чувствительнее к зелёному.
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > 0.6 ? '#1a1a1a' : '#ffffff'
}

/**
 * Место иконки в клетке: лого занимает всю ячейку, а не жмётся под цифрой.
 *
 * Одна — во всю клетку, две — левая и правая половины, три — верхняя
 * половина и два нижних угла, четыре — все углы. Раскладку задаём сеткой
 * 2×2 и `col-span`/`row-span`: так она читается в разметке и не требует
 * расчётов в JS.
 */
function cellSpan(day: CalendarDay, index: number): string {
  const count = cellIcons(day).length

  if (count === 1) return 'col-span-2 row-span-2'
  if (count === 2) return 'col-span-1 row-span-2'
  if (count === 3) {
    return index === 0 ? 'col-span-2 row-span-1' : 'col-span-1 row-span-1'
  }
  return 'col-span-1 row-span-1'
}

const notice = computed(() => upcomingNotice(today, (iso) => store.day(iso)))

/** Диапазон для этой фразы: сегодня и две недели вперёд. */
const noticeFrom = toIsoDate(today)
const noticeTo = toIsoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 13))

/**
 * Годы, про которые мы уже спросили в этой сессии страницы.
 *
 * Закрыл диалог, не заполнив, — при следующем заходе спросим снова
 * (компонент перемонтируется и набор опустеет), но внутри одного визита
 * второй раз не всплываем.
 */
const askedYears = ref<Set<number>>(new Set())

/**
 * Кнопка производственного календаря видна работающим и учащимся.
 * Пока режим неизвестен (календаря нет), показываем её всем: иначе
 * непонятно, как вообще узнать, что ты «работающий».
 */
const showProductionButton = computed(() => {
  const mode = yearState.value?.mode ?? null
  return mode === null || mode === 'cycle' || mode === 'study'
})

// Год и сетка месяца подгружаются по мере надобности; повторные заходы
// в те же месяцы в сеть не ходят — стор помнит загруженные диапазоны.
watch(
  () => [gridFrom.value, gridTo.value] as const,
  ([from, to]) => void store.ensureRange(from, to),
  { immediate: true },
)

watch(shownYear, (year) => void store.ensureYear(year), { immediate: true })

// Дни для фразы о ближайшем выходном нужны независимо от показанного
// месяца: чаще всего они уже в кэше вместе с сеткой текущего месяца.
onMounted(() => {
  void store.ensureRange(noticeFrom, noticeTo)

  // Справочник активностей — один запрос на открытие календаря.
  // Ошибку глотаем: без него сетка и модалка дня остаются рабочими.
  void store.ensureDictionary().catch(() => undefined)

  // Показывать ли иконки в клетках — настройка устройства: на телефоне
  // они мешают, на большом экране наоборот. Поэтому localStorage, а не профиль.
  const saved = localStorage.getItem(ICONS_VISIBLE_KEY)
  if (saved !== null) showActivityIcons.value = saved === '1'
})

watch(showActivityIcons, (value) => {
  localStorage.setItem(ICONS_VISIBLE_KEY, value ? '1' : '0')
})

/**
 * Незаполненный год — сразу спрашиваем. Диалог не появляется, пока
 * состояние года не загрузилось: иначе на секунду мигал бы у всех.
 */
watch(
  yearState,
  (state) => {
    if (!state) return
    if (state.filled) return
    if (askedYears.value.has(state.year)) return
    askedYears.value = new Set([...askedYears.value, state.year])
    isFillingYear.value = true
  },
  { immediate: true },
)

function shiftMonth(delta: number) {
  anchor.value = new Date(anchor.value.getFullYear(), anchor.value.getMonth() + delta, 1)
}

function shiftYear(delta: number) {
  anchor.value = new Date(anchor.value.getFullYear() + delta, anchor.value.getMonth(), 1)
}

function goToToday() {
  anchor.value = new Date(today.getFullYear(), today.getMonth(), 1)
}

function pickMonth(year: number, month: number) {
  anchor.value = new Date(year, month, 1)
  isPickingMonth.value = false
}

function selectDay(day: CalendarDay) {
  selectedDay.value = fromIsoDate(day.iso)
}

/**
 * Статус дня: из личного календаря, а до загрузки — по дню недели.
 * Заполненный год всегда есть в кэше, поэтому подмена видна только на
 * первом кадре и в годах, где календаря ещё нет.
 */
function statusOf(day: CalendarDay): CalendarDayType {
  return store.day(day.iso)?.dayType ?? (day.isWeekend ? 'weekend' : 'workday')
}

/** Классы кнопок навигации: одинаковые у всех четырёх стрелок. */
const NAV_BUTTON =
  'flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded text-base leading-none text-muted transition-colors hover:bg-bg hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary sm:h-8 sm:w-8'

/**
 * Классы для клетки дня.
 *
 * Цвет выбирается одной ветвью, а не набором модификаторов: `text-muted`
 * и `text-calendar-weekend` в одном классе конфликтуют, и какой победит,
 * решает порядок в сгенерированном CSS, а не порядок в атрибуте.
 *
 * Выходные — красным, рабочие и сокращённые — серым: сокращённый день
 * остаётся рабочим, он просто короче. Цвета берём из собственных токенов
 * календаря, а не из сезонных `--theme-*`: смысл тут не декоративный.
 *
 * Сегодняшний день перекрывает цвет дня: он акцентный и с рамкой, иначе
 * «сегодня» терялось бы среди красных выходных.
 */
function dayClass(day: CalendarDay): string {
  const base =
    'relative flex aspect-square cursor-pointer items-center justify-center rounded-lg text-sm tabular-nums transition-colors'
  const focus =
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'

  if (day.isToday) {
    return `${base} ${focus} bg-primary/10 font-semibold text-primary ring-2 ring-primary hover:bg-primary/20`
  }

  const status = statusOf(day)
  const color = status === 'weekend' ? 'text-calendar-weekend' : 'text-calendar-workday'

  // Хвосты соседних месяцев гасим прозрачностью, а не другим цветом:
  // цвет здесь несёт смысл «выходной/рабочий», и перекрашивать его
  // из-за границы месяца нельзя.
  return day.inMonth
    ? `${base} ${focus} ${color} hover:bg-bg`
    : `${base} ${focus} ${color} opacity-40 hover:bg-bg`
}

/**
 * Подпись клетки для скринридера: в самой клетке только число, и «7» без
 * месяца ничего не говорит. Метка дня из календаря сюда же: «Новый год»,
 * «ДР Любы».
 */
function dayLabel(day: CalendarDay): string {
  const parts = [longDate(fromIsoDate(day.iso))]
  const stored = store.day(day.iso)
  const status = statusOf(day)

  if (status === 'weekend') parts.push('выходной')
  if (status === 'short_workday') parts.push('сокращённый рабочий день')
  if (day.isToday) parts.push('сегодня')
  if (stored?.label) parts.push(stored.label)

  return parts.join(', ')
}
</script>

<template>
  <section>
    <h2 class="mb-2 text-xl font-semibold text-text">Календарь</h2>

    <p class="mb-3 text-sm text-muted">
      <!--
        Пробел перед подписью — внутри интерполяции, а не в разметке:
        Vue сжимает пустое место в шаблоне, и строки склеивались
        в «2026.В четверг выходной».
      -->
      Сегодня — {{ todayLabel }}.<template v-if="notice">{{ ' ' + notice }}</template>
    </p>

    <!--
      Два действия над сеткой — в одну строку с переносом: производственный
      календарь и админская модерация иконок. Раньше это были отдельные
      элементы с `mb-4`, и на 390 px строка рвалась по словам: «Модерация»
      оставалась справа от кнопки, а «иконок» уезжало отдельной строкой
      прямо над карточкой. Флекс переносит действие целиком, а не слово.
    -->
    <div
      v-if="showProductionButton || store.dictionary?.isAdmin"
      class="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2"
    >
      <button
        v-if="showProductionButton"
        type="button"
        class="cursor-pointer rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text transition-colors hover:border-primary"
        @click="isEditingProduction = true"
      >
        Производственный календарь
      </button>

      <!-- Ссылку видит только админ: флаг приходит вместе со справочником. -->
      <RouterLink
        v-if="store.dictionary?.isAdmin"
        to="/admin/activities"
        class="inline-flex items-center py-1.5 text-sm text-primary"
      >
        Модерация иконок
      </RouterLink>
    </div>

    <!--
      max-w-md: колонка контента в кабинете шире, и растянутая на неё сетка
      дала бы клетки по 100 px — числа утонули бы в пустоте. На мобиле
      ограничение не мешает: там ширина и так меньше.
    -->
    <div class="max-w-md rounded-xl border border-border bg-surface p-3 sm:p-4">
      <!--
        Навигация: « и » — год, ‹ и › — месяц. Порядок стрелок от крупного
        шага к мелкому, как в бумажных календарях и в почте.
      -->
      <div class="mb-3 flex flex-wrap items-center gap-1">
        <button
          type="button"
          :class="NAV_BUTTON"
          aria-label="Предыдущий год"
          @click="shiftYear(-1)"
        >
          <span aria-hidden="true">«</span>
        </button>
        <button
          type="button"
          :class="NAV_BUTTON"
          aria-label="Предыдущий месяц"
          @click="shiftMonth(-1)"
        >
          <span aria-hidden="true">‹</span>
        </button>

        <!--
          Название месяца — кнопка: клик открывает модалку выбора месяца
          с сеткой двенадцати месяцев и счётчиком года. Каретка нужна как
          подсказка, что по названию можно нажать.
        -->
        <h3
          class="min-w-0 flex-1 text-center text-base font-semibold text-text sm:text-lg"
          aria-live="polite"
        >
          <button
            type="button"
            class="cursor-pointer rounded px-2 py-0.5 transition-colors after:ml-1 after:text-xs after:text-muted after:content-['▾'] hover:bg-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            aria-haspopup="dialog"
            aria-label="Выбрать месяц и год"
            @click="isPickingMonth = true"
          >
            {{ title }}
          </button>
        </h3>

        <button
          type="button"
          :class="NAV_BUTTON"
          aria-label="Следующий месяц"
          @click="shiftMonth(1)"
        >
          <span aria-hidden="true">›</span>
        </button>
        <button type="button" :class="NAV_BUTTON" aria-label="Следующий год" @click="shiftYear(1)">
          <span aria-hidden="true">»</span>
        </button>

        <!--
          «Сегодня» показываем только когда ушли из текущего месяца:
          в текущем месяце кнопка ничего не делает и только занимает место.
        -->
        <button
          v-if="!isCurrentMonth"
          type="button"
          class="shrink-0 cursor-pointer rounded px-2 py-1 text-xs text-primary transition-colors hover:bg-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          @click="goToToday"
        >
          Сегодня
        </button>
      </div>

      <div class="grid grid-cols-7 gap-1">
        <div
          v-for="weekday in WEEKDAYS_SHORT"
          :key="weekday"
          class="pb-1 text-center text-xs font-medium text-muted"
        >
          {{ weekday }}
        </div>
        <!--
          Один и тот же тег для всех дней: клетка нажимается, и семантически
          это кнопка. Дни соседних месяцев тоже кнопки — приглушены они
          только оформлением.
        -->
        <template v-for="(week, index) in weeks" :key="index">
          <button
            v-for="day in week"
            :key="day.iso"
            type="button"
            :class="dayClass(day)"
            :aria-label="dayLabel(day)"
            @click="selectDay(day)"
          >
            {{ day.day }}
            <!-- Сокращённый день: рабочий, но короче на час. -->
            <span
              v-if="statusOf(day) === 'short_workday'"
              class="absolute bottom-1 h-0.5 w-3 rounded-full bg-calendar-workday"
              aria-hidden="true"
            />

            <!--
              Цвет группы закрашивает область клетки, а иконка рисуется поверх:
              одна — вся клетка, две — половины, три — верх и два нижних угла,
              четыре — углы, пять и больше — «взрыв». Так по месяцу видно
              общее времяпрепровождение, а не отдельные точки.
              Контейнер с pointer-events-none, чтобы клик по клетке оставался
              у кнопки и ни один участок не был «мёртвым».
            -->
            <span
              v-if="showActivityIcons && hasActivities(day)"
              class="pointer-events-none absolute inset-0 grid grid-cols-2 grid-rows-2 gap-px overflow-hidden rounded-lg"
              aria-hidden="true"
            >
              <span
                v-if="isChaos(day)"
                class="col-span-2 row-span-2 flex items-center justify-center bg-calendar-workday/30 text-text"
              >
                <ActivityIcon :name="OVERFLOW_ICON_KEY" />
              </span>
              <span
                v-for="(item, index) in cellIcons(day)"
                v-else
                :key="item.id"
                class="flex items-center justify-center p-0.5"
                :class="cellSpan(day, index)"
                :style="{
                  backgroundColor: item.color,
                  color: contrastTextColor(item.color),
                }"
              >
                <ActivityIcon :name="item.icon" />
              </span>
            </span>

            <!--
              Заметка без активностей: день пустой, но что-то записано.
              Мини-знак «Т» в углу — белую букву видно на любом фоне темы,
              потому что под ней тёмный кружок. Чекбокс иконок активностей
              его не гасит: это про заметки, а не про лого.
            -->
            <span
              v-if="!hasActivities(day) && hasNotes(day)"
              class="absolute bottom-0.5 left-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-black/50 text-[9px] font-bold leading-none text-white"
              aria-hidden="true"
            >
              Т
            </span>
          </button>
        </template>
      </div>
      <label class="mt-3 flex cursor-pointer items-center gap-2 text-xs text-muted">
        <input v-model="showActivityIcons" type="checkbox" class="cursor-pointer" />
        показывать иконки активностей
      </label>
    </div>

    <!--
      Модалка выбранного дня. Монтируем только когда день выбран:
      пустой оверлей в DOM без надобности мешал бы кликам по странице.
    -->
    <DayModal v-if="selectedDay" :date="selectedDay" @close="selectedDay = null" />

    <!-- Выбор месяца: открывается кликом по названию месяца. -->
    <MonthPickerModal
      v-if="isPickingMonth"
      :year="shownYear"
      :month="shownMonth"
      @select="pickMonth"
      @close="isPickingMonth = false"
    />

    <!-- Производственный календарь: диапазоны рабочих и нерабочих дней. -->
    <ProductionCalendarModal
      v-if="isEditingProduction"
      :year="shownYear"
      @close="isEditingProduction = false"
    />

    <!-- Незаполненный год: спрашиваем, работаешь ли. -->
    <YearFillDialog
      v-if="isFillingYear && yearState"
      :year="shownYear"
      :state="yearState"
      :current-year="today.getFullYear()"
      :previous-mode="previousMode"
      @close="isFillingYear = false"
    />
  </section>
</template>
