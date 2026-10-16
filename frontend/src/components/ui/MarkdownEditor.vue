<script lang="ts">
/** Кого можно вставить в текст: участник, роль, что угодно с именем. */
export interface MentionOption {
  id: string
  name: string
}
</script>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import GeoObjectPicker from '@/components/ui/GeoObjectPicker.vue'
import {
  escapeHtml,
  htmlToMarkdown,
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
 * жирное слово, а не `**звёздочки**`. Возрастной походник, далёкий
 * от программирования, от звёздочек приходит в ужас, и он прав: текст
 * пишут для людей, а не для парсера. Markdown остаётся форматом хранения,
 * но не тем, что видно на экране.
 *
 * **Он переиспользуемый и универсальный.** Редактор не знает ни про походы,
 * ни про маршруты: он знает про текст и про то, на что можно сослаться.
 * Отсюда отключаемые куски — вставка объектов, упоминание участников,
 * смайлики. В описании маршрута включены только объекты; в отчёте,
 * дневнике и переписке набор будет другим, а редактор тот же.
 *
 * **Кнопок на старте мало, и они с картинками.** «Ж», «К», «З» приходилось
 * изучать методом тыка: на десктопе спасает подсказка, на телефоне её нет.
 * Поэтому на панели — узнаваемые значки, а из оформления только жирный
 * и список: остальное оценим потом, когда станет видно, чего не хватает.
 *
 * Токены (`[[object:N]]`, `[[user:ID]]`) в тексте показываются **именем
 * без родителя** и хранятся в неизменяемом `span[data-token]`, поэтому
 * их нельзя стереть по буквам. Родитель остаётся в фильтре, где имена
 * повторяются, и там он нужен.
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

/**
 * Имена сущностей, которые редактор знает.
 *
 * Копятся из двух источников: то, что передал вызывающий (для уже
 * написанного текста), и то, что вставили прямо сейчас. Если имени нет,
 * показывается «объект 10» — честнее, чем пустое место, и понятнее,
 * чем квадратные скобки.
 */
const names = ref<MentionNames>({ ...props.mentions })

const editor = ref<HTMLDivElement | null>(null)
const panel = ref<'none' | 'object' | 'participant' | 'emoji' | 'link' | 'date'>('none')
const linkUrl = ref('')
const pickedDate = ref(new Date().toISOString().slice(0, 10))

/**
 * Что редактор отдал наружу последним.
 *
 * Нужно, чтобы отличить свои изменения от чужих: во время набора текст
 * возвращается обратно через `v-model`, и перерисовка сбила бы курсор
 * в середину слова. Перерисовываем только чужое — сброс формы, загрузку
 * сохранённого текста.
 */
let lastEmitted: string | null = null

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

onMounted(render)

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
}

/**
 * Вставить готовый фрагмент туда, где стоит курсор.
 *
 * Через `Range`, а не `execCommand('insertHTML')`: `execCommand` объявлен
 * устаревшим и в тестовой среде его нет вовсе, а `Range` есть и в браузере,
 * и в jsdom — то есть вставку можно проверить, а не надеяться.
 *
 * Если курсора в редакторе нет, дописываем в конец: потерять вставку
 * хуже, чем поставить её не туда.
 */
function insertHtml(html: string) {
  const field = editor.value
  if (!field) return

  field.focus()

  const selection = window.getSelection()
  const hasCaret =
    selection !== null &&
    selection.rangeCount > 0 &&
    selection.anchorNode !== null &&
    field.contains(selection.anchorNode)

  if (!selection || !hasCaret) {
    field.insertAdjacentHTML('beforeend', html)
    sync()
    return
  }

  const range = selection.getRangeAt(0)
  range.deleteContents()

  const fragment = range.createContextualFragment(html)
  const last = fragment.lastChild
  range.insertNode(fragment)

  if (last) {
    const after = document.createRange()
    after.setStartAfter(last)
    after.collapse(true)
    selection.removeAllRanges()
    selection.addRange(after)
  }

  sync()
}

/**
 * Оформление средствами браузера.
 *
 * `execCommand` устарел, но для «сделать выделенное жирным» и «превратить
 * строки в список» он по-прежнему простейший: своя работа с блоками
 * и курсором на этом месте была бы в разы длиннее и хрупче. Если команды
 * нет (старая среда, тесты), ничего не произойдёт — но и не сломается.
 */
function format(command: 'bold' | 'insertUnorderedList') {
  editor.value?.focus()

  if (typeof document.execCommand !== 'function') return

  document.execCommand(command)
  sync()
}

function togglePanel(next: typeof panel.value) {
  panel.value = panel.value === next ? 'none' : next
}

function insertObject(object: GeoObject) {
  const token = objectToken(object.id)
  names.value = { ...names.value, [token]: object.name }

  insertHtml(markdownToHtml(token, names.value))
  panel.value = 'none'
}

function insertParticipant(participant: MentionOption) {
  const token = userToken(participant.id)
  names.value = { ...names.value, [token]: participant.name }

  insertHtml(markdownToHtml(token, names.value))
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

function insertDate() {
  insertHtml(escapeHtml(formatDate(pickedDate.value)))
  panel.value = 'none'
}

function insertLink() {
  const url = linkUrl.value.trim()
  if (!url) return

  // Подпись — сам адрес: отдельного поля для текста ссылки пока нет,
  // а адрес в подписи читается лучше, чем пустые скобки.
  insertHtml(markdownToHtml(`[${url}](${url})`))
  linkUrl.value = ''
  panel.value = 'none'
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
        class="cursor-pointer rounded-lg border border-border bg-field p-1.5 text-text transition-colors hover:border-primary"
        data-test="md-bold"
        @click="format('bold')"
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
        @click="format('insertUnorderedList')"
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
        @click="togglePanel('date')"
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

    <div
      v-else-if="panel === 'date'"
      class="flex flex-wrap items-end gap-2 border-b border-border p-2"
    >
      <label class="flex flex-col gap-1">
        <span class="text-xs text-muted">Дата</span>
        <input
          v-model="pickedDate"
          type="date"
          class="rounded-xl border border-border bg-field px-3 py-2 text-base text-text focus:border-primary focus:outline-none"
          data-test="date-input"
        />
      </label>

      <button
        type="button"
        class="cursor-pointer rounded-xl border border-primary bg-primary px-3 py-2 text-sm text-white transition-opacity hover:opacity-90"
        data-test="date-insert"
        @click="insertDate"
      >
        Вставить
      </button>
    </div>

    <div
      v-else-if="panel === 'link'"
      class="flex flex-wrap items-end gap-2 border-b border-border p-2"
    >
      <label class="flex flex-1 flex-col gap-1">
        <span class="text-xs text-muted">Адрес ссылки</span>
        <input
          v-model="linkUrl"
          type="url"
          placeholder="https://"
          class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text focus:border-primary focus:outline-none"
          data-test="link-input"
        />
      </label>

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
      />

      <span v-if="isEmpty" class="pointer-events-none absolute left-3 top-2 text-base text-muted">
        {{ placeholder }}
      </span>
    </div>
  </div>
</template>
