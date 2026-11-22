<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { getTripAlmanac } from '@/api/diary'
import { ApiError } from '@/api/errors'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import type { AlmanacEntry, TripAlmanac } from '@/types/diary'
import type { Trip } from '@/types/trips'
import { markdownToHtml, userToken } from '@/utils/markdown'
import { tripDayNumber } from '@/utils/tripDay'

/**
 * «Альманах» похода — общий текст из записей, которые авторы разрешили
 * включить (22.11.2026).
 *
 * Заказчик: «собирает организатор или соорганизатор кнопкой «Собрать
 * альманах» после завершения похода»; «в альманах попадают только записи,
 * помеченные автором «можно в альманах»»; «формат: хронология по дате,
 * разделители «День N · дата», записи с автором, markdown; записи
 * не правятся».
 *
 * Отсюда устройство экрана:
 *
 * - **Сборка — действие организатора.** У него вкладка начинается
 *   с кнопки; остальные (участники и гости) видят готовый текст сразу:
 *   им собирать нечего, а ждать нажатия чужой кнопки незачем.
 * - **Записи только читаются.** Ни правки, ни удаления здесь нет: альманах —
 *   компиляция, а не документ с соавторами; поправить свою строку автор
 *   может в своём дневнике.
 * - **День считается на устройстве.** `tripDayNumber` берёт дату старта
 *   по часовому поясу смотрящего — сервер отдаёт моменты времени, а не
 *   календарные дни.
 * - **Упоминания `[[user:ID]]` — ссылки на профиль.** Имена берём у авторов
 *   альманаха: у гостя списка участников нет (он закрыт), а токен чужого
 *   человека всё равно должен открывать профиль, а не показывать UUID.
 */
const props = defineProps<{ trip: Trip; canAssemble: boolean }>()

const router = useRouter()

const almanac = ref<TripAlmanac | null>(null)
const isLoading = ref(false)
const error = ref<string | null>(null)

/** Собрать (или пересобрать) альманах: это и есть кнопка организатора. */
async function load(): Promise<void> {
  if (isLoading.value) return

  isLoading.value = true
  error.value = null

  try {
    almanac.value = await getTripAlmanac(props.trip.id)
  } catch (problem) {
    error.value =
      problem instanceof ApiError
        ? problem.message
        : 'Не удалось собрать альманах. Попробуй ещё раз.'
  } finally {
    isLoading.value = false
  }
}

onMounted(() => {
  // Организатор собирает сам — кнопкой. Остальным собирать нечего.
  if (!props.canAssemble) void load()
})

const entryCount = computed(() => almanac.value?.entries.length ?? 0)

/** Сколько человек написали в альманах — подпись под заголовком. */
const authorCount = computed(
  () => new Set((almanac.value?.entries ?? []).map((entry) => entry.author.userId)).size,
)

const countText = computed(() => {
  const entries = `${entryCount.value} ${entriesWord(entryCount.value)}`
  if (authorCount.value === 0) return ''
  return `${entries} · ${authorCount.value} ${authorsWord(authorCount.value)}`
})

function entriesWord(count: number): string {
  const tail = count % 100
  if (tail >= 11 && tail <= 14) return 'записей'
  const last = count % 10
  if (last === 1) return 'запись'
  if (last >= 2 && last <= 4) return 'записи'
  return 'записей'
}

function authorsWord(count: number): string {
  const last = count % 10
  if (count % 100 >= 11 && count % 100 <= 14) return 'авторов'
  if (last === 1) return 'автор'
  if (last >= 2 && last <= 4) return 'автора'
  return 'авторов'
}

/**
 * Токены упоминаний для рендера: имя автора и ссылка на его профиль.
 *
 * Одного имени мало: `markdownToHtml` показывает голый UUID, если токена
 * нет в словаре, — а в общем тексте это выглядело бы поломкой.
 */
const mentionNames = computed<Record<string, string>>(() =>
  Object.fromEntries(
    (almanac.value?.entries ?? []).map((entry) => [
      userToken(entry.author.userId),
      entry.author.displayName,
    ]),
  ),
)

const mentionLinks = computed<Record<string, string>>(() =>
  Object.fromEntries(
    (almanac.value?.entries ?? []).map((entry) => [
      userToken(entry.author.userId),
      `/people/${entry.author.userId}`,
    ]),
  ),
)

/** Хронология по календарным дням: разделитель «День N · дата». */
const groups = computed(() => {
  const result: Array<{
    key: string
    title: string
    entries: AlmanacEntry[]
  }> = []

  for (const entry of almanac.value?.entries ?? []) {
    const date = new Date(entry.createdAt)
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
    const last = result[result.length - 1]

    if (!last || last.key !== key) {
      const day = tripDayNumber(props.trip, date)
      const dateText = date
        .toLocaleDateString('ru-RU', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
        // «15 ноября 2026 г.» → «15 ноября 2026»: сокращение «г.» в общем
        // тексте читается как канцелярит, а год и так виден.
        .replace(/\s*г\.$/, '')
      result.push({
        key,
        // До старта номера дня нет: записи, сделанные в подготовке, — тоже
        // часть альманаха, и врать им «День 1» нельзя.
        title: day === null ? `До старта · ${dateText}` : `День ${day} · ${dateText}`,
        entries: [entry],
      })
    } else {
      last.entries.push(entry)
    }
  }

  return result
})

function bodyHtml(entry: AlmanacEntry): string {
  return markdownToHtml(entry.body, mentionNames.value, mentionLinks.value)
}

function entryTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Ссылка на профиль внутри markdown — через роутер, без перезагрузки. */
function onEntryClick(event: MouseEvent): void {
  const target = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>(
    'a[data-user-id]',
  )
  if (!target) return

  event.preventDefault()
  void router.push({ name: 'person', params: { id: target.dataset.userId } })
}
</script>

<template>
  <section
    class="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface"
    data-test="trip-almanac"
  >
    <header class="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
      <div class="flex min-w-0 flex-col gap-0.5">
        <h2 class="text-sm font-medium text-text">Альманах похода</h2>
        <p class="text-xs text-muted" data-test="almanac-note">
          Общий текст из записей, которые авторы разрешили включить. Чужих
          дневников здесь нет и не будет.
        </p>
        <p v-if="entryCount > 0" class="text-xs text-muted" data-test="almanac-count">
          {{ countText }}
        </p>
      </div>

      <button
        v-if="canAssemble"
        type="button"
        class="cursor-pointer rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="isLoading"
        data-test="almanac-assemble"
        @click="load"
      >
        {{ almanac === null ? 'Собрать альманах' : 'Собрать заново' }}
      </button>
    </header>

    <p v-if="error" class="px-4 py-3 text-sm text-muted" data-test="almanac-error">
      {{ error }}
    </p>

    <p
      v-if="isLoading"
      class="px-4 py-3 text-sm text-muted"
      data-test="almanac-loading"
    >
      Собираем альманах…
    </p>

    <!--
      Организатор до нажатия кнопки видит объяснение, а не пустоту:
      «собрать» — его действие, и оно должно быть понятным.
    -->
    <p
      v-else-if="almanac === null && !error"
      class="px-4 py-10 text-center text-sm text-muted"
      data-test="almanac-idle"
    >
      Нажми «Собрать альманах» — записи, помеченные «в альманах», встанут
      в хронологию по дням похода.
    </p>

    <p
      v-else-if="almanac !== null && entryCount === 0"
      class="px-4 py-10 text-center text-sm text-muted"
      data-test="almanac-empty"
    >
      В альманах пока не попала ни одна запись: авторы не пометили их
      «можно в альманах». Пометка стоит у записи в дневнике.
    </p>

    <div
      v-else-if="almanac !== null"
      class="flex flex-col gap-6 px-4 py-4"
      data-test="almanac-days"
      @click="onEntryClick"
    >
      <section v-for="group in groups" :key="group.key" class="flex min-w-0 flex-col gap-3">
        <!-- Разделитель дня: «День N · дата» (решение заказчика) -->
        <div class="flex items-center gap-2 text-xs text-muted" data-test="almanac-day">
          <span class="h-px flex-1 bg-border" />
          <span class="shrink-0">{{ group.title }}</span>
          <span class="h-px flex-1 bg-border" />
        </div>

        <article
          v-for="entry in group.entries"
          :key="entry.id"
          class="flex min-w-0 flex-col gap-1"
          data-test="almanac-entry"
        >
          <div class="flex min-w-0 flex-wrap items-center gap-2">
            <UserAvatar
              :src="entry.author.avatarUrl"
              :alt="entry.author.displayName"
              :size="24"
            />
            <span class="min-w-0 truncate text-sm font-medium text-text" data-test="almanac-author">
              {{ entry.author.displayName }}
            </span>
            <span class="text-[11px] text-muted" data-test="almanac-entry-time">
              {{ entryTime(entry.createdAt) }}
            </span>
          </div>

          <div
            class="min-w-0 break-words text-sm leading-relaxed text-text"
            data-test="almanac-entry-body"
            v-html="bodyHtml(entry)"
          />
        </article>
      </section>
    </div>
  </section>
</template>
