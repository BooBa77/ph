<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import { ApiError } from '@/api/errors'
import { fetchTripTabs, getTrip, updateTrip } from '@/api/trips'
import { getPublicUser, type PublicUser } from '@/api/users'
import { useAuthStore } from '@/stores/auth'
import GuestTripView from '@/views/trips/GuestTripView.vue'
import TripChats from '@/views/trips/TripChats.vue'
import TripParticipants from '@/views/trips/TripParticipants.vue'
import {
  TRIP_TAB_LABELS,
  TRIP_VISIBILITY_LABELS,
  type Trip,
  type TripTabCode,
  type TripTabPermission,
} from '@/types/trips'
import { tripWhenText } from '@/utils/tripDisplay'

/**
 * Страница похода: общая рамка и вкладки.
 *
 * **Вкладки сверху на десктопе и снизу на телефоне.** Это не украшение:
 * вверху в мобильном браузере вкладки конкурируют с адресной строкой,
 * а большой палец до верхнего края не дотягивается. Внизу — то место, где
 * вкладки живут в мобильных приложениях.
 *
 * Вкладки переключаются **внутренним состоянием, а не адресом**: страница
 * остаётся одним экраном, поход грузится один раз, переход между вкладками
 * мгновенный. Когда вкладок станет много и понадобятся ссылки на конкретную,
 * их переведут в адрес — это отдельный шаг.
 *
 * **Организатору видны свои действия**: правка похода и закрытие набора.
 * Это не защита — решает бэкенд и отвечает 403, — а честность интерфейса:
 * кнопка, которая заведомо не сработает, хуже её отсутствия.
 */
const route = useRoute()
const auth = useAuthStore()

const trip = ref<Trip | null>(null)
const isLoading = ref(true)
const error = ref<string | null>(null)
const actionError = ref<string | null>(null)
const isTogglingRecruitment = ref(false)

/**
 * Организатор — отдельным запросом за публичным профилем.
 *
 * В ответе похода есть только `organizerUserId`: имени и аватарки там нет,
 * потому что лента из двадцати карточек стоить двадцати запросов не должна.
 * Здесь поход один, и одна ссылка «кто ведёт» стоит одного запроса.
 * Не загрузилось — просто не показываем имя: вкладки похода от этого
 * не зависят.
 */
const organizer = ref<PublicUser | null>(null)

/**
 * Вкладки похода.
 *
 * Список и права приходят с бэкенда (`GET /api/trips/:id/tabs`): видят
 * вкладки **все участники** (решение заказчика 21.10.2026), а `canEdit`
 * отвечает на вопрос «кто ведёт» — роль завхоза даёт правку «Питания»,
 * организатор правит всё. Гостю приходит одна «Гостевая».
 *
 * Пока реализованы не все одиннадцать: неготовые показываются как
 * «в разработке», чтобы карта была видна целиком и не приходилось
 * переставлять меню на каждой новой вкладке (Ф7).
 */
const TAB_CHATS = 'chats'
type Tab = TripTabCode | typeof TAB_CHATS

/** Вкладки, у которых уже есть экран. Порядок — порядок в меню. */
const IMPLEMENTED: TripTabCode[] = ['guest', 'members']

const permissions = ref<TripTabPermission[]>([])
const activeTab = ref<Tab>('guest')

/**
 * Что показать в меню. «Чаты» — исключение: в карте вкладок это часть
 * «Участников», но экран у нас отдельный и работает, поэтому он стоит
 * рядом, а не прячется. У мечты его нет: мечта — вишлист, у неё только
 * «Гостевая» и ни членского чата, ни подготовки (`tabs.md` §7).
 */
const displayTabs = computed<{ code: Tab; label: string; available: boolean }[]>(() => {
  const list = permissions.value.map((permission) => ({
    code: permission.code as Tab,
    label: TRIP_TAB_LABELS[permission.code],
    available: IMPLEMENTED.includes(permission.code),
  }))

  if (trip.value?.status === 'idea') return list

  const afterMembers = list.findIndex((item) => item.code === 'members')
  const chats = { code: TAB_CHATS as Tab, label: 'Чаты', available: true }

  return afterMembers === -1
    ? [...list, chats]
    : [...list.slice(0, afterMembers + 1), chats, ...list.slice(afterMembers + 1)]
})

/** Править «Участников» — значит назначать роли: разбирает бэкенд по ролям. */
const canManageRoles = computed(
  () => permissions.value.find((permission) => permission.code === 'members')?.canEdit ?? false,
)

/** Править поход может только организатор. */
const isOrganizer = computed(
  () => trip.value !== null && trip.value.organizerUserId === auth.user?.id,
)

async function load(id: string) {
  isLoading.value = true
  error.value = null

  try {
    trip.value = await getTrip(id)
  } catch (problem) {
    // 404 приходит и на несуществующий поход, и на закрытый чужой: разница
    // намеренно неразличима, чтобы по коду ответа нельзя было узнать
    // о существовании приватного похода.
    error.value =
      problem instanceof ApiError && problem.status === 404
        ? 'Поход не найден или закрыт для вас'
        : 'Не удалось загрузить поход'
    trip.value = null
  } finally {
    isLoading.value = false
  }

  // Вкладки: список и права считает бэкенд. Не загрузились — показываем
  // базовый набор, чтобы страница не осталась без меню вовсе.
  try {
    permissions.value = await fetchTripTabs(id)
  } catch {
    permissions.value = [
      { code: 'guest', canEdit: false },
      { code: 'members', canEdit: false },
    ]
  }

  // Организатор — после похода и необязательной частью: без него страница
  // показывается, а «кто ведёт» просто не появляется.
  organizer.value = null
  if (trip.value && trip.value.organizerUserId !== auth.user?.id) {
    try {
      organizer.value = await getPublicUser(trip.value.organizerUserId)
    } catch {
      // Тихо: профиль организатора — украшение шапки, а не данные похода.
    }
  }
}

watch(
  () => route.params.id,
  (id) => {
    // Новый поход открывается на «Гостевой»: это его информация, одна
    // для всех. Вкладки прошлого похода к нему не относятся, а «Питание»
    // чужого похода показывать нечего.
    activeTab.value = 'guest'
    actionError.value = null
    if (typeof id === 'string') void load(id)
  },
  { immediate: true },
)

/** Имя похода — это цель. Анонс идёт подписью. */
const goalName = computed(() => trip.value?.goalObject?.name ?? 'Поход')

/**
 * Когда: у решённого — даты, у мечты и плана — готовность.
 *
 * Форматирование живёт в `utils/tripDisplay.ts`: то же самое показывает
 * карточка ленты, и третья копия этих строк разошлась бы с ними.
 */
const whenText = computed(() => (trip.value ? tripWhenText(trip.value) : ''))

/**
 * Закрыть или открыть набор.
 *
 * Отдельная кнопка, а не поле в форме правки: набор закрывают в тот момент,
 * когда он закрылся, — и для этого не хочется уходить на другой экран
 * и заполнять форму целиком. Патч ровно с одним полем, остальное не трогаем.
 */
async function toggleRecruitment() {
  if (!trip.value) return

  isTogglingRecruitment.value = true
  actionError.value = null

  try {
    trip.value = await updateTrip(trip.value.id, {
      isRecruitmentClosed: !trip.value.isRecruitmentClosed,
    })
  } catch (problem) {
    actionError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось изменить набор'
  } finally {
    isTogglingRecruitment.value = false
  }
}
</script>

<template>
  <main class="flex flex-col gap-4 pb-20 md:pb-0">
    <p v-if="isLoading" class="text-muted">Загружаем поход…</p>

    <p v-else-if="error" class="text-muted" data-test="trip-error">
      {{ error }}
    </p>

    <template v-else-if="trip">
      <!-- Шапка: имя похода — цель, а не анонс -->
      <header class="flex flex-col gap-3">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div class="flex flex-col gap-1">
            <h1 class="text-2xl font-bold text-text" data-test="trip-name">
              {{ goalName }}
            </h1>

            <p v-if="trip.announcement" class="text-sm text-text">
              {{ trip.announcement }}
            </p>

            <!-- Кто ведёт: имя ведёт в публичный профиль. У себя — просто
                 подпись, ссылка на самого себя в шапке не нужна -->
            <p class="text-sm text-muted" data-test="trip-organizer">
              <template v-if="organizer">
                Ведёт:
                <RouterLink
                  :to="{ name: 'person', params: { id: organizer.id } }"
                  class="text-text underline transition-colors hover:text-primary"
                  data-test="trip-organizer-link"
                >
                  {{ organizer.displayName }}
                </RouterLink>
              </template>
              <template v-else-if="isOrganizer">Вы ведёте этот поход</template>
            </p>
          </div>

          <div v-if="isOrganizer" class="flex flex-wrap items-center gap-2">
            <RouterLink
              :to="{ name: 'trip-edit', params: { id: trip.id } }"
              class="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text no-underline transition-colors hover:border-primary"
              data-test="trip-edit-link"
            >
              Редактировать
            </RouterLink>

            <button
              type="button"
              class="cursor-pointer rounded-xl border border-border bg-field px-3 py-2 text-sm text-text transition-colors hover:border-primary disabled:opacity-60"
              :disabled="isTogglingRecruitment"
              data-test="toggle-recruitment"
              @click="toggleRecruitment"
            >
              {{ trip.isRecruitmentClosed ? 'Открыть набор' : 'Закрыть набор' }}
            </button>
          </div>
        </div>

        <p class="text-sm text-muted" data-test="trip-when">
          {{ whenText }} · {{ TRIP_VISIBILITY_LABELS[trip.visibility] }}
          <template v-if="trip.isCommercial"> · коммерческий</template>
          <template v-if="trip.isOfficial"> · официальный поход</template>
          <template v-if="trip.isRecruitmentClosed"> · набор закрыт</template>
        </p>

        <p v-if="actionError" class="text-sm text-red-600" data-test="trip-action-error">
          {{ actionError }}
        </p>
      </header>

      <!-- Вкладки: на десктопе сверху, в строку с переносом -->
      <nav class="hidden flex-wrap gap-1 border-b border-border md:flex" aria-label="Разделы похода">
        <button
          v-for="item in displayTabs"
          :key="item.code"
          type="button"
          class="-mb-px cursor-pointer border-b-2 bg-transparent px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          :class="
            activeTab === item.code
              ? 'border-primary font-medium text-primary'
              : 'border-transparent text-muted hover:text-text'
          "
          :disabled="!item.available"
          :title="item.available ? undefined : 'Вкладка появится вместе с Ф7'"
          :data-test="`tab-${item.code}`"
          @click="activeTab = item.code"
        >
          {{ item.label }}
        </button>
      </nav>

      <GuestTripView v-if="activeTab === 'guest'" :trip-id="trip.id" />

      <TripParticipants
        v-else-if="activeTab === 'members'"
        :trip="trip"
        :can-manage-roles="canManageRoles"
        @changed="load(trip.id)"
      />

      <TripChats v-else-if="activeTab === 'chats'" :trip="trip" />

      <p v-else class="text-sm text-muted" data-test="tab-soon">
        Вкладка «{{ displayTabs.find((item) => item.code === activeTab)?.label }}» появится вместе
        с Ф7: сейчас готовы «Гостевая» и «Участники».
      </p>

      <!-- Вкладки: на телефоне снизу, под большим пальцем. Перенос строк —
           единственный способ уложить десять вкладок на узком экране -->
      <nav
        class="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-border bg-surface md:hidden"
        aria-label="Разделы похода"
      >
        <button
          v-for="item in displayTabs"
          :key="item.code"
          type="button"
          class="flex cursor-pointer items-center justify-center border-t-2 bg-transparent px-1 py-2 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          :class="
            activeTab === item.code
              ? 'border-primary font-medium text-primary'
              : 'border-transparent text-muted'
          "
          :disabled="!item.available"
          :data-test="`tab-mobile-${item.code}`"
          @click="activeTab = item.code"
        >
          {{ item.label }}
        </button>
      </nav>
    </template>
  </main>
</template>
