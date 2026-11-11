<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'

import { ApiError } from '@/api/errors'
import {
  acceptFamilyUnion,
  addFamilyMember,
  cancelFamilyUnion,
  createVirtual,
  declineFamilyUnion,
  getFamilyUnionPreview,
  getMyFamily,
  leaveFamily,
  listMyVirtual,
  removeVirtual,
  searchUsers,
  type FamilyList,
  type FamilyMember,
  type FamilyUnion,
  type FamilyUnionPreview,
  type UserSearchResult,
  type VirtualUser,
} from '@/api/users'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import type { Gender } from '@/api/types'

/**
 * «Контакты» — родные и люди без аккаунта (10.11.2026, переделано
 * 11.11.2026 под заявку на объединение семей).
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
 * - **заявка — на две семьи целиком.** Новый родственник тянет всю свою
 *   компоненту связей, поэтому «Добавить родного» сначала показывает
 *   состав обеих семей и предупреждение «снаряжение станет общим»,
 *   а заявку подтверждает каждый участник в «Контактах». Свой человек
 *   без аккаунта становится родным сразу — подтверждать ему нечем;
 * - **разорвать одну связь нельзя:** «Выйти из семьи» рвёт все сразу
 *   (11.11.2026), а висящие заявки закрываются;
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

/**
 * Кого уже связали — чтобы поиск не предлагал добавить повторно.
 *
 * Берутся не только действующие родные, но и все участники висящих заявок:
 * «добавить» человека, который уже ждёт ответа в чужой заявке, — это второй
 * такой же запрос на тот же состав.
 */
const linkedIds = computed(() => {
  const ids = new Set<string>(family.value.family.map((member) => member.userId))

  for (const union of [...family.value.incoming, ...family.value.outgoing]) {
    for (const member of union.members) ids.add(member.userId)
  }

  return ids
})

/** Имена участников заявки: моя семья или присоединяющаяся. */
function unionNames(union: FamilyUnion, mine: boolean): string {
  const names = union.members
    .filter((member) => member.mine === mine)
    .map((member) => member.displayName)

  return names.length > 0 ? names.join(', ') : 'никого'
}

/** Кого ещё ждём: у заявки не бывает «согласны все» и висящей одновременно. */
function pendingNames(union: FamilyUnion): string {
  return union.members
    .filter((member) => member.consent === 'pending')
    .map((member) => member.displayName)
    .join(', ')
}

/** Плашка входящих заявок: количество с правильной формой слова. */
function incomingLabel(count: number): string {
  const last = count % 10
  const tens = count % 100

  if (last === 1 && tens !== 11) return `${count} заявка: ответьте`
  if (last >= 2 && last <= 4 && (tens < 12 || tens > 14)) {
    return `${count} заявки: ответьте`
  }

  return `${count} заявок: ответьте`
}

/**
 * Выход из семьи — **все** связи сразу (11.11.2026).
 *
 * Заказчик: «Выход из семьи — разрыв всех связей. `A` разрывает с `B` —
 * уходят все связи `A`, компонента распадается. Никаких полу-связей».
 * Поэтому крестика у отдельного родного больше нет: разорвать одну пару
 * изнутри компоненты нельзя, а «выбери A или B» — ровно тот вопрос,
 * который заказчик запретил.
 *
 * Каталог при выходе не чистится: клоны вещей остаются у каждого, просто
 * правки перестают зеркалиться. Об этом предупреждает блок под списком.
 */
const confirmingLeave = ref(false)

async function leaveFamilyAction(): Promise<void> {
  await runAction(
    () => leaveFamily(),
    'Вы вышли из семьи. Вещи остались у каждого своей копией',
    'Не удалось выйти из семьи',
  )
  confirmingLeave.value = false
}

/**
 * Ответ на заявку об объединении семей.
 *
 * Пока согласны не все, заявка остаётся висеть — и моё «принять» только
 * записывает согласие. Поэтому сообщение различает два исхода: «ждём
 * остальных» и «семьи объединены» (тогда и каталоги уже слиты).
 */
async function answerUnion(union: FamilyUnion, accept: boolean): Promise<void> {
  actionError.value = null
  notice.value = null

  try {
    if (accept) {
      const result = await acceptFamilyUnion(union.id)
      notice.value = result.status === 'accepted'
        ? 'Семьи объединены — снаряжение теперь общее'
        : 'Согласие записано — ждём остальных участников'
    } else {
      await declineFamilyUnion(union.id)
      notice.value = 'Заявка отклонена'
    }

    await loadFamily()
  } catch (problem) {
    actionError.value = errorText(
      problem,
      accept ? 'Не удалось принять заявку' : 'Не удалось отклонить заявку',
    )
  }
}

/** Отменить может только автор заявки — кнопка есть только у него. */
async function cancelUnion(union: FamilyUnion): Promise<void> {
  await runAction(
    () => cancelFamilyUnion(union.id),
    'Заявка отменена',
    'Не удалось отменить заявку',
  )
}

// ───────────────────────── добавление родного ─────────────────────────

const adding = ref(false)
const search = ref('')
const searchResults = ref<UserSearchResult[]>([])
const isSearching = ref(false)
const searchError = ref<string | null>(null)
const addingUserId = ref<string | null>(null)

/**
 * Что будет, если добавить выбранного человека.
 *
 * Показывается до создания заявки: «снаряжение станет общим» — не
 * формальность, а весь смысл объединения семей (заказчик: «инициатор
 * собирает обе компоненты; показывает список людей и предупреждение»).
 */
const preview = ref<FamilyUnionPreview | null>(null)

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
  preview.value = null

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

/** Имена в предпросмотре: моя семья или присоединяющаяся. */
function previewNames(mine: boolean): string {
  const names = (preview.value?.members ?? [])
    .filter((member) => member.mine === mine)
    .map((member) => member.displayName)

  return names.length > 0 ? names.join(', ') : 'никого'
}

/**
 * Нажали «Добавить»: свой человек без аккаунта — сразу родной, настоящий —
 * сначала предпросмотр состава обеих семей.
 */
async function requestAdd(
  person: UserSearchResult | VirtualUser,
  isVirtual: boolean,
): Promise<void> {
  if (addingUserId.value !== null) return

  actionError.value = null
  notice.value = null
  preview.value = null

  if (isVirtual) {
    await addPerson(person.id)
    return
  }

  addingUserId.value = person.id

  try {
    preview.value = await getFamilyUnionPreview(person.id)
  } catch (problem) {
    actionError.value = errorText(problem, 'Не удалось подготовить заявку')
  } finally {
    addingUserId.value = null
  }
}

/** «Отправить заявку»: сервер сам соберёт состав и спросит остальных. */
async function confirmAdd(): Promise<void> {
  const target = preview.value
  if (target === null || addingUserId.value !== null) return

  addingUserId.value = target.targetUserId
  actionError.value = null

  try {
    const result = await addFamilyMember(target.targetUserId)
    await loadFamily()

    preview.value = null
    search.value = ''
    searchResults.value = []
    notice.value = result.status === 'accepted'
      ? 'Родной добавлен'
      : 'Заявка отправлена — её должен подтвердить каждый участник'
  } catch (problem) {
    actionError.value = errorText(problem, 'Не удалось добавить родного')
  } finally {
    addingUserId.value = null
  }
}

function cancelPreview(): void {
  preview.value = null
  actionError.value = null
}

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
        : 'Заявка отправлена — её должен подтвердить каждый участник'

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
              {{ incomingLabel(family.incoming.length) }}
            </span>
          </span>
        </summary>

        <div class="flex flex-col gap-3 rounded-xl border border-border bg-white p-3">
          <!-- Входящие заявки — первыми: это действие человека, а не список. -->
          <div v-if="family.incoming.length > 0" class="flex flex-col gap-2" data-test="family-incoming">
            <h3 class="text-sm font-medium text-text">Хотят объединить семьи</h3>

            <div
              v-for="union in family.incoming"
              :key="union.id"
              class="flex flex-col gap-2 rounded-xl border border-border bg-surface p-2"
              data-test="family-incoming-item"
            >
              <p class="text-sm text-text">
                «{{ union.initiatorName }}» предлагает объединить семьи
              </p>

              <p class="text-xs text-muted" data-test="family-union-mine">
                Ваша семья: {{ unionNames(union, true) }}
              </p>
              <p class="text-xs text-muted" data-test="family-union-theirs">
                Другая семья: {{ unionNames(union, false) }}
              </p>
              <p class="text-xs text-muted" data-test="family-union-warning">
                После согласия всех снаряжение станет общим: у каждого появится копия
                вещей другой семьи.
              </p>
              <p
                v-if="pendingNames(union)"
                class="text-xs text-muted"
                data-test="family-union-waiting"
              >
                Ждём ответа: {{ pendingNames(union) }}
              </p>

              <div class="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  class="cursor-pointer rounded-lg border border-primary bg-primary px-2 py-1 text-xs text-white transition-opacity hover:opacity-90"
                  data-test="family-accept"
                  @click="answerUnion(union, true)"
                >
                  Принять
                </button>
                <button
                  type="button"
                  class="cursor-pointer rounded-lg border border-border bg-white px-2 py-1 text-xs text-muted transition-colors hover:border-primary hover:text-text"
                  data-test="family-decline"
                  @click="answerUnion(union, false)"
                >
                  Отклонить
                </button>
              </div>
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

            <template v-if="preview === null">
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
                      @click="requestAdd(person, false)"
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
                    @click="requestAdd(person, true)"
                  >
                    Добавить
                  </button>
                </div>
              </div>
            </template>

            <!--
              Снаряжение станет общим — это весь смысл объединения, поэтому
              состав обеих семей показывается до создания заявки.
            -->
            <div
              v-else
              class="flex flex-col gap-2 rounded-xl border border-orange-300 bg-orange-50 p-3"
              data-test="family-union-preview"
            >
              <h3 class="text-sm font-medium text-text">
                Объединить семьи с «{{ preview.targetName }}»?
              </h3>

              <p class="text-xs text-muted" data-test="family-union-preview-mine">
                Ваша семья: {{ previewNames(true) }}
              </p>
              <p class="text-xs text-muted" data-test="family-union-preview-theirs">
                Другая семья: {{ previewNames(false) }}
              </p>
              <p class="text-xs text-muted" data-test="family-union-preview-warning">
                Снаряжение станет общим: у каждого появится копия вещей другой семьи.
                Заявку должен подтвердить каждый участник — она будет видна в «Контактах».
              </p>
              <p
                v-if="preview.pending"
                class="text-xs text-muted"
                data-test="family-union-preview-pending"
              >
                Такая заявка уже висит — ваше согласие будет зачтено.
              </p>

              <div class="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  class="cursor-pointer rounded-xl border border-primary bg-primary px-3 py-1.5 text-sm text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                  :disabled="addingUserId !== null"
                  data-test="family-union-confirm"
                  @click="confirmAdd"
                >
                  Отправить заявку
                </button>
                <button
                  type="button"
                  class="cursor-pointer rounded-xl border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:text-text"
                  data-test="family-union-cancel"
                  @click="cancelPreview"
                >
                  Отмена
                </button>
              </div>
            </div>
          </div>

          <!-- Исходящие заявки: ждут ответа остальных участников. -->
          <div v-if="family.outgoing.length > 0" class="flex flex-col gap-2" data-test="family-outgoing">
            <h3 class="text-sm font-medium text-text">Ждут подтверждения</h3>

            <div
              v-for="union in family.outgoing"
              :key="union.id"
              class="flex flex-col gap-2 rounded-xl border border-dashed border-border p-2"
              data-test="family-outgoing-item"
            >
              <p class="text-sm text-muted">
                Другая семья: {{ unionNames(union, false) }}
              </p>
              <p
                v-if="pendingNames(union)"
                class="text-xs text-muted"
                data-test="family-union-waiting"
              >
                Ждут ответа: {{ pendingNames(union) }}
              </p>

              <button
                v-if="union.isInitiator"
                type="button"
                class="w-fit cursor-pointer rounded-lg border border-border bg-white px-2 py-1 text-xs text-muted transition-colors hover:border-primary hover:text-text"
                data-test="family-cancel"
                @click="cancelUnion(union)"
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
            </li>
          </ul>

          <p
            v-else-if="family.family.length === 0"
            class="text-sm text-muted"
            data-test="family-empty"
          >
            Пока никого. Добавьте родного по имени — заявку подтвердят все участники
            обеих семей, и вы увидите друг друга.
          </p>
          <p v-else class="text-sm text-muted" data-test="family-filter-empty">
            По этому имени никого нет.
          </p>

          <!-- Выход из семьи: одна кнопка на все связи, а не крестик у родного. -->
          <div
            v-if="family.family.length > 0"
            class="mt-3 rounded-xl border border-border bg-surface p-3"
            data-test="family-leave-block"
          >
            <p class="text-xs text-muted">
              Выйти из семьи — значит разорвать все семейные связи сразу: общий бюджет
              и общее снаряжение прекращаются. Вещи остаются у каждого своей копией,
              их не удаляют.
            </p>

            <div v-if="confirmingLeave" class="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                class="cursor-pointer rounded-xl border border-red-600 bg-red-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                data-test="family-leave-confirm"
                @click="leaveFamilyAction"
              >
                Точно выйти
              </button>
              <button
                type="button"
                class="cursor-pointer rounded-xl border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:text-text"
                data-test="family-leave-cancel"
                @click="confirmingLeave = false"
              >
                Нет
              </button>
            </div>
            <button
              v-else
              type="button"
              class="mt-2 cursor-pointer rounded-xl border border-red-600 px-3 py-1.5 text-sm text-red-600 transition-colors hover:bg-red-600 hover:text-white"
              data-test="family-leave"
              @click="confirmingLeave = true"
            >
              Выйти из семьи
            </button>
          </div>
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
