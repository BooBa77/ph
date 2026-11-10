<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'

import { ApiError } from '@/api/errors'
import {
  acceptFamilyMember,
  addFamilyMember,
  createVirtual,
  declineFamilyMember,
  getMyFamily,
  listMyVirtual,
  removeFamilyMember,
  removeVirtual,
  searchUsers,
  type FamilyList,
  type FamilyMember,
  type FamilyRequest,
  type UserSearchResult,
  type VirtualUser,
} from '@/api/users'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import type { Gender } from '@/api/types'

/**
 * «Контакты» — родные и люди без аккаунта (10.11.2026).
 *
 * Заказчик: «Вводим понятие „родные“, это члены семьи, с которыми общий
 * бюджет и снаряжение. В разделе Контакты заводим первые две секции
 * (сворачиваемые) „Родные“ и „Люди без аккаунта, под моим управлением“,
 * в дальнейшем будут ещё — Одногруппники и кастомные».
 *
 * Отсюда устройство:
 *
 * - **две сворачиваемые секции**, как у вкладок похода. Первый раз обе
 *   открыты: страница из двух закрытых рамок выглядит пустой, а сюда
 *   приходят именно за списком. Раскрытие помнится в
 *   `localStorage` (`ph.contacts.open`);
 * - **«Родные» — поиск, добавление и удаление.** Родство взаимно:
 *   настоящему человеку уходит запрос на подтверждение, и он же виден
 *   у него входящим. Свой человек без аккаунта становится родным сразу:
 *   подтверждать ему нечем;
 * - **«Люди без аккаунта»** — те же строки `users`, что и в «Походах →
 *   Участники», поэтому заведённый здесь человек появляется и там.
 *   Удалять можно только до начала похода: кто уже сходил, нужен истории.
 *
 * Поиск по людям переехал внутрь «Добавить родного»: отдельная секция
 * «найти кого угодно» в «Родных» дублировала бы тот же поиск, а раздел
 * Контактов теперь про свои связи, а не про справочник всех.
 */
const MIN_LENGTH = 2

/** Пауза перед поиском: на каждую букву ходить в сервер незачем. */
const SEARCH_DELAY_MS = 300

/**
 * Раскрытие секций. `true`/`false` — явный выбор человека; отсутствие
 * ключа — «ещё не трогали», и тогда секция открыта.
 */
const OPEN_STATE_KEY = 'ph.contacts.open'

const family = ref<FamilyList>({ family: [], incoming: [], outgoing: [] })
const virtuals = ref<VirtualUser[]>([])

const isLoading = ref(true)
const loadError = ref<string | null>(null)

/** Ошибка действия: удаление, добавление, ответ на запрос. */
const actionError = ref<string | null>(null)

/** Короткое подтверждение действия — «запрос отправлен», «родной добавлен». */
const notice = ref<string | null>(null)

const openState = ref<Record<string, boolean>>(readOpenState())

function readOpenState(): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(OPEN_STATE_KEY)
    if (raw === null) return {}

    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}

    const result: Record<string, boolean> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'boolean') result[key] = value
    }

    return result
  } catch {
    // Мусор в хранилище — открытые секции, а не пустая страница.
    return {}
  }
}

function writeOpenState(next: Record<string, boolean>): void {
  try {
    window.localStorage.setItem(OPEN_STATE_KEY, JSON.stringify(next))
  } catch {
    // Хранилище недоступно — память до перезагрузки. Страница живёт.
  }
}

/** Секция открыта, пока человек явно её не свернул. */
function isSectionOpen(key: string): boolean {
  return openState.value[key] !== false
}

function onSectionToggle(key: string, event: Event): void {
  const open = (event.target as HTMLDetailsElement).open
  if (isSectionOpen(key) === open) return

  const next = { ...openState.value, [key]: open }
  openState.value = next
  writeOpenState(next)
}

function errorText(problem: unknown, fallback: string): string {
  return problem instanceof ApiError ? problem.message : fallback
}

// ─────────────────────────────── загрузка ───────────────────────────────

async function loadFamily(): Promise<void> {
  family.value = await getMyFamily()
}

async function loadVirtuals(): Promise<void> {
  virtuals.value = await listMyVirtual()
}

async function loadAll(): Promise<void> {
  isLoading.value = true
  loadError.value = null

  try {
    await Promise.all([loadFamily(), loadVirtuals()])
  } catch (problem) {
    loadError.value = errorText(problem, 'Не удалось загрузить контакты')
  } finally {
    isLoading.value = false
  }
}

onMounted(loadAll)

// ─────────────────────────────── родные ───────────────────────────────

/** Фильтр по действующим родным. Запросы фильтруются вместе с ними? Нет: их мало. */
const familyFilter = ref('')

const filteredFamily = computed<FamilyMember[]>(() => {
  const text = familyFilter.value.trim().toLowerCase()
  if (text.length === 0) return family.value.family

  return family.value.family.filter((member) =>
    member.displayName.toLowerCase().includes(text),
  )
})

/** Кого уже связали — чтобы поиск не предлагал добавить повторно. */
const linkedIds = computed(() => {
  return new Set([
    ...family.value.family.map((member) => member.userId),
    ...family.value.incoming.map((request) => request.userId),
    ...family.value.outgoing.map((request) => request.userId),
  ])
})

async function removeMember(member: FamilyMember): Promise<void> {
  await runAction(
    () => removeFamilyMember(member.userId),
    `«${member.displayName}» больше не родной`,
    'Не удалось убрать из родных',
  )
}

async function cancelRequest(request: FamilyRequest): Promise<void> {
  await runAction(
    () => removeFamilyMember(request.userId),
    'Запрос отменён',
    'Не удалось отменить запрос',
  )
}

async function answerRequest(request: FamilyRequest, accept: boolean): Promise<void> {
  await runAction(
    async () => {
      if (accept) {
        await acceptFamilyMember(request.userId)
      } else {
        await declineFamilyMember(request.userId)
      }
    },
    accept ? `«${request.displayName}» теперь родной` : 'Запрос отклонён',
    accept ? 'Не удалось принять запрос' : 'Не удалось отклонить запрос',
  )
}

// ───────────────────────── добавление родного ─────────────────────────

const adding = ref(false)
const search = ref('')
const searchResults = ref<UserSearchResult[]>([])
const isSearching = ref(false)
const searchError = ref<string | null>(null)
const addingUserId = ref<string | null>(null)

let searchTimer: ReturnType<typeof setTimeout> | undefined

const availableResults = computed(() =>
  searchResults.value.filter((person) => !linkedIds.value.has(person.id)),
)

const availableVirtuals = computed(() =>
  virtuals.value.filter((person) => !linkedIds.value.has(person.id)),
)

function toggleAdding(): void {
  adding.value = !adding.value
  actionError.value = null
  notice.value = null

  if (!adding.value) {
    if (searchTimer) clearTimeout(searchTimer)
    search.value = ''
    searchResults.value = []
    searchError.value = null
  }
}

async function searchPeople(): Promise<void> {
  const text = search.value.trim()

  if (text.length < MIN_LENGTH) {
    searchResults.value = []
    searchError.value = null
    return
  }

  isSearching.value = true
  searchError.value = null

  try {
    searchResults.value = await searchUsers(text)
  } catch {
    searchError.value = 'Не удалось выполнить поиск.'
    searchResults.value = []
  } finally {
    isSearching.value = false
  }
}

watch(search, () => {
  if (!adding.value) return

  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(searchPeople, SEARCH_DELAY_MS)
})

onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer)
})

async function addPerson(userId: string): Promise<void> {
  if (addingUserId.value !== null) return

  addingUserId.value = userId
  actionError.value = null
  notice.value = null

  try {
    const result = await addFamilyMember(userId)
    await loadFamily()

    notice.value =
      result.status === 'accepted'
        ? 'Родной добавлен'
        : 'Запрос отправлен — ждём подтверждения'

    search.value = ''
    searchResults.value = []
  } catch (problem) {
    actionError.value = errorText(problem, 'Не удалось добавить родного')
  } finally {
    addingUserId.value = null
  }
}

// ─────────────────────── люди без аккаунта ───────────────────────

const newVirtualName = ref('')
const newVirtualGender = ref<Gender>('m')
const isCreatingVirtual = ref(false)
const virtualError = ref<string | null>(null)

/** Подтверждение удаления: первый клик — «Точно?», второй — удаление. */
const confirmingDeleteId = ref<string | null>(null)

async function createPerson(): Promise<void> {
  const name = newVirtualName.value.trim()
  if (name.length < 2 || isCreatingVirtual.value) return

  isCreatingVirtual.value = true
  virtualError.value = null
  actionError.value = null
  notice.value = null

  try {
    await createVirtual({ displayName: name, gender: newVirtualGender.value })
    newVirtualName.value = ''
    await loadVirtuals()
    notice.value = 'Человек без аккаунта заведён'
  } catch (problem) {
    virtualError.value = errorText(problem, 'Не удалось завести человека')
  } finally {
    isCreatingVirtual.value = false
  }
}

/**
 * Удаление в два нажатия: человек может быть участником подготовки, и
 * одно случайное нажатие уносит его из походов. Кто уже сходил — кнопка
 * неактивна, и подпись объясняет почему.
 */
async function deletePerson(person: VirtualUser): Promise<void> {
  if (!person.canDelete) return
  if (confirmingDeleteId.value !== person.id) {
    confirmingDeleteId.value = person.id
    return
  }

  confirmingDeleteId.value = null
  virtualError.value = null
  actionError.value = null
  notice.value = null

  try {
    await removeVirtual(person.id)
    await Promise.all([loadVirtuals(), loadFamily()])
    notice.value = `«${person.displayName}» удалён`
  } catch (problem) {
    virtualError.value = errorText(problem, 'Не удалось удалить человека')
  }
}

/**
 * Почему удалить нельзя — полная формулировка для `title`.
 *
 * Заказчик 10.11.2026: подпись «уже был в походе» непонятна, и справедливо —
 * запрет определяется **датами**: поход, который уже начался или прошёл
 * (`COALESCE(actual_started_at, starts_at) <= now()`), и участие `going`.
 * Сервер присылает этот поход, поэтому подсказка говорит не «был», а когда
 * именно начался поход и почему запись остаётся.
 */
function deleteBlockedReason(person: VirtualUser): string {
  const trip = person.blockedByTrip
  // `!trip`, а не `=== null`: старый dev-бэкенд (bind-mount не подхватил
  // код) и ответ из кеша приходят без поля, и падать на этом экран нельзя.
  if (!trip) return 'Запись нужна истории похода'

  const started = new Date(trip.startedAt).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  return `Поход «${trip.title}» уже начался ${started} — запись нужна его истории`
}

/** Та же причина коротко: в строке списка длинный текст не помещается. */
function deleteBlockedLabel(): string {
  return 'поход уже начался'
}

// ────────────────────────── общий запуск действия ──────────────────────────

async function runAction(
  action: () => Promise<unknown>,
  successMessage: string,
  fallback: string,
): Promise<void> {
  actionError.value = null
  notice.value = null

  try {
    await action()
    await loadFamily()
    notice.value = successMessage
  } catch (problem) {
    actionError.value = errorText(problem, fallback)
  }
}
</script>

<template>
  <section data-test="people">
    <h2 class="mb-2 text-xl font-semibold text-text">Контакты</h2>

    <p class="mb-4 text-sm text-muted">
      Родные делят с вами бюджет и снаряжение. Люди без аккаунта живут в походах
      под вашим управлением.
    </p>

    <p v-if="isLoading" class="text-sm text-muted" data-test="contacts-loading">Загружаем…</p>

    <p v-else-if="loadError" class="text-sm text-muted" data-test="contacts-error">
      {{ loadError }}
    </p>

    <template v-else>
      <p v-if="actionError" class="mb-3 text-sm text-red-600" data-test="contacts-action-error">
        {{ actionError }}
      </p>

      <p v-if="notice" class="mb-3 text-sm text-green-700" data-test="contacts-notice">
        {{ notice }}
      </p>

      <!-- Родные — тёплый цвет: семья и общий бюджет. -->
      <details
        :open="isSectionOpen('family')"
        class="mb-3 flex flex-col gap-3 rounded-2xl border border-orange-900 bg-orange-100 p-3"
        data-test="contacts-family"
        @toggle="onSectionToggle('family', $event)"
      >
        <summary class="cursor-pointer select-none text-sm font-medium text-orange-900">
          <span class="inline-block max-w-full truncate align-bottom">
            Родные
            <span
              v-if="family.incoming.length > 0"
              class="ml-2 rounded-full bg-white px-2 py-0.5 text-xs font-normal text-orange-900"
              data-test="family-incoming-count"
            >
              {{ family.incoming.length }} запросов: ответьте
            </span>
          </span>
        </summary>

        <div class="flex flex-col gap-3 rounded-xl border border-border bg-white p-3">
          <!-- Входящие запросы — первыми: это действие человека, а не список. -->
          <div v-if="family.incoming.length > 0" class="flex flex-col gap-2" data-test="family-incoming">
            <h3 class="text-sm font-medium text-text">Хотят стать родными</h3>

            <div
              v-for="request in family.incoming"
              :key="request.userId"
              class="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-2"
              data-test="family-incoming-item"
            >
              <UserAvatar :src="request.avatarUrl" :alt="request.displayName" :size="32" />
              <RouterLink
                :to="{ name: 'person', params: { id: request.userId } }"
                class="min-w-0 flex-1 truncate text-sm text-text"
              >
                {{ request.displayName }}
              </RouterLink>

              <button
                type="button"
                class="cursor-pointer rounded-lg border border-primary bg-primary px-2 py-1 text-xs text-white transition-opacity hover:opacity-90"
                data-test="family-accept"
                @click="answerRequest(request, true)"
              >
                Принять
              </button>
              <button
                type="button"
                class="cursor-pointer rounded-lg border border-border bg-white px-2 py-1 text-xs text-muted transition-colors hover:border-primary hover:text-text"
                data-test="family-decline"
                @click="answerRequest(request, false)"
              >
                Отклонить
              </button>
            </div>
          </div>

          <!-- Инструменты секции: поиск по своим и добавление. -->
          <div class="flex flex-wrap items-center gap-2">
            <input
              v-model="familyFilter"
              type="search"
              placeholder="Поиск по родным"
              class="min-w-0 flex-1 rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none md:text-sm"
              data-test="family-filter"
            />
            <button
              type="button"
              class="cursor-pointer rounded-xl border border-primary bg-primary px-3 py-2 text-sm text-white transition-opacity hover:opacity-90"
              data-test="family-add-toggle"
              @click="toggleAdding"
            >
              {{ adding ? 'Скрыть поиск' : 'Добавить родного' }}
            </button>
          </div>

          <!-- Поиск человека на сайте и выбор из своих людей без аккаунта. -->
          <div v-if="adding" class="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3" data-test="family-add-panel">
            <label class="flex flex-col gap-1 text-sm text-muted">
              Найти человека на сайте
              <input
                v-model="search"
                type="search"
                placeholder="Имя: «Иван»"
                class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none md:text-sm"
                data-test="family-add-search"
              />
            </label>

            <p v-if="searchError" class="text-sm text-red-600" data-test="family-add-error">
              {{ searchError }}
            </p>
            <p v-else-if="isSearching" class="text-sm text-muted" data-test="family-add-loading">Ищем…</p>

            <ul v-else-if="availableResults.length > 0" class="flex flex-col gap-2" data-test="family-add-results">
              <li v-for="person in availableResults" :key="person.id">
                <div class="flex items-center gap-2">
                  <UserAvatar :src="person.avatarUrl" :alt="person.displayName" :size="32" />
                  <span class="min-w-0 flex-1 truncate text-sm text-text">{{ person.displayName }}</span>
                  <button
                    type="button"
                    class="cursor-pointer rounded-lg border border-primary bg-white px-2 py-1 text-xs text-primary transition-colors hover:bg-primary hover:text-white"
                    :disabled="addingUserId !== null"
                    data-test="family-add-option"
                    @click="addPerson(person.id)"
                  >
                    Добавить
                  </button>
                </div>
              </li>
            </ul>

            <p
              v-else-if="search.trim().length >= MIN_LENGTH"
              class="text-sm text-muted"
              data-test="family-add-empty"
            >
              Никого не нашлось. Имена чувствительны к опечаткам — попробуйте часть имени.
            </p>
            <p v-else class="text-sm text-muted" data-test="family-add-hint">
              Начните вводить имя — от двух символов.
            </p>

            <div v-if="availableVirtuals.length > 0" class="flex flex-col gap-2">
              <h3 class="text-sm font-medium text-text">Или из моих людей без аккаунта</h3>

              <div
                v-for="person in availableVirtuals"
                :key="person.id"
                class="flex items-center gap-2"
                data-test="family-add-virtual"
              >
                <UserAvatar :src="null" :alt="person.displayName" :size="32" />
                <span class="min-w-0 flex-1 truncate text-sm text-text">{{ person.displayName }}</span>
                <span class="text-xs text-muted">без аккаунта</span>
                <button
                  type="button"
                  class="cursor-pointer rounded-lg border border-primary bg-white px-2 py-1 text-xs text-primary transition-colors hover:bg-primary hover:text-white"
                  :disabled="addingUserId !== null"
                  data-test="family-add-virtual-option"
                  @click="addPerson(person.id)"
                >
                  Добавить
                </button>
              </div>
            </div>
          </div>

          <!-- Исходящие запросы: ждут ответа другого человека. -->
          <div v-if="family.outgoing.length > 0" class="flex flex-col gap-2" data-test="family-outgoing">
            <h3 class="text-sm font-medium text-text">Ждут подтверждения</h3>

            <div
              v-for="request in family.outgoing"
              :key="request.userId"
              class="flex items-center gap-2 rounded-xl border border-dashed border-border p-2"
              data-test="family-outgoing-item"
            >
              <UserAvatar :src="request.avatarUrl" :alt="request.displayName" :size="32" />
              <span class="min-w-0 flex-1 truncate text-sm text-muted">{{ request.displayName }}</span>
              <button
                type="button"
                class="cursor-pointer rounded-lg border border-border bg-white px-2 py-1 text-xs text-muted transition-colors hover:border-primary hover:text-text"
                data-test="family-cancel"
                @click="cancelRequest(request)"
              >
                Отменить
              </button>
            </div>
          </div>

          <!-- Действующие родные. -->
          <ul v-if="filteredFamily.length > 0" class="flex flex-col gap-2" data-test="family-list">
            <li
              v-for="member in filteredFamily"
              :key="member.userId"
              class="flex items-center gap-2 rounded-xl border border-border bg-surface p-2"
              data-test="family-member"
            >
              <UserAvatar :src="member.avatarUrl" :alt="member.displayName" :size="40" />

              <RouterLink
                v-if="!member.isVirtual"
                :to="{ name: 'person', params: { id: member.userId } }"
                class="min-w-0 flex-1 truncate text-sm text-text"
              >
                {{ member.displayName }}
              </RouterLink>
              <span v-else class="min-w-0 flex-1 truncate text-sm text-text">
                {{ member.displayName }}
              </span>

              <span v-if="member.isVirtual" class="text-xs text-muted" data-test="family-member-virtual">
                без аккаунта
              </span>

              <button
                type="button"
                class="cursor-pointer rounded-lg border-0 bg-transparent px-1.5 py-0.5 text-base leading-none text-muted transition-colors hover:text-red-600"
                :aria-label="`Убрать «${member.displayName}» из родных`"
                title="Убрать из родных"
                data-test="family-remove"
                @click="removeMember(member)"
              >
                ×
              </button>
            </li>
          </ul>

          <p
            v-else-if="family.family.length === 0"
            class="text-sm text-muted"
            data-test="family-empty"
          >
            Пока никого. Добавьте родного по имени — он подтвердит, и вы увидите друг друга.
          </p>
          <p v-else class="text-sm text-muted" data-test="family-filter-empty">
            По этому имени никого нет.
          </p>
        </div>
      </details>

      <!-- Люди без аккаунта — синий цвет: та же «личная» ветка, что в походах. -->
      <details
        :open="isSectionOpen('virtual')"
        class="flex flex-col gap-3 rounded-2xl border border-blue-300 bg-blue-100 p-3"
        data-test="contacts-virtual"
        @toggle="onSectionToggle('virtual', $event)"
      >
        <summary class="cursor-pointer select-none text-sm font-medium text-blue-900">
          <span class="inline-block max-w-full truncate align-bottom">
            Люди без аккаунта, под моим управлением
          </span>
        </summary>

        <div class="flex flex-col gap-3 rounded-xl border border-border bg-white p-3">
          <form class="flex flex-wrap items-end gap-2" data-test="virtual-form" @submit.prevent="createPerson">
            <label class="flex min-w-0 flex-1 flex-col gap-1 text-sm text-muted">
              Имя
              <input
                v-model="newVirtualName"
                type="text"
                placeholder="Например, Дядя Витя"
                class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none md:text-sm"
                data-test="virtual-name"
              />
            </label>

            <label class="flex flex-col gap-1 text-sm text-muted">
              Пол
              <select
                v-model="newVirtualGender"
                class="rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none md:text-sm"
                data-test="virtual-gender"
              >
                <option value="m">Мужской</option>
                <option value="f">Женский</option>
              </select>
            </label>

            <button
              type="submit"
              class="cursor-pointer rounded-xl border border-primary bg-primary px-3 py-2 text-sm text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              :disabled="isCreatingVirtual || newVirtualName.trim().length < 2"
              data-test="virtual-create"
            >
              {{ isCreatingVirtual ? 'Заводим…' : 'Завести' }}
            </button>
          </form>

          <p class="text-xs text-muted" data-test="virtual-hint">
            Эти люди появятся в «Походах → Участники», где их можно добавить в состав.
            Пол нужен распределению веса в рюкзаках.
          </p>

          <p class="text-xs text-muted" data-test="virtual-delete-hint">
            Удалить можно только до начала похода: у того, кто уже сходил, запись
            остаётся ради истории. При удалении на стадии подготовки человек уходит
            и из этих походов.
          </p>

          <p v-if="virtualError" class="text-sm text-red-600" data-test="virtual-error">
            {{ virtualError }}
          </p>

          <ul v-if="virtuals.length > 0" class="flex flex-col gap-2" data-test="virtual-list">
            <li
              v-for="person in virtuals"
              :key="person.id"
              class="flex items-center gap-2 rounded-xl border border-border bg-surface p-2"
              data-test="virtual-person"
            >
              <UserAvatar :src="null" :alt="person.displayName" :size="40" />
              <span class="min-w-0 flex-1 truncate text-sm text-text">{{ person.displayName }}</span>

              <span
                v-if="person.tripsCount > 0 && person.canDelete"
                class="shrink-0 text-xs text-muted"
                data-test="virtual-trips"
              >
                в походах: {{ person.tripsCount }}
              </span>

              <span
                v-if="!person.canDelete"
                class="text-xs text-muted"
                data-test="virtual-delete-blocked"
                :title="deleteBlockedReason(person)"
              >
                {{ deleteBlockedLabel() }}
              </span>
              <button
                v-else
                type="button"
                class="cursor-pointer rounded-lg border border-border bg-white px-2 py-1 text-xs transition-colors"
                :class="confirmingDeleteId === person.id
                  ? 'border-red-600 bg-red-600 text-white'
                  : 'text-muted hover:border-red-600 hover:text-red-600'"
                :aria-label="`Удалить «${person.displayName}»`"
                data-test="virtual-remove"
                @click="deletePerson(person)"
              >
                {{ confirmingDeleteId === person.id ? 'Точно?' : 'Удалить' }}
              </button>
            </li>
          </ul>

          <p v-else class="text-sm text-muted" data-test="virtual-empty">
            Пока никого. Заведите человека без аккаунта — он появится и в походах.
          </p>
        </div>
      </details>
    </template>
  </section>
</template>
