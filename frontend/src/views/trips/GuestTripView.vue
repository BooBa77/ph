<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import { listObjectsByIds } from '@/api/objects'
import { fetchGuestTrip } from '@/api/trips'
import { ApiError } from '@/api/errors'
import {
  extractObjectIds,
  markdownToHtml,
  objectToken,
  type MentionLinks,
  type MentionNames,
} from '@/utils/markdown'
import { tripFrameParts, tripDatesText } from '@/utils/tripDisplay'
import {
  PARTICIPANT_STATUS_LABELS,
  PRESENCE_STATUS_LABELS,
  TRIP_STATUS_LABELS,
  type GuestTrip,
  type PresenceStatus,
  type TripParticipant,
  type TripRole,
} from '@/types/trips'
import TripAlmanac from '@/views/trips/TripAlmanac.vue'
import TripChat from '@/views/trips/TripChat.vue'

/**
 * «Гостевая» вкладка — обзор похода, один для всех.
 *
 * С 21.10.2026 отдельной вкладки «Инфо» нет: и участники, и гости видят
 * здесь одно и то же — цель, анонс, даты (решение и факт), статус, состав
 * с ролями, маршрут и требования. Правка — кнопкой «Редактировать»
 * в шапке. **Места сбора здесь нет**: «где встречаемся» уехало в «Трансфер».
 *
 * **Стоимость скрыта 09.11.2026** («возникли юридические вопросы»):
 * ни «что входит в стоимость», ни цена в строке «Рамка» не показываются.
 * Поля в модели остались — их спрашивает форма правки; вопрос отображения
 * решается здесь и в `utils/tripDisplay.ts`, а не удалением из базы.
 */
const props = defineProps<{ tripId: string }>()

/**
 * Свёрнутые секции «Гостевой»: чат и альманах (22.11.2026).
 *
 * Заказчик: «Чтобы было читабельно, обе секции „гостевой чат“ и „Альманах“
 * сделать сворачиваемыми, как Снаряжение и Питание. Гостевая должна помнить
 * состояние при переходах между закладками». Тот же приём, что в
 * «Снаряжении»: состояние — в `localStorage` на поход.
 *
 * Ключ у чата и альманаха общий (`ph.tripGuestView.open`), значения —
 * разные (`chat`, `almanac`): секции пишут только свой ключ, объединяя
 * с прочитанным, иначе вторая секция затирала бы состояние первой.
 */
const OPEN_STATE_PREFIX = 'ph.tripGuestView.open'

const chatOpen = ref(false)

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
    // Мусор в localStorage — свёрнутые секции, а не пустая «Гостевая».
    return {}
  }
}

function writeOpenState(tripId: string, key: string, open: boolean): void {
  try {
    const next = { ...readOpenState(tripId), [key]: open }
    window.localStorage.setItem(openStateKey(tripId), JSON.stringify(next))
  } catch {
    // Хранилище недоступно — память секции до перезагрузки. Вкладка живёт.
  }
}

function onChatToggle(event: Event): void {
  const open = (event.target as HTMLDetailsElement).open
  chatOpen.value = open
  writeOpenState(props.tripId, 'chat', open)
}

watch(
  () => props.tripId,
  (tripId) => {
    chatOpen.value = readOpenState(tripId).chat === true
  },
  { immediate: true },
)

const trip = ref<GuestTrip | null>(null)
const isLoading = ref(true)
const error = ref<string | null>(null)

const names = ref<MentionNames>({})
const links = ref<MentionLinks>({})

async function resolveObjects(text: string) {
  const ids = extractObjectIds(text ?? '')
  if (ids.length === 0) return

  const objects = await listObjectsByIds(ids)

  names.value = {
    ...names.value,
    ...Object.fromEntries(objects.map((object) => [objectToken(object.id), object.name])),
  }
  links.value = {
    ...links.value,
    ...Object.fromEntries(
      objects
        .filter((object) => object.url)
        .map((object) => [objectToken(object.id), object.url as string]),
    ),
  }
}

async function load() {
  isLoading.value = true
  error.value = null

  try {
    trip.value = await fetchGuestTrip(props.tripId)
    await resolveObjects(`${trip.value.routeText}\n${trip.value.requirementsText ?? ''}`)
  } catch (problem) {
    error.value =
      problem instanceof ApiError && problem.status === 404
        ? 'Поход не найден или закрыт'
        : 'Не удалось загрузить гостевой обзор'
    trip.value = null
  } finally {
    isLoading.value = false
  }
}

/**
 * Даты похода. 09.11.2026 заказчик попросил подпись «Когда» заменить
 * на «Даты» и вынести готовность в отдельную строку «Статус»: раньше
 * в одной строке стояло «5 мая 2027 г. · Решено», и «Решено» читалось
 * как дата, а не как состояние похода.
 *
 * Если дат нет (мечта, план), честнее написать «не заданы», чем показать
 * статус под подписью «Даты».
 */
const datesText = computed(() => {
  if (!trip.value) return ''
  return tripDatesText(trip.value) || 'не заданы'
})

const statusText = computed(() => (trip.value ? TRIP_STATUS_LABELS[trip.value.status] : ''))
const frame = computed(() => (trip.value ? tripFrameParts(trip.value).join(' · ') : ''))

const routeHtml = computed(() => markdownToHtml(trip.value?.routeText ?? '', names.value, links.value))
const requirementsHtml = computed(() =>
  markdownToHtml(trip.value?.requirementsText ?? '', names.value, links.value),
)

/**
 * Роли без «Организатора»: его уже показывает подпись «организатор».
 * Иначе выходило «организатор · Организатор» — одна и та же роль дважды.
 */
function extraRoles(person: TripParticipant): TripRole[] {
  return person.roles.filter((role) => role.code !== 'organizer')
}

/**
 * Присутствие видят и гости (решение 16.11.2026): «на маршруте» — публичная
 * информация, группа вышла и кто-то вернулся. До старта похода статуса нет:
 * «не отметился» за месяц до выхода — не факт, а шум.
 */
function presenceOf(person: TripParticipant): PresenceStatus {
  return person.presenceStatus ?? 'none'
}

const hasStarted = computed(
  () => trip.value?.startsAt != null && new Date(trip.value.startsAt).getTime() <= Date.now(),
)

function showPresence(person: TripParticipant): boolean {
  if (person.status === 'declined') return false

  return presenceOf(person) !== 'none' || hasStarted.value
}

onMounted(load)
</script>

<template>
  <section class="flex flex-col gap-4" data-test="guest-trip">
    <p v-if="isLoading" class="text-sm text-muted" data-test="guest-loading">Загружаем…</p>

    <p v-else-if="error" class="text-sm text-muted" data-test="guest-error">{{ error }}</p>

    <template v-else-if="trip">
      <!--
        Строки обзора. Значения — крупнее и полужирным (замечание заказчика
        09.11.2026: «оформи жирным шрифтом покрупнее значения — „Витязь“,
        даты, „Решено“, „Анна“, „Пётр“»): подпись мелкая и серая, а то,
        что человек ищет, должно читаться сразу.
      -->
      <dl class="grid gap-3 md:grid-cols-2">
        <div>
          <dt class="text-xs text-muted">Цель</dt>
          <dd class="text-base font-semibold text-text" data-test="guest-goal">
            {{ trip.goalObject?.name ?? '—' }}
            <span v-if="trip.goalObject" class="text-sm font-normal text-muted">
              · {{ trip.goalObject.type }}
            </span>
          </dd>
        </div>

        <div>
          <dt class="text-xs text-muted">Даты</dt>
          <dd class="text-base font-semibold text-text" data-test="guest-dates">
            {{ datesText }}
          </dd>
        </div>

        <div>
          <dt class="text-xs text-muted">Статус</dt>
          <dd class="text-base font-semibold text-text" data-test="guest-status">
            {{ statusText }}
          </dd>
        </div>

        <div>
          <dt class="text-xs text-muted">Рамка</dt>
          <dd class="text-base font-semibold text-text" data-test="guest-frame">{{ frame }}</dd>
        </div>

        <div v-if="trip.isRecruitmentClosed">
          <dt class="text-xs text-muted">Набор</dt>
          <dd class="text-base font-semibold text-text">закрыт</dd>
        </div>
      </dl>

      <div v-if="trip.announcement" class="text-sm text-text" data-test="guest-announcement">
        {{ trip.announcement }}
      </div>

      <!--
        Состав — часть анонса и виден всем: с 21.10.2026 у «Гостевой» нет
        «урезанного» режима для гостей. Роли и статусы показываем как есть,
        имя — крупным полужирным, как остальные значения обзора.
      -->
      <div v-if="trip.participants.length > 0">
        <h2 class="mb-1 text-sm text-muted">Состав</h2>
        <ul class="flex flex-col gap-1 text-sm text-text" data-test="guest-participants">
          <li v-for="person in trip.participants" :key="person.userId">
            <span class="text-base font-semibold">{{ person.displayName }}</span>
            <span v-if="person.isOrganizer" class="text-muted"> · организатор</span>
            <span v-if="extraRoles(person).length" class="text-muted">
              · {{ extraRoles(person).map((role) => role.name).join(', ') }}
            </span>
            <span class="text-muted"> · {{ PARTICIPANT_STATUS_LABELS[person.status] }}</span>
            <span
              v-if="showPresence(person)"
              class="text-muted"
              data-test="guest-presence"
            >
              · {{ PRESENCE_STATUS_LABELS[presenceOf(person)] }}
            </span>
          </li>
        </ul>
      </div>

      <div v-if="trip.routeText.trim()">
        <h2 class="mb-1 text-sm text-muted">Маршрут</h2>
        <div
          class="flex flex-col gap-1 text-sm leading-relaxed text-text"
          data-test="guest-route"
          v-html="routeHtml"
        />
      </div>

      <div v-if="trip.requirementsText?.trim()">
        <h2 class="mb-1 text-sm text-muted">Требования к участникам</h2>
        <div
          class="flex flex-col gap-1 text-sm leading-relaxed text-text"
          data-test="guest-requirements"
          v-html="requirementsHtml"
        />
      </div>

      <!--
        Гостевой чат — часть «Гостевой», отдельной вкладки «Чаты» нет.
        С 22.11.2026 он свёрнут в секцию: страница обзора иначе начинается
        с чужих сообщений, а не с похода.
      -->
      <details
        :open="chatOpen"
        class="rounded-2xl border border-border bg-surface"
        data-test="guest-chat-section"
        @toggle="onChatToggle"
      >
        <summary class="cursor-pointer select-none px-4 py-3 text-sm font-medium text-text">
          Гостевой чат
        </summary>

        <div class="border-t border-border px-4 py-4">
          <TripChat :trip-id="trip.id" kind="trip_guest" />
        </div>
      </details>

      <!--
        Альманах — тоже секция «Гостевой» (решение заказчика 22.11.2026).
        Появляется после завершения похода: до него собирать ещё нечего.
      -->
      <TripAlmanac v-if="trip.completedAt" :trip="trip" />
    </template>
  </section>
</template>
