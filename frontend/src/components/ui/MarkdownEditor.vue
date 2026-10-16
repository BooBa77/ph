<script lang="ts">
/** Кого можно вставить в текст: участник, роль, что угодно с именем. */
export interface MentionOption {
  id: string
  name: string
}
</script>

<script setup lang="ts">
import { nextTick, ref } from 'vue'

import GeoObjectPicker from '@/components/ui/GeoObjectPicker.vue'
import type { GeoObject } from '@/types/trips'

/**
 * Редактор markdown с вставкой сущностей.
 *
 * **Он переиспользуемый и универсальный с самого начала** — и это главное
 * решение в файле. Тексты на сайте одинаковы по природе: описание маршрута,
 * отчёт, дневник, сообщение в чате. Всюду нужны оформление и ссылки
 * на сущности, различается только набор того, на что можно сослаться.
 * Поэтому редактор не знает ни про походы, ни про маршруты: он знает про
 * markdown и про «что можно вставить», а что именно — задаёт вызывающий.
 *
 * Отсюда три отключаемых куска:
 *
 * - **вставка объектов** — ищет по справочнику и вставляет `[[object:N]]`;
 * - **упоминание участников** — вставляет `[[user:ID]]`. В описании
 *   маршрута участников нет, в отчёте и дневнике они основные;
 * - **смайлики** — выключены по умолчанию. В описании маршрута смайлик
 *   не несёт ничего, а в переписке без него никак.
 *
 * **Вставка идёт в место курсора, а не в конец.** Текст пишут по частям,
 * и дописывание в хвост заставляло бы потом переносить ссылку руками.
 *
 * Токены (`[[object:N]]`, `[[user:ID]]`) бэкенд понимает как ссылки
 * на сущности; для маршрута он из них строит индекс объектов похода.
 * Незнакомые токены он просто не замечает, поэтому новый вид упоминания
 * не ломает уже написанное.
 */

const props = withDefaults(
  defineProps<{
    /** Подсказка в пустом поле. */
    placeholder?: string
    /** Высота поля в строках. */
    rows?: number
    /** Искать ли объекты в справочнике и вставлять ссылками. */
    objects?: boolean
    /** Кого можно упомянуть. Пустой список — кнопки упоминания нет. */
    participants?: MentionOption[]
    /** Показывать ли смайлики. */
    emoji?: boolean
  }>(),
  {
    placeholder: 'Текст в markdown',
    rows: 6,
    objects: true,
    participants: () => [],
    emoji: false,
  },
)

const text = defineModel<string>({ required: true })

/** Что вставлено в текст в качестве ссылки. */
const linkSyntax = {
  object: (id: string) => `[[object:${id}]]`,
  participant: (id: string) => `[[user:${id}]]`,
}

/**
 * Смайлики, которые точно пригодятся в походном тексте.
 *
 * Не полный набор Unicode: двадцать понятных значков удобнее, чем
 * палитра на тысячу позиций, в которой никто ничего не найдёт.
 */
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
  '🙂',
  '😅',
]

type Panel = 'none' | 'object' | 'participant' | 'emoji'

const panel = ref<Panel>('none')
const textarea = ref<HTMLTextAreaElement | null>(null)

function togglePanel(next: Panel) {
  panel.value = panel.value === next ? 'none' : next
}

/** Вставить фрагмент в место курсора и поставить курсор после него. */
function insertAtCursor(snippet: string) {
  const field = textarea.value
  const start = field ? field.selectionStart : text.value.length
  const end = field ? field.selectionEnd : text.value.length

  text.value = `${text.value.slice(0, start)}${snippet}${text.value.slice(end)}`

  void nextTick(() => {
    if (!field) return
    field.focus()
    const cursor = start + snippet.length
    field.setSelectionRange(cursor, cursor)
  })
}

/**
 * Обернуть выделение парой маркеров: `**жирный**`, `*курсив*`, `` `код` ``.
 *
 * Выделение сохраняем после обёртки — чаще всего человек хочет обернуть
 * уже набранное и продолжить печатать это же, а не потерять его.
 */
function surround(before: string, after = before) {
  const field = textarea.value
  if (!field) return

  const start = field.selectionStart
  const end = field.selectionEnd
  const selected = text.value.slice(start, end)

  text.value = `${text.value.slice(0, start)}${before}${selected}${after}${text.value.slice(end)}`

  void nextTick(() => {
    field.focus()
    field.setSelectionRange(start + before.length, start + before.length + selected.length)
  })
}

/**
 * Поставить префикс строкам выделения: список, нумерация, цитата, заголовок.
 *
 * Если все строки уже с этим префиксом — снимаем его. Иначе кнопка умеет
 * только включать, и выключить список можно лишь руками.
 */
function prefixLines(prefix: string) {
  const field = textarea.value
  if (!field) return

  const start = field.selectionStart
  const end = field.selectionEnd
  const from = text.value.lastIndexOf('\n', Math.max(0, start - 1)) + 1

  const block = text.value.slice(from, end)
  const lines = block.split('\n')
  const allPrefixed = lines.every((line) => line.trim() === '' || line.startsWith(prefix))

  const updated = lines
    .map((line) => {
      if (line.trim() === '') return line
      return allPrefixed ? line.slice(prefix.length) : `${prefix}${line}`
    })
    .join('\n')

  text.value = `${text.value.slice(0, from)}${updated}${text.value.slice(end)}`

  void nextTick(() => {
    field.focus()
    field.setSelectionRange(from, from + updated.length)
  })
}

/** Ссылка: если ничего не выделено — подсказка вместо пустых скобок. */
function insertLink() {
  const field = textarea.value
  const selected = field ? text.value.slice(field.selectionStart, field.selectionEnd) : ''
  surround('[', `](${selected ? 'https://' : 'https://'})`)
}

function insertObject(object: GeoObject) {
  insertAtCursor(linkSyntax.object(object.id))
  panel.value = 'none'
}

function insertParticipant(participant: MentionOption) {
  insertAtCursor(linkSyntax.participant(participant.id))
  panel.value = 'none'
}

function insertEmoji(symbol: string) {
  insertAtCursor(symbol)
}

/** Кнопка панели: одинаковая разметка у всех, отличаются подпись и действие. */
const toolbarButtons = [
  { label: 'Ж', title: 'Жирный', action: () => surround('**'), test: 'md-bold' },
  { label: 'К', title: 'Курсив', action: () => surround('*'), test: 'md-italic' },
  { label: 'З', title: 'Заголовок', action: () => prefixLines('## '), test: 'md-heading' },
  { label: '•', title: 'Список', action: () => prefixLines('- '), test: 'md-list' },
  { label: '1.', title: 'Нумерация', action: () => prefixLines('1. '), test: 'md-ordered' },
  { label: 'Ц', title: 'Цитата', action: () => prefixLines('> '), test: 'md-quote' },
  { label: '`', title: 'Код', action: () => surround('`'), test: 'md-code' },
  { label: '🔗', title: 'Ссылка', action: insertLink, test: 'md-link' },
]

const propsRef = props
</script>

<template>
  <div class="flex flex-col gap-2 rounded-xl border border-border">
    <!-- Панель инструментов -->
    <div class="flex flex-wrap items-center gap-1 border-b border-border p-2">
      <button
        v-for="button in toolbarButtons"
        :key="button.test"
        type="button"
        :title="button.title"
        class="cursor-pointer rounded-lg border border-border bg-field px-2 py-1 text-sm text-text transition-colors hover:border-primary"
        :data-test="button.test"
        @click="button.action"
      >
        {{ button.label }}
      </button>

      <span class="mx-1 h-5 w-px bg-border" />

      <button
        v-if="propsRef.objects"
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
        v-if="propsRef.participants.length > 0"
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
        v-if="propsRef.emoji"
        type="button"
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
      <GeoObjectPicker :show-parent="false" placeholder="Название объекта" @select="insertObject" />
    </div>

    <div
      v-else-if="panel === 'participant'"
      class="flex flex-wrap gap-1 border-b border-border p-2"
      data-test="participant-options"
    >
      <button
        v-for="participant in propsRef.participants"
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

    <textarea
      ref="textarea"
      v-model="text"
      :rows="propsRef.rows"
      :placeholder="propsRef.placeholder"
      class="w-full resize-y rounded-b-xl bg-field px-3 py-2 text-base text-text focus:outline-none"
      data-test="md-textarea"
    />
  </div>
</template>
