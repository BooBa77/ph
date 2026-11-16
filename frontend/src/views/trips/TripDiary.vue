<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import { getTripDiary } from '@/api/diary'
import { ApiError } from '@/api/errors'
import { subscribeTripEvents, type TripEvent } from '@/api/events'
import { listParticipants } from '@/api/trips'
import MarkdownEditor from '@/components/ui/MarkdownEditor.vue'
import {
  mergeDiaryEntries,
  newDiaryEntryId,
  pushDiaryOutbox,
  queueDiaryChange,
  readDiaryOutbox,
  type DiaryOutboxEntry,
} from '@/offline/diaryOutbox'
import { useAuthStore } from '@/stores/auth'
import { useOfflineStore } from '@/stores/offline'
import type { TripDiaryEntry } from '@/types/diary'
import type { Trip, TripParticipant } from '@/types/trips'
import { markdownToHtml, userToken } from '@/utils/markdown'
import { tripDayNumber } from '@/utils/tripDay'

/**
 * Вкладка «Дневник» (16.11.2026).
 *
 * Заказчик: «это личная закладка, выглядит как большой чат, есть кнопки
 * вставки текущего времени, даты, порядкового номера дня похода, указания
 * участника. Дневник ведётся онлайн и оффлайн (синхронизация при
 * возвращении связи)».
 *
 * Отсюда устройство экрана:
 *
 * - **чат, а не список карточек.** Записи идут снизу вверх временем,
 *   между днями — разделитель с датой и номером дня похода; композер
 *   внизу, как в мессенджере. Дневник пишут в поле, а не заполняют форму.
 * - **записи только свои.** Сервер отдаёт пару «поход + человек», поэтому
 *   на экране нет имён авторов и выбора «чей дневник»: это твой журнал.
 *   Упоминание участника (`[[user:ID]]`) — просто ссылка в тексте, доступа
 *   к его дневнику не даёт.
 * - **кнопки вставок ставят текст в курсор.** Время, дата и «День N» —
 *   обычный текст в момент нажатия; участника вставляет сам редактор
 *   (`MarkdownEditor` умеет чипсы упоминаний). Так запись остаётся
 *   markdown-текстом, а не набором нередактируемых вставок.
 * - **офлайн — полноценная работа, а не просмотр.** Запись ложится
 *   в очередь (`offline/diaryOutbox.ts`) и уходит, когда появляется связь;
 *   в шапке видно «Не отправлено: N». Это единственная вкладка, где
 *   офлайн разрешает правку: дневник в поле и нужен.
 * - **день похода считается по факту.** Вышли раньше плана — день 1
 *   наступил по факту (`utils/tripDay.ts`); до старта номера нет, и кнопка
 *   выключена, а не подставляет отрицательное число.
 */
const props = defineProps<{ trip: Trip }>()

const router = useRouter()
const auth = useAuthStore()
const offline = useOfflineStore()

const entries = ref<TripDiaryEntry[]>([])
const pending = ref<DiaryOutboxEntry[]>([])
const participants = ref<TripParticipant[]>([])

const isLoading = ref(true)
const isSending = ref(false)
const error = ref<string | null>(null)
const syncError = ref<string | null>(null)

const draft = ref('')
const editingId = ref<string | null>(null)
const editDraft = ref('')
const confirmDeleteId = ref<string | null>(null)

const listEl = ref<HTMLElement | null>(null)
const editor = ref<InstanceType<typeof MarkdownEditor> | null>(null)

/** Номер дня похода на сегодня; `null` — поход ещё не начался. */
const dayNumber = computed(() => tripDayNumber(props.trip))

/** Подписи и адреса упоминаний: без них `[[user:ID]]` показался бы uuid. */
const mentionNames = computed<Record<string, string>>(() =>
  Object.fromEntries(
    participants.value.map((person) => [
      userToken(person.userId),
      person.displayName,
    ]),
  ),
)

const mentionLinks = computed<Record<string, string>>(() =>
  Object.fromEntries(
    participants.value.map((person) => [
      userToken(person.userId),
      `/people/${person.userId}`,
    ]),
  ),
)

const mentionOptions = computed(() =>
  participants.value.map((person) => ({
    id: person.userId,
    name: person.displayName,
  })),
)

const pendingCount = computed(() => pending.value.length)

const syncStatus = computed(() => {
  if (isSending.value) return 'Отправляем…'
  if (pendingCount.value > 0) {
    return offline.isOnline
      ? `Не отправлено: ${pendingCount.value}.`
      : `Не отправлено: ${pendingCount.value}. Отправим, когда появится связь.`
  }

  return entries.value.length > 0 ? 'Все записи сохранены.' : ''
})

/** Записи, сгруппированные по дням: разделитель — календарный день. */
const groups = computed(() => {
  const result: Array<{
    key: string
    dateText: string
    day: number | null
    entries: TripDiaryEntry[]
  }> = []

  for (const entry of entries.value) {
    const date = new Date(entry.createdAt)
    const key = localDayKey(date)
    const last = result[result.length - 1]

    if (!last || last.key !== key) {
      result.push({
        key,
        dateText: date.toLocaleDateString('ru-RU', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          weekday: 'long',
        }),
        day: tripDayNumber(props.trip, date),
        entries: [entry],
      })
    } else {
      last.entries.push(entry)
    }
  }

  return result
})

// ───────────────────────────── загрузка ─────────────────────────────

/**
 * Загрузить дневник и наложить на него очередь.
 *
 * Без сети `getTripDiary` отдаёт сохранённую копию. Если копии нет,
 * но в очереди что-то есть (человек писал ещё до прогрева), показываем
 * хотя бы её: терять написанное из-за отсутствия кеша нельзя.
 */
async function load(): Promise<void> {
  isLoading.value = true
  error.value = null

  const outbox = await readDiaryOutbox(props.trip.id)
  pending.value = outbox

  try {
    const remote = await getTripDiary(props.trip.id)
    entries.value = mergeDiaryEntries(remote.entries, outbox)
  } catch (problem) {
    if (outbox.length > 0) {
      entries.value = mergeDiaryEntries([], outbox)
    } else {
      entries.value = []
      error.value =
        problem instanceof ApiError
          ? problem.message
          : 'Не удалось загрузить дневник'
    }
  } finally {
    isLoading.value = false
  }

  await scrollToBottom()
}

/** Тихо перечитать с сервера: событие SSE или возврат на вкладку. */
async function reload(): Promise<void> {
  try {
    const [remote, outbox] = await Promise.all([
      getTripDiary(props.trip.id),
      readDiaryOutbox(props.trip.id),
    ])

    pending.value = outbox
    entries.value = mergeDiaryEntries(remote.entries, outbox)
  } catch {
    // Тихо: перечитать не вышло — на экране остаётся то, что уже есть.
  }
}

async function loadParticipants(): Promise<void> {
  try {
    participants.value = await listParticipants(props.trip.id)
  } catch {
    // Без состава упоминания покажутся «участник <id>», но дневник живёт.
  }
}

// ─────────────────────────── очередь и отправка ───────────────────────────

/**
 * Отправить накопленное.
 *
 * Очередь может пополниться, пока запрос в пути (человек пишет без остановки):
 * `pushDiaryOutbox` отправляет снимок и убирает только отправленные версии,
 * поэтому новые записи остаются и уйдут следующим заходом.
 */
async function flush(): Promise<void> {
  if (!offline.isOnline || pending.value.length === 0 || isSending.value) return

  isSending.value = true
  syncError.value = null
  let sent = false

  try {
    const result = await pushDiaryOutbox(props.trip.id)
    if (result) {
      pending.value = result.pending
      entries.value = mergeDiaryEntries(result.entries, result.pending)
    }
    sent = true
  } catch (problem) {
    syncError.value =
      problem instanceof ApiError
        ? problem.message
        : 'Не удалось отправить записи. Попробуем позже.'
  } finally {
    isSending.value = false
  }

  await scrollToBottom()

  // Пока запрос был в пути, человек мог дописать ещё: `pushDiaryOutbox`
  // отправляет снимок, поэтому новые правки ждут своей очереди. Догоняем
  // сразу, но только если предыдущая отправка была успешной — иначе
  // на отказе сервера вышло бы бесконечное «пробуем ещё раз».
  if (sent && pending.value.length > 0) void flush()
}

/** Поставить изменение в очередь и сразу показать его на экране. */
async function remember(change: DiaryOutboxEntry): Promise<void> {
  // Ошибка загрузки больше не актуальна: запись уже на экране и в очереди.
  error.value = null
  entries.value = mergeDiaryEntries(entries.value, [change])
  pending.value = await queueDiaryChange(props.trip.id, change)
}

// ───────────────────────────── действия ─────────────────────────────

async function addEntry(): Promise<void> {
  const body = draft.value.trim()
  if (body.length === 0) return

  const now = new Date().toISOString()
  await remember({
    id: newDiaryEntryId(),
    body,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  })

  draft.value = ''
  await scrollToBottom()
  void flush()
}

function startEdit(entry: TripDiaryEntry): void {
  editingId.value = entry.id
  editDraft.value = entry.body
  confirmDeleteId.value = null
}

function cancelEdit(): void {
  editingId.value = null
  editDraft.value = ''
}

async function saveEdit(entry: TripDiaryEntry): Promise<void> {
  const body = editDraft.value.trim()
  if (body.length === 0) return

  await remember({
    id: entry.id,
    body,
    createdAt: entry.createdAt,
    updatedAt: new Date().toISOString(),
    deletedAt: null,
  })

  cancelEdit()
  void flush()
}

/**
 * Удаление в два нажатия: первое спрашивает, второе удаляет.
 *
 * Дневник — единственная запись события, и отменить удаление негде;
 * поэтому здесь не «корзина», а простой вопрос перед исчезновением.
 */
async function removeEntry(entry: TripDiaryEntry): Promise<void> {
  if (confirmDeleteId.value !== entry.id) {
    confirmDeleteId.value = entry.id
    editingId.value = null
    return
  }

  confirmDeleteId.value = null
  const now = new Date().toISOString()

  await remember({
    id: entry.id,
    body: entry.body,
    createdAt: entry.createdAt,
    updatedAt: now,
    deletedAt: now,
  })

  if (editingId.value === entry.id) cancelEdit()
  void flush()
}

// ───────────────────────────── вставки ─────────────────────────────

/** Время в том виде, как его пишут в дневнике: «14:35». */
function insertTime(): void {
  editor.value?.insertText(
    new Date().toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    }),
  )
}

/** Дата числами: «16.11.2026» — так её и пишут в бумажном дневнике. */
function insertDate(): void {
  editor.value?.insertText(
    new Date().toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }),
  )
}

function insertDay(): void {
  if (dayNumber.value === null) return
  editor.value?.insertText(`День ${dayNumber.value}`)
}

// ─────────────────────────── разное ───────────────────────────

function bodyHtml(entry: TripDiaryEntry): string {
  return markdownToHtml(entry.body, mentionNames.value, mentionLinks.value)
}

function entryTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

/** Ссылка на человека внутри записи — переход без перезагрузки приложения. */
function onEntryClick(event: MouseEvent): void {
  const target = event.target
  if (!(target instanceof Element)) return

  const link = target.closest('a[data-user-id]')
  if (!link) return

  event.preventDefault()
  const userId = link.getAttribute('data-user-id')
  if (userId) void router.push({ name: 'person', params: { id: userId } })
}

async function scrollToBottom(): Promise<void> {
  await nextTick()
  if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight
}

/** Событие дневника: своё (другое устройство или вкладка) — перечитать. */
function onTripEvent(event: TripEvent): void {
  if (event.scope !== 'diary') return
  if (event.actorId !== auth.user?.id) return
  void reload()
}

/** Вернулись на вкладку — связь могла появиться, пока экран спал. */
function onVisibility(): void {
  if (document.visibilityState !== 'visible') return
  if (!offline.isOnline) return

  if (pending.value.length > 0) void flush()
  else void reload()
}

let unsubscribe: () => void = () => {}

onMounted(() => {
  void load().then(() => {
    if (offline.isOnline) void flush()
  })
  void loadParticipants()

  unsubscribe = subscribeTripEvents(props.trip.id, onTripEvent, 'diary')
  document.addEventListener('visibilitychange', onVisibility)
})

onUnmounted(() => {
  unsubscribe()
  document.removeEventListener('visibilitychange', onVisibility)
})

watch(
  () => props.trip.id,
  () => {
    cancelEdit()
    confirmDeleteId.value = null
    draft.value = ''
    void load()
    void loadParticipants()
  },
)

watch(
  () => offline.isOnline,
  (online) => {
    if (online) void flush()
  },
)
</script>

<template>
  <section
    class="flex flex-col overflow-hidden rounded-2xl border border-border bg-surface"
    data-test="trip-diary"
  >
    <header class="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
      <div class="flex flex-col gap-0.5">
        <h2 class="text-sm font-medium text-text">Дневник похода</h2>
        <p class="text-xs text-muted" data-test="diary-private-note">
          Личные записи: их видишь только ты. У каждого участника свой дневник.
        </p>
      </div>

      <p v-if="syncStatus" class="text-xs text-muted" data-test="diary-sync-status">
        {{ syncStatus }}
      </p>
    </header>

    <p v-if="error" class="px-4 py-3 text-sm text-muted" data-test="diary-error">
      {{ error }}
    </p>

    <p v-if="isLoading" class="px-4 py-3 text-sm text-muted" data-test="diary-loading">
      Загружаем дневник…
    </p>

    <p
      v-else-if="entries.length === 0"
      class="px-4 py-10 text-center text-sm text-muted"
      data-test="diary-empty"
    >
      Пока пусто. Первая запись — как первая страница дневника: что видел,
      с кем шёл, о чём думал.
    </p>

    <div
      v-else
      ref="listEl"
      class="flex max-h-[60vh] min-h-[16rem] flex-col gap-3 overflow-y-auto px-4 py-4"
      data-test="diary-entries"
      @click="onEntryClick"
    >
      <template v-for="group in groups" :key="group.key">
        <!-- Разделитель дня: дата и, если поход уже идёт, номер дня похода -->
        <div class="flex items-center gap-2 text-xs text-muted" data-test="diary-day">
          <span class="h-px flex-1 bg-border" />
          <span>
            {{ group.dateText }}
            <template v-if="group.day !== null"> · День {{ group.day }}</template>
          </span>
          <span class="h-px flex-1 bg-border" />
        </div>

        <article
          v-for="entry in group.entries"
          :key="entry.id"
          class="ml-auto flex w-full max-w-[85%] flex-col items-end gap-1"
          data-test="diary-entry"
        >
          <div class="w-full rounded-2xl rounded-br-md border border-border bg-field px-3 py-2">
            <div v-if="editingId === entry.id" class="flex flex-col gap-2" data-test="diary-editor">
              <MarkdownEditor
                v-model="editDraft"
                :objects="false"
                :emoji="true"
                :participants="mentionOptions"
                :mentions="mentionNames"
                min-height="5rem"
                placeholder="Текст записи"
              />

              <div class="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  class="cursor-pointer rounded-xl border border-border bg-surface px-3 py-1.5 text-xs text-text transition-colors hover:border-primary"
                  data-test="diary-edit-cancel"
                  @click="cancelEdit"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  class="cursor-pointer rounded-xl bg-primary px-3 py-1.5 text-xs font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
                  :disabled="editDraft.trim().length === 0"
                  data-test="diary-edit-save"
                  @click="saveEdit(entry)"
                >
                  Сохранить
                </button>
              </div>
            </div>

            <div
              v-else
              class="diary-entry text-sm leading-relaxed text-text"
              data-test="diary-entry-body"
              v-html="bodyHtml(entry)"
            />
          </div>

          <div class="flex items-center gap-2 text-[11px] text-muted">
            <button
              v-if="editingId !== entry.id"
              type="button"
              class="cursor-pointer underline transition-colors hover:text-primary"
              data-test="diary-edit"
              @click="startEdit(entry)"
            >
              Править
            </button>

            <button
              type="button"
              class="cursor-pointer underline transition-colors hover:text-primary"
              data-test="diary-delete"
              @click="removeEntry(entry)"
            >
              {{ confirmDeleteId === entry.id ? 'Удалить?' : 'Удалить' }}
            </button>

            <span data-test="diary-entry-time">{{ entryTime(entry.createdAt) }}</span>
          </div>
        </article>
      </template>
    </div>

    <p v-if="syncError" class="px-4 pb-2 text-xs text-red-600" data-test="diary-sync-error">
      {{ syncError }}
    </p>

    <form class="flex flex-col gap-2 border-t border-border px-4 py-3" @submit.prevent="addEntry">
      <!--
        Кнопки вставок: текст ставится в курсор, а не в конец записи.
        «День N» выключен до старта похода — номера ещё нет.
      -->
      <div class="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          class="cursor-pointer rounded-lg border border-border bg-field px-2 py-1 text-xs text-text transition-colors hover:border-primary hover:text-primary"
          data-test="diary-insert-time"
          @click="insertTime"
        >
          Время
        </button>

        <button
          type="button"
          class="cursor-pointer rounded-lg border border-border bg-field px-2 py-1 text-xs text-text transition-colors hover:border-primary hover:text-primary"
          data-test="diary-insert-date"
          @click="insertDate"
        >
          Дата
        </button>

        <button
          type="button"
          class="cursor-pointer rounded-lg border border-border bg-field px-2 py-1 text-xs text-text transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="dayNumber === null"
          :title="
            dayNumber === null
              ? 'Поход ещё не начался — номера дня нет'
              : `Вставить «День ${dayNumber}»`
          "
          data-test="diary-insert-day"
          @click="insertDay"
        >
          {{ dayNumber === null ? 'День похода' : `День ${dayNumber}` }}
        </button>
      </div>

      <MarkdownEditor
        ref="editor"
        v-model="draft"
        :objects="false"
        :emoji="true"
        :participants="mentionOptions"
        :mentions="mentionNames"
        min-height="6rem"
        placeholder="Что запомнилось? Время, дата, день похода и участник вставляются кнопками."
      />

      <button
        type="submit"
        class="self-end cursor-pointer rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="draft.trim().length === 0"
        data-test="diary-send"
      >
        Записать
      </button>
    </form>
  </section>
</template>
