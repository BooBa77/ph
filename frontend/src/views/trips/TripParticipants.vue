<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'

import { ApiError } from '@/api/errors'
import {
  acceptRequest,
  createRequest,
  deleteRequest,
  fetchRoles,
  listParticipants,
  listRequests,
  removeParticipant,
  setMyStatus,
  setParticipantRoles,
} from '@/api/trips'
import { searchUsers, type UserSearchResult } from '@/api/users'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import { useAuthStore } from '@/stores/auth'
import {
  PARTICIPANT_STATUS_LABELS,
  type ParticipantStatus,
  type RoleOption,
  type Trip,
  type TripParticipant,
  type TripRequest,
} from '@/types/trips'

/**
 * Вкладка «Участники»: состав, роли и тикеты — приглашения и заявки.
 *
 * **Один экран, а не два.** Заявки и состав — про одно и то же: кто идёт
 * и кто просится. Разнести их по вкладкам значило бы заставлять
 * организатора ходить между экранами, чтобы решить, кого брать.
 *
 * **Что видит человек, зависит от его роли в походе**, и это не украшение:
 * участнику незачем кнопка «убрать», а постороннему — список чужих заявок
 * (его и не отдаёт бэкенд). Права решает сервер; интерфейс лишь не
 * показывает то, что заведомо не сработает.
 *
 * **Роли назначает организатор** (и соорганизатор — по праву на вкладку;
 * это решает бэкенд, сюда приходит `canManageRoles`). Сами участники
 * ролями не управляют даже своими: роль — обязательство перед походом,
 * а не нашивка (решение заказчика 21.10.2026).
 *
 * Все действия перезагружают список целиком: состав и тикеты связаны
 * (приглашение сразу добавляет человека в состав), и собирать новое
 * состояние из ответов вручную — верный способ показать неправду.
 */
const props = withDefaults(
  defineProps<{
    trip: Trip
    /** Может ли смотрящий назначать роли: считает бэкенд по правам вкладки. */
    canManageRoles?: boolean
  }>(),
  { canManageRoles: false },
)

const emit = defineEmits<{ changed: [] }>()

const auth = useAuthStore()

/**
 * Свои варианты участия. «Не иду» подписано словами, а не статусом:
 * `declined` в кнопке читалось бы как системный код.
 */
const MY_STATUSES: ParticipantStatus[] = ['going', 'maybe', 'declined']

const participants = ref<TripParticipant[]>([])
const requests = ref<TripRequest[]>([])
const isLoading = ref(true)
const error = ref<string | null>(null)
const actionError = ref<string | null>(null)
const pendingUserId = ref<string | null>(null)

const isOrganizer = computed(() => props.trip.organizerUserId === auth.user?.id)

const me = computed(
  () => participants.value.find((person) => person.userId === auth.user?.id) ?? null,
)

/** Моя заявка, если я её подавал и она ещё висит. */
const myRequest = computed(
  () => requests.value.find((request) => request.userId === auth.user?.id) ?? null,
)

/** Заявки — организатору: их он и решает. */
const applications = computed(() => requests.value.filter((item) => item.direction === 'apply'))

/** Отправленные приглашения — видно только организатору. */
const invitations = computed(() => requests.value.filter((item) => item.direction === 'invite'))

const canApply = computed(
  () => !isOrganizer.value && me.value === null && myRequest.value === null,
)

/**
 * Назначение ролей.
 *
 * Справочник грузим при открытии диалога, а не при входе на вкладку:
 * большинству участников он не нужен, а лишний запрос на каждое открытие
 * состава — это лишний запрос на каждый поход.
 */
const roleOptions = ref<RoleOption[]>([])
const rolesTarget = ref<TripParticipant | null>(null)
const selectedRoleCodes = ref<string[]>([])
const isSavingRoles = ref(false)

async function openRoles(person: TripParticipant) {
  rolesTarget.value = person
  selectedRoleCodes.value = person.roles.map((role) => role.code)
  actionError.value = null

  if (roleOptions.value.length > 0) return

  try {
    roleOptions.value = await fetchRoles()
  } catch {
    actionError.value = 'Не удалось загрузить справочник ролей'
  }
}

function toggleRole(code: string) {
  selectedRoleCodes.value = selectedRoleCodes.value.includes(code)
    ? selectedRoleCodes.value.filter((value) => value !== code)
    : [...selectedRoleCodes.value, code]
}

async function saveRoles() {
  if (!rolesTarget.value || isSavingRoles.value) return

  isSavingRoles.value = true
  actionError.value = null

  try {
    await setParticipantRoles(
      props.trip.id,
      rolesTarget.value.userId,
      selectedRoleCodes.value,
    )
    rolesTarget.value = null
    // Роли меняют права: перечитываем состав и вкладки, а не собираем
    // новое состояние из ответа — прав у нас в ответе нет.
    emit('changed')
  } catch (cause) {
    actionError.value =
      cause instanceof ApiError ? cause.message : 'Не удалось сохранить роли'
  } finally {
    isSavingRoles.value = false
  }
}

async function load() {
  isLoading.value = true
  error.value = null

  try {
    const [people, tickets] = await Promise.all([
      listParticipants(props.trip.id),
      listRequests(props.trip.id),
    ])
    participants.value = people
    requests.value = tickets
  } catch {
    error.value = 'Не удалось загрузить состав'
  } finally {
    isLoading.value = false
  }
}

watch(() => props.trip.id, load, { immediate: true })

/** Общая обёртка: один запрос, одна ошибка, одна перезагрузка после. */
async function act(userId: string | null, action: () => Promise<unknown>) {
  pendingUserId.value = userId
  actionError.value = null

  try {
    await action()
    await load()
    emit('changed')
  } catch (problem) {
    actionError.value =
      problem instanceof ApiError ? problem.message : 'Не получилось — попробуйте ещё раз'
  } finally {
    pendingUserId.value = null
  }
}

const changeMyStatus = (status: ParticipantStatus) =>
  act(auth.user?.id ?? null, () => setMyStatus(props.trip.id, status))

const accept = (userId: string, status: 'going' | 'maybe') =>
  act(userId, () => acceptRequest(props.trip.id, userId, status))

const closeTicket = (userId: string) => act(userId, () => deleteRequest(props.trip.id, userId))

const apply = () => act(auth.user?.id ?? null, () => createRequest(props.trip.id, { direction: 'apply' }))

const remove = (userId: string) => act(userId, () => removeParticipant(props.trip.id, userId))

// ─── Приглашение: поиск человека по имени ───

const SEARCH_DELAY_MS = 300

const query = ref('')
const found = ref<UserSearchResult[]>([])
const isSearching = ref(false)

let searchTimer: ReturnType<typeof setTimeout> | undefined

/**
 * Уже приглашённых в подсказках не показываем: пригласить дважды нельзя
 * (бэкенд ответит 409), и предлагать заведомо неудачное действие незачем.
 */
const candidates = computed(() =>
  found.value.filter(
    (person) =>
      !participants.value.some((participant) => participant.userId === person.id) &&
      !requests.value.some((request) => request.userId === person.id),
  ),
)

async function search() {
  const text = query.value.trim()

  if (text.length < 2) {
    found.value = []
    return
  }

  isSearching.value = true
  try {
    found.value = await searchUsers(text)
  } catch {
    found.value = []
  } finally {
    isSearching.value = false
  }
}

watch(query, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(search, SEARCH_DELAY_MS)
})

onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer)
})

function invite(person: UserSearchResult) {
  void act(person.id, async () => {
    await createRequest(props.trip.id, { direction: 'invite', userId: person.id })
    query.value = ''
    found.value = []
  })
}
</script>

<template>
  <section class="flex flex-col gap-4">
    <p v-if="isLoading" class="text-muted" data-test="participants-loading">Загружаем состав…</p>

    <p v-else-if="error" class="text-muted" data-test="participants-error">{{ error }}</p>

    <template v-else>
      <p v-if="actionError" class="text-sm text-red-600" data-test="participants-action-error">
        {{ actionError }}
      </p>

      <!-- Мой статус. Приглашённому сначала нужно ответить на приглашение -->
      <div
        v-if="me && !isOrganizer && me.status !== 'invited'"
        class="flex flex-col gap-2"
        data-test="my-status"
      >
        <span class="text-sm text-muted">Иду ли я</span>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="value in MY_STATUSES"
            :key="value"
            type="button"
            class="cursor-pointer rounded-xl border px-3 py-2 text-sm transition-colors disabled:opacity-60"
            :class="
              me.status === value
                ? 'border-primary font-medium text-primary'
                : 'border-border bg-field text-text hover:border-primary'
            "
            :disabled="pendingUserId !== null"
            :data-test="`my-status-${value}`"
            @click="changeMyStatus(value)"
          >
            {{ value === 'declined' ? 'Не иду' : PARTICIPANT_STATUS_LABELS[value] }}
          </button>
        </div>
      </div>

      <!-- Заявка постороннего -->
      <div v-else-if="canApply" class="flex flex-col gap-2">
        <button
          v-if="!trip.isRecruitmentClosed"
          type="button"
          class="cursor-pointer self-start rounded-xl border border-primary bg-primary px-4 py-2 text-sm text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          :disabled="pendingUserId !== null"
          data-test="apply"
          @click="apply"
        >
          Хочу с вами
        </button>
        <p v-else class="text-sm text-muted" data-test="recruitment-closed">
          Набор закрыт — заявки не принимаются.
        </p>
      </div>

      <!-- Моя заявка ждёт решения -->
      <div
        v-else-if="myRequest"
        class="flex flex-wrap items-center gap-3 text-sm text-muted"
        data-test="my-request"
      >
        <span>Заявка отправлена, ждём ответа организатора.</span>
        <button
          type="button"
          class="cursor-pointer border-0 bg-transparent p-0 text-sm text-muted underline transition-colors hover:text-text disabled:opacity-60"
          :disabled="pendingUserId !== null"
          data-test="withdraw-apply"
          @click="closeTicket(myRequest.userId)"
        >
          Отозвать
        </button>
      </div>

      <!-- Заявки: решает организатор -->
      <div v-if="isOrganizer && applications.length > 0" class="flex flex-col gap-2">
        <h3 class="text-sm text-muted">Заявки</h3>

        <ul class="flex flex-col gap-2" data-test="applications">
          <li
            v-for="request in applications"
            :key="request.userId"
            class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3"
          >
            <span class="flex items-center gap-2 text-sm text-text">
              <UserAvatar :src="request.avatarUrl" :alt="request.displayName" :size="32" />
              {{ request.displayName }}
            </span>

            <span class="flex flex-wrap gap-2">
              <button
                type="button"
                class="cursor-pointer rounded-xl border border-primary bg-primary px-3 py-1.5 text-sm text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                :disabled="pendingUserId !== null"
                :data-test="`accept-${request.userId}`"
                @click="accept(request.userId, 'going')"
              >
                Принять
              </button>
              <button
                type="button"
                class="cursor-pointer rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-text transition-colors hover:border-primary disabled:opacity-60"
                :disabled="pendingUserId !== null"
                :data-test="`reject-${request.userId}`"
                @click="closeTicket(request.userId)"
              >
                Отклонить
              </button>
            </span>
          </li>
        </ul>
      </div>

      <!-- Приглашения, которые ещё висят -->
      <div v-if="isOrganizer && invitations.length > 0" class="flex flex-col gap-2">
        <h3 class="text-sm text-muted">Ждём ответа на приглашения</h3>

        <ul class="flex flex-col gap-2" data-test="invitations">
          <li
            v-for="request in invitations"
            :key="request.userId"
            class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3"
          >
            <span class="flex items-center gap-2 text-sm text-muted">
              <UserAvatar :src="request.avatarUrl" :alt="request.displayName" :size="32" />
              {{ request.displayName }}
            </span>

            <button
              type="button"
              class="cursor-pointer rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-text transition-colors hover:border-primary disabled:opacity-60"
              :disabled="pendingUserId !== null"
              :data-test="`revoke-${request.userId}`"
              @click="closeTicket(request.userId)"
            >
              Отозвать приглашение
            </button>
          </li>
        </ul>
      </div>

      <!-- Приглашение: поиск человека -->
      <div v-if="isOrganizer" class="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
        <h3 class="text-sm text-muted">Пригласить</h3>

        <input
          v-model="query"
          type="search"
          placeholder="Начните вводить имя — от двух букв"
          class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none"
          data-test="invite-search"
        />

        <p v-if="isSearching" class="text-sm text-muted">Ищем…</p>

        <ul v-else-if="candidates.length > 0" class="flex flex-col" data-test="invite-candidates">
          <li v-for="person in candidates" :key="person.id">
            <button
              type="button"
              class="w-full cursor-pointer rounded-xl px-3 py-2 text-left text-sm text-text transition-colors hover:bg-bg disabled:opacity-60"
              :disabled="pendingUserId !== null"
              data-test="invite-candidate"
              @click="invite(person)"
            >
              {{ person.displayName }}
            </button>
          </li>
        </ul>

        <p
          v-else-if="query.trim().length >= 2 && !isSearching"
          class="text-sm text-muted"
          data-test="invite-nothing"
        >
          Никого не нашлось.
        </p>
      </div>

      <!-- Отправленное приглашение себе: приглашённый видит свои кнопки -->
      <div
        v-if="me && me.status === 'invited'"
        class="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-3"
        data-test="my-invitation"
      >
        <span class="text-sm text-text">Вас пригласили в поход.</span>
        <button
          type="button"
          class="cursor-pointer rounded-xl border border-primary bg-primary px-3 py-1.5 text-sm text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          :disabled="pendingUserId !== null"
          data-test="accept-invite"
          @click="accept(auth.user?.id ?? '', 'going')"
        >
          Иду
        </button>
        <button
          type="button"
          class="cursor-pointer rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-text transition-colors hover:border-primary disabled:opacity-60"
          :disabled="pendingUserId !== null"
          data-test="decline-invite"
          @click="closeTicket(auth.user?.id ?? '')"
        >
          Не пойду
        </button>
      </div>

      <!-- Состав -->
      <div class="flex flex-col gap-2">
        <h3 class="text-sm text-muted">Состав: {{ participants.length }}</h3>

        <ul class="flex flex-col gap-2" data-test="participants-list">
          <li
            v-for="person in participants"
            :key="person.userId"
            class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3"
            data-test="participant"
          >
            <span class="flex min-w-0 items-center gap-2">
              <UserAvatar :src="person.avatarUrl" :alt="person.displayName" :size="32" />

              <span class="flex min-w-0 flex-col">
                <span class="flex flex-wrap items-center gap-1 text-sm text-text">
                  <span data-test="participant-name">{{ person.displayName }}</span>

                  <!-- Роли — рядом с именем: «кто здесь завхоз» ищут по списку,
                       а не в подписи мелким шрифтом -->
                  <span
                    v-for="role in person.roles"
                    :key="role.code"
                    class="rounded-full border border-border px-2 py-0.5 text-xs text-muted"
                    data-test="participant-role"
                  >
                    {{ role.name }}
                  </span>
                </span>

                <span class="text-xs text-muted">
                  {{ PARTICIPANT_STATUS_LABELS[person.status] }}
                  <template v-if="person.isOrganizer"> · организатор похода</template>
                </span>
              </span>
            </span>

            <div class="flex flex-wrap items-center gap-2">
              <button
                v-if="canManageRoles"
                type="button"
                class="cursor-pointer rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-text transition-colors hover:border-primary disabled:opacity-60"
                :disabled="pendingUserId !== null"
                :data-test="`roles-${person.userId}`"
                @click="openRoles(person)"
              >
                Роли
              </button>

              <button
                v-if="isOrganizer && !person.isOrganizer"
                type="button"
                class="cursor-pointer rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-text transition-colors hover:border-primary disabled:opacity-60"
                :disabled="pendingUserId !== null"
                :data-test="`remove-${person.userId}`"
                @click="remove(person.userId)"
              >
                Убрать
              </button>
            </div>
          </li>
        </ul>
      </div>
    </template>

    <!-- Роли: диалог поверх вкладки. Роли назначает организатор (или
         соорганизатор — по праву на вкладку), сами участники ими
         не управляют -->
    <div
      v-if="rolesTarget"
      class="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4"
      data-test="roles-dialog"
    >
      <div class="w-full max-w-sm rounded-xl border border-border bg-surface p-4">
        <h3 class="mb-1 text-base font-medium text-text">
          Роли: {{ rolesTarget.displayName }}
        </h3>
        <p class="mb-3 text-xs text-muted">
          Роль открывает правку своих вкладок. Видят вкладки все участники.
        </p>

        <ul class="mb-4 flex flex-col gap-1">
          <li v-for="role in roleOptions" :key="role.code">
            <label class="flex cursor-pointer items-center gap-2 text-sm text-text">
              <input
                type="checkbox"
                class="h-4 w-4 cursor-pointer accent-[var(--theme-primary)]"
                :checked="selectedRoleCodes.includes(role.code)"
                :disabled="role.code === 'organizer'"
                :data-test="`role-option-${role.code}`"
                @change="toggleRole(role.code)"
              />
              {{ role.name }}
              <span v-if="role.code === 'organizer'" class="text-xs text-muted">
                — автор похода, не назначается
              </span>
            </label>
          </li>
        </ul>

        <p v-if="actionError" class="mb-2 text-sm text-red-600" data-test="roles-error">
          {{ actionError }}
        </p>

        <div class="flex justify-end gap-2">
          <button
            type="button"
            class="cursor-pointer rounded-xl border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:text-text"
            data-test="roles-cancel"
            @click="rolesTarget = null"
          >
            Отмена
          </button>
          <button
            type="button"
            :disabled="isSavingRoles"
            class="cursor-pointer rounded-xl border border-primary bg-primary px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            data-test="roles-save"
            @click="saveRoles"
          >
            {{ isSavingRoles ? 'Сохраняем…' : 'Сохранить' }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
