<script lang="ts">
/** Кого можно вставить в текст: участник, роль, что угодно с именем. */
export interface MentionOption {
  id: string
  name: string
}
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import GeoObjectPicker from '@/components/ui/GeoObjectPicker.vue'
import {
  escapeHtml,
  htmlToMarkdown,
  inlineMarkdownToHtml,
  markdownToHtml,
  objectToken,
  userToken,
  type MentionNames,
} from '@/utils/markdown'
import type { GeoObject } from '@/types/trips'

/**
 * Редактор текста с оформлением и ссылками на сущности.
 *
 * **Разметки не видно.** Человек набирает текст, жмёт «жирный» — и видит
 * жирное слово, а не `**звёздочки**`. Markdown остаётся форматом хранения,
 * но не тем, что на экране.
 *
 * **Он переиспользуемый и универсальный.** Редактор не знает ни про походы,
 * ни про маршруты: он знает про текст и про то, на что можно сослаться.
 * Отсюда отключаемые куски — вставка объектов, упоминание участников,
 * смайлики.
 *
 * ## Место курсора помнится отдельно
 *
 * Это не украшение, а лечение главной ошибки первой версии. Человек пишет
 * «…к часу дня выходим к», потом лезет в поиск объекта, набирает там
 * «Витязь» — и всё это время курсор в тексте уже не стоит, фокус в поле
 * поиска. Редактор терял место вставки и валил объект в начало текста.
 *
 * Поэтому позиция запоминается, как только курсор уходит из редактора,
 * и восстанавливается перед вставкой. Ровно так же ведут себя все
 * редакторы, где есть панель инструментов.
 *
 * ## Что ещё сделано по замечаниям
 *
 * - нажатая кнопка «жирный» подсвечивается: иначе непонятно, применилось ли;
 * - объекты и даты вставляются **с пробелами по обе стороны**, чтобы не
 *   прилипать к словам;
 * - дата вставляется сразу после выбора в календаре, без лишней кнопки;
 * - список делается **вручную**, а не командой браузера: команда не
 *   срабатывала, а своя работает одинаково везде и её можно проверить;
 * - ссылку можно открыть по Ctrl+клику — обычный клик в редакторе ставит
 *   курсор, иначе править текст рядом со ссылкой было бы невозможно.
 */

const props = withDefaults(
  defineProps<{
    /** Подсказка в пустом поле. */
    placeholder?: string
    /** Минимальная высота поля. */
    minHeight?: string
    /** Искать ли объекты в справочнике и вставлять ссылками. */
    objects?: boolean
    /** Кого можно упомянуть. Пустой список — кнопки упоминания нет. */
    participants?: MentionOption[]
    /** Показывать ли смайлики. */
    emoji?: boolean
    /** Имена уже упомянутых сущностей: токен → подпись. */
    mentions?: MentionNames
  }>(),
  {
    placeholder: 'Текст',
    minHeight: '8rem',
    objects: true,
    participants: () => [],
    emoji: false,
    mentions: () => ({}),
  },
)

const text = defineModel<string>({ required: true })

/** Имена сущностей, которые редактор знает: токен → подпись. */
const names = ref<MentionNames>({ ...props.mentions })

const editor = ref<HTMLDivElement | null>(null)
const dateInput = ref<HTMLInputElement | null>(null)
const panel = ref<'none' | 'object' | 'participant' | 'emoji' | 'link' | 'date'>('none')
const linkUrl = ref('')
const pickedDate = ref(new Date().toISOString().slice(0, 10))

/** Стоит ли курсор внутри жирного — чтобы кнопка выглядела нажатой. */
const isBold = ref(false)

/**
 * Что редактор отдал наружу последним.
 *
 * Нужно, чтобы отличить свои изменения от чужих: во время набора текст
 * возвращается обратно через `v-model`, и перерисовка сбила бы курсор
 * в середину слова.
 */
let lastEmitted: string | null = null

/**
 * Последнее известное место курсора внутри редактора.
 *
 * Обновляется, когда курсор из редактора уходит, и восстанавливается перед
 * вставкой. Без этого объект, выбранный в поиске, падал в начало текста.
 */
let savedRange: Range | null = null

const isEmpty = computed(() => (text.value ?? '').trim() === '')

const MONTHS_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
]

/** Показать текст в редактируемом виде. */
function render() {
  if (!editor.value) return
  const html = markdownToHtml(text.value ?? '', names.value)
  if (editor.value.innerHTML !== html) {
    editor.value.innerHTML = html
  }
}

onMounted(() => {
  render()
  // Состояние кнопок меняется вместе с курсором: он встал в жирное слово —
  // кнопка «жирный» должна это показать.
  document.addEventListener('selectionchange', refreshState)
})

onBeforeUnmount(() => {
  document.removeEventListener('selectionchange', refreshState)
})

watch(
  () => text.value,
  (next) => {
    if (next === lastEmitted) return
    render()
  },
)

watch(
  () => props.mentions,
  (next) => {
    names.value = { ...names.value, ...next }
    render()
  },
  { deep: true },
)

/** Забрать из редактора то, что получилось, и отдать наружу. */
function sync() {
  const markdown = htmlToMarkdown(editor.value?.innerHTML ?? '')
  lastEmitted = markdown
  text.value = markdown
  rememberCaret()
  refreshState()
}

/** Запомнить, где стоял курсор. */
function rememberCaret() {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return

  const range = selection.getRangeAt(0)
  if (editor.value && range.startContainer && editor.value.contains(range.startContainer)) {
    savedRange = range.cloneRange()
  }
}

/**
 * Вернуть курсор в редактор и отдать место, куда вставлять.
 *
 * Сначала пробуем живое выделение: если человек только что поставил курсор
 * и сразу жмёт кнопку, оно свежее. Если живого нет (фокус ушёл в поиск),
 * берём запомненное.
 */
function restoreCaret(): Range | null {
  const field = editor.value
  if (!field) return null

  field.focus()

  const selection = window.getSelection()
  if (!selection) return null

  if (savedRange && field.contains(savedRange.startContainer)) {
    selection.removeAllRanges()
    selection.addRange(savedRange)
    return savedRange
  }

  return selection.rangeCount > 0 ? selection.getRangeAt(0) : null
}

/** Нужен ли пробел перед вставкой: он не нужен в начале строки и после пробела. */
function needsSpaceBefore(range: Range): boolean {
  const node = range.startContainer
  if (node.nodeType !== Node.TEXT_NODE) return range.startOffset > 0

  const before = (node.textContent ?? '').slice(0, range.startOffset)
  return before.length > 0 && !/\s$/.test(before)
}

/** Нужен ли пробел после вставки. */
function needsSpaceAfter(range: Range): boolean {
  const node = range.endContainer
  if (node.nodeType !== Node.TEXT_NODE) return false

  const after = (node.textContent ?? '').slice(range.endOffset)
  return after.length > 0 && !/^\s/.test(after)
}

/**
 * Вставить готовый фрагмент туда, где стоит курсор.
 *
 * Через `Range`, а не `execCommand('insertHTML')`: `execCommand` объявлен
 * устаревшим и в тестовой среде его нет вовсе, а `Range` есть и в браузере,
 * и в jsdom — то есть вставку можно проверить, а не надеяться.
 *
 * `spaced` — для объектов и дат: они отделяются пробелами, иначе прилипают
 * к соседним словам («выходим к[[object:10]]»).
 */
function insertHtml(html: string, spaced = false) {
  const field = editor.value
  if (!field) return

  const range = restoreCaret()

  if (!range) {
    field.insertAdjacentHTML('beforeend', html)
    sync()
    return
  }

  const prefix = spaced && needsSpaceBefore(range) ? ' ' : ''
  const suffix = spaced && needsSpaceAfter(range) ? ' ' : ''

  range.deleteContents()

  const fragment = range.createContextualFragment(`${prefix}${html}${suffix}`)
  const last = fragment.lastChild
  range.insertNode(fragment)

  if (last) {
    const after = document.createRange()
    after.setStartAfter(last)
    after.collapse(true)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(after)
    savedRange = after.cloneRange()
  }

  sync()
}

/** Подсветить кнопку «жирный», если курсор внутри жирного. */
function refreshState() {
  if (typeof document.queryCommandState !== 'function') return

  const selection = window.getSelection()
  const inside =
    selection !== null &&
    selection.anchorNode !== null &&
    editor.value?.contains(selection.anchorNode) === true

  if (!inside) return

  try {
    isBold.value = document.queryCommandState('bold')
  } catch {
    isBold.value = false
  }
}

/**
 * Жирный — командой браузера.
 *
 * `execCommand` устарел, но для «сделать выделенное жирным» он по-прежнему
 * простейший и работает во всех браузерах. Своя реализация тут была бы
 * длиннее, а выигрыша нет: жирный — это одно слово в разметке.
 */
function toggleBold() {
  editor.value?.focus()
  restoreCaret()

  if (typeof document.execCommand !== 'function') return

  document.execCommand('bold')
  sync()
}

/** Ближайший блок — прямой ребёнок поля редактирования. */
function closestBlock(node: Node, field: HTMLElement): HTMLElement | null {
  let current: Node | null = node

  while (current && current !== field) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      const element = current as HTMLElement
      if (element.parentElement === field) return element
    }
    current = current.parentNode
  }

  return null
}

/** Блоки, которые задевает выделение. */
function blocksInRange(field: HTMLElement, range: Range): HTMLElement[] {
  const touched: HTMLElement[] = []

  field.childNodes.forEach((node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const element = node as HTMLElement
    if (range.intersectsNode(element)) touched.push(element)
  })

  // Внутри списка прямым ребёнком поля стоит `<ul>`, а работать надо
  // с его пунктами.
  const blocks = touched.flatMap((element) =>
    element.tagName === 'UL' || element.tagName === 'OL'
      ? (Array.from(element.children) as HTMLElement[])
      : [element],
  )

  if (blocks.length > 0) return blocks

  const block = closestBlock(range.startContainer, field)
  return block ? [block] : []
}

/** Обернуть блок в список. */
function wrapInList(block: HTMLElement): HTMLElement {
  const list = document.createElement('ul')
  const item = document.createElement('li')

  while (block.firstChild) item.appendChild(block.firstChild)
  list.appendChild(item)
  block.replaceWith(list)

  return item
}

/** Вынуть пункт списка обратно в обычную строку. */
function unwrapListItem(item: HTMLElement): HTMLElement {
  const line = document.createElement('div')

  while (item.firstChild) line.appendChild(item.firstChild)

  // Строку ставим **перед списком**, а не на место пункта: пункт обязан
  // лежать внутри `<ul>`, и `<div>` внутри списка — это уже не список
  // с одной строкой, а список с мусором внутри, который потом никуда
  // не денется.
  const list = item.parentElement
  if (list) list.before(line)
  item.remove()

  return line
}

/**
 * Список: поставить маркеры или убрать их.
 *
 * **Сделано вручную, а не командой браузера.** `insertUnorderedList` —
 * то самое место, где «ничего не происходит»: команда молча ничего не
 * делает, если курсор потерян или блок устроен не так, как она ждёт.
 * Своя реализация предсказуема, одинаково работает везде и, что важнее,
 * проверяется тестами.
 */
function toggleList() {
  const field = editor.value
  const range = restoreCaret()
  if (!field || !range) return

  const blocks = blocksInRange(field, range)
  if (blocks.length === 0) return

  // Если всё выделенное уже в списке — убираем маркеры, иначе ставим.
  const allItems = blocks.every((block) => block.tagName === 'LI')

  let last: HTMLElement | null = null
  for (const block of blocks) {
    last = allItems ? unwrapListItem(block) : wrapInList(block)
  }

  // Пустые списки после разбора оставлять нельзя: они дают пустые строки
  // в готовом тексте.
  field.querySelectorAll('ul, ol').forEach((list) => {
    if (list.children.length === 0) list.remove()
  })

  if (last) placeCaretAtEnd(last)
  sync()
}

/** Поставить курсор в конец элемента. */
function placeCaretAtEnd(element: HTMLElement) {
  const range = document.createRange()
  range.selectNodeContents(element)
  range.collapse(false)

  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  savedRange = range.cloneRange()
}

/** Открыть панель календаря и сразу показать встроенный календарь. */
function openDatePanel() {
  panel.value = panel.value === 'date' ? 'none' : 'date'
  if (panel.value !== 'date') return

  void nextTick(() => {
    const input = dateInput.value as (HTMLInputElement & { showPicker?: () => void }) | null
    if (!input) return

    // `showPicker` открывает тот же календарь, что и клик по полю: человек
    // жмёт одну кнопку, а не две.
    try {
      input.showPicker?.()
    } catch {
      // Браузер вправе отказать без жеста пользователя — тогда поле
      // остаётся, и дату выбирают кликом по нему.
    }
  })
}

function togglePanel(next: typeof panel.value) {
  panel.value = panel.value === next ? 'none' : next
}

function insertObject(object: GeoObject) {
  const token = objectToken(object.id)
  names.value = { ...names.value, [token]: object.name }

  // Только строчный фрагмент: блочный разорвал бы абзац надвое.
  insertHtml(inlineMarkdownToHtml(token, names.value), true)
  panel.value = 'none'
}

function insertParticipant(participant: MentionOption) {
  const token = userToken(participant.id)
  names.value = { ...names.value, [token]: participant.name }

  insertHtml(inlineMarkdownToHtml(token, names.value), true)
  panel.value = 'none'
}

function insertEmoji(symbol: string) {
  insertHtml(escapeHtml(symbol))
}

/** Дата словами: «12 мая 2027» — так её и пишут в дневнике. */
function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(date.getTime())) return iso
  return `${date.getDate()} ${MONTHS_GENITIVE[date.getMonth()]} ${date.getFullYear()}`
}

/** Дату вставляем сразу после выбора: отдельной кнопки «вставить» нет. */
function insertDate() {
  if (!pickedDate.value) return

  insertHtml(escapeHtml(formatDate(pickedDate.value)), true)
  panel.value = 'none'
}

function insertLink() {
  const url = linkUrl.value.trim()
  if (!url) return

  // Подпись — сам адрес: отдельного поля для текста ссылки пока нет,
  // а адрес в подписи читается лучше, чем пустые скобки.
  insertHtml(inlineMarkdownToHtml(`[${url}](${url})`), true)
  linkUrl.value = ''
  panel.value = 'none'
}

/**
 * Открыть ссылку из текста.
 *
 * Обычный клик по ссылке в редакторе ставит курсор — иначе править текст
 * рядом с ней было бы невозможно. Для перехода нужно удерживать Ctrl
 * (на macOS — Cmd), как в почте и текстовых редакторах.
 */
function onEditorClick(event: MouseEvent) {
  if (!event.ctrlKey && !event.metaKey) return

  const target = (event.target as HTMLElement | null)?.closest('a')
  const href = target?.getAttribute('href')
  if (!href) return

  event.preventDefault()
  window.open(href, '_blank', 'noopener')
}

/** Смайлики: набор понятных походных значков, а не палитра на тысячу. */
const EMOJI = [
  '⛰️',
  '🏔️',
  '🔥',
  '🌲',
  '💧',
  '☀️',
  '🌧️',
  '❄️',
  '🚗',
  '🚂',
  '⛺',
  '🥾',
  '📷',
  '🗺️',
  '⚠️',
  '👍',
]
</script>

<template>
  <div class="flex flex-col rounded-xl border border-border">
    <!-- Панель инструментов. Значки, а не буквы: на телефоне подсказки нет -->
    <div class="flex flex-wrap items-center gap-1 border-b border-border p-2">
      <button
        type="button"
        title="Жирный"
        aria-label="Жирный"
        :aria-pressed="isBold"
        class="cursor-pointer rounded-lg border p-1.5 transition-colors"
        :class="
          isBold
            ? 'border-primary bg-field text-primary'
            : 'border-border bg-field text-text hover:border-primary'
        "
        data-test="md-bold"
        @mousedown.prevent
        @click="toggleBold"
      >
        <svg
          class="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M7 5h6a3.5 3.5 0 0 1 0 7H7z" />
          <path d="M7 12h7a3.5 3.5 0 0 1 0 7H7z" />
        </svg>
      </button>

      <button
        type="button"
        title="Список"
        aria-label="Список"
        class="cursor-pointer rounded-lg border border-border bg-field p-1.5 text-text transition-colors hover:border-primary"
        data-test="md-list"
        @mousedown.prevent
        @click="toggleList"
      >
        <svg
          class="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <circle cx="5" cy="7" r="1.3" fill="currentColor" />
          <circle cx="5" cy="12" r="1.3" fill="currentColor" />
          <circle cx="5" cy="17" r="1.3" fill="currentColor" />
          <path d="M10 7h9M10 12h9M10 17h9" />
        </svg>
      </button>

      <button
        type="button"
        title="Ссылка"
        aria-label="Ссылка"
        class="cursor-pointer rounded-lg border p-1.5 transition-colors"
        :class="
          panel === 'link'
            ? 'border-primary text-primary'
            : 'border-border bg-field text-text hover:border-primary'
        "
        data-test="md-link"
        @mousedown.prevent
        @click="togglePanel('link')"
      >
        <svg
          class="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M10 13a4 4 0 0 0 5.7.4l2.6-2.6a4 4 0 0 0-5.7-5.7l-1.5 1.5" />
          <path d="M14 11a4 4 0 0 0-5.7-.4l-2.6 2.6a4 4 0 0 0 5.7 5.7l1.5-1.5" />
        </svg>
      </button>

      <button
        type="button"
        title="Дата"
        aria-label="Дата"
        class="cursor-pointer rounded-lg border p-1.5 transition-colors"
        :class="
          panel === 'date'
            ? 'border-primary text-primary'
            : 'border-border bg-field text-text hover:border-primary'
        "
        data-test="md-date"
        @mousedown.prevent
        @click="openDatePanel"
      >
        <svg
          class="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18" />
          <path d="M8 3v4M16 3v4" />
        </svg>
      </button>

      <span class="mx-1 h-5 w-px bg-border" />

      <button
        v-if="objects"
        type="button"
        class="cursor-pointer rounded-lg border px-2 py-1 text-sm transition-colors"
        :class="
          panel === 'object'
            ? 'border-primary text-primary'
            : 'border-border bg-field text-text hover:border-primary'
        "
        data-test="md-object"
        @click="togglePanel('object')"
      >
        Объект
      </button>

      <button
        v-if="participants.length > 0"
        type="button"
        class="cursor-pointer rounded-lg border px-2 py-1 text-sm transition-colors"
        :class="
          panel === 'participant'
            ? 'border-primary text-primary'
            : 'border-border bg-field text-text hover:border-primary'
        "
        data-test="md-participant"
        @click="togglePanel('participant')"
      >
        Участник
      </button>

      <button
        v-if="emoji"
        type="button"
        title="Смайлики"
        aria-label="Смайлики"
        class="cursor-pointer rounded-lg border px-2 py-1 text-sm transition-colors"
        :class="
          panel === 'emoji'
            ? 'border-primary text-primary'
            : 'border-border bg-field text-text hover:border-primary'
        "
        data-test="md-emoji"
        @click="togglePanel('emoji')"
      >
        🙂
      </button>
    </div>

    <!-- Панели вставки -->
    <div v-if="panel === 'object'" class="border-b border-border p-2">
      <!-- Родитель показывается: имена в справочнике повторяются,
           и «Осиновка» без района — это выбор наугад -->
      <GeoObjectPicker placeholder="Название объекта" @select="insertObject" />
    </div>

    <div
      v-else-if="panel === 'participant'"
      class="flex flex-wrap gap-1 border-b border-border p-2"
      data-test="participant-options"
    >
      <button
        v-for="participant in participants"
        :key="participant.id"
        type="button"
        class="cursor-pointer rounded-lg border border-border bg-field px-2 py-1 text-sm text-text transition-colors hover:border-primary"
        data-test="participant-option"
        @click="insertParticipant(participant)"
      >
        {{ participant.name }}
      </button>
    </div>

    <div
      v-else-if="panel === 'emoji'"
      class="flex flex-wrap gap-1 border-b border-border p-2"
      data-test="emoji-options"
    >
      <button
        v-for="symbol in EMOJI"
        :key="symbol"
        type="button"
        class="cursor-pointer rounded-lg border border-border px-2 py-1 text-base transition-colors hover:border-primary"
        data-test="emoji-option"
        @click="insertEmoji(symbol)"
      >
        {{ symbol }}
      </button>
    </div>

    <!-- Дата: выбор в календаре и сразу вставка. Отдельной кнопки нет -->
    <div
      v-else-if="panel === 'date'"
      class="flex flex-wrap items-center gap-3 border-b border-border p-2"
    >
      <input
        ref="dateInput"
        v-model="pickedDate"
        type="date"
        class="rounded-xl border border-border bg-field px-3 py-2 text-base text-text focus:border-primary focus:outline-none"
        data-test="date-input"
        @change="insertDate"
      />

      <button
        type="button"
        class="cursor-pointer text-sm text-muted underline transition-colors hover:text-text"
        data-test="date-cancel"
        @click="panel = 'none'"
      >
        Отмена
      </button>
    </div>

    <div
      v-else-if="panel === 'link'"
      class="flex flex-wrap items-center gap-3 border-b border-border p-2"
    >
      <input
        v-model="linkUrl"
        type="url"
        placeholder="https://"
        class="w-full flex-1 rounded-xl border border-border bg-field px-3 py-2 text-base text-text focus:border-primary focus:outline-none"
        data-test="link-input"
      />

      <button
        type="button"
        class="cursor-pointer rounded-xl border border-primary bg-primary px-3 py-2 text-sm text-white transition-opacity hover:opacity-90"
        data-test="link-insert"
        @click="insertLink"
      >
        Вставить
      </button>
    </div>

    <!-- Поле. У contenteditable нет placeholder, поэтому подсказка лежит
         поверх и не перехватывает клики -->
    <div class="relative">
      <div
        ref="editor"
        contenteditable="true"
        role="textbox"
        aria-multiline="true"
        class="w-full overflow-y-auto rounded-b-xl bg-field px-3 py-2 text-base leading-relaxed text-text focus:outline-none"
        :style="{ minHeight }"
        data-test="md-editor"
        @input="sync"
        @keyup="rememberCaret"
        @mouseup="rememberCaret"
        @blur="rememberCaret"
        @click="onEditorClick"
      />

      <span v-if="isEmpty" class="pointer-events-none absolute left-3 top-2 text-base text-muted">
        {{ placeholder }}
      </span>
    </div>
  </div>
</template>
