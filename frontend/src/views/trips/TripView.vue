<script setup lang="ts">
import { computed, onUnmounted, ref, watch, watchEffect } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import { ApiError } from '@/api/errors'
import { fetchTripTabs, getTrip, updateTrip } from '@/api/trips'
import { getPublicUser, type PublicUser } from '@/api/users'
import { useAuthStore } from '@/stores/auth'
import { useMobileMenuStore } from '@/stores/mobileMenu'
import GuestTripView from '@/views/trips/GuestTripView.vue'
import TripMeals from '@/views/trips/TripMeals.vue'
import TripParticipants from '@/views/trips/TripParticipants.vue'
import TripTransfer from '@/views/trips/TripTransfer.vue'
import TripTabIcon from '@/components/trips/TripTabIcon.vue'
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
 * **Вкладки сверху на десктопе и в панели на телефоне.** Так решил
 * заказчик 26.10.2026: нижняя полоса с десятью вкладками занимала три ряда
 * и закрывала содержимое (замер: 157 px полосы против 80 px отступа).
 * На телефоне вкладки открываются кнопкой «Разделы похода» рядом с
 * заголовком раздела, а гамбургер в шапке остаётся меню сайта.
 * Сами вкладки уходят в `MobileMenu` через стор, потому что кнопка
 * и страница — соседние ветки дерева.
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
const mobileMenu = useMobileMenuStore()

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
/**
 * «Трансфер»: строки заброски, машины и пассажиры. Права на правку
 * (в том числе «свою машину водитель правит сам») считает бэкенд и отдаёт
 * в самой вкладке (`plan.canEdit` и `car.canEdit`) — матрицу ролей фронт
 * не повторяет.
 */
const IMPLEMENTED: TripTabCode[] = ['guest', 'members', 'meals', 'transfer']

const permissions = ref<TripTabPermission[]>([])
const activeTab = ref<TripTabCode>('guest')

/**
 * Что показать в меню: только то, что вернул бэкенд. Своего списка
 * у фронта нет — иначе права и видимость разошлись бы с сервером.
 */
const displayTabs = computed<{ code: TripTabCode; label: string; available: boolean }[]>(() =>
  permissions.value.map((permission) => ({
    code: permission.code,
    label: TRIP_TAB_LABELS[permission.code],
    available: IMPLEMENTED.includes(permission.code),
  })),
)

/** Править «Участников» — значит назначать роли: разбирает бэкенд по ролям. */
const canManageRoles = computed(
  () => permissions.value.find((permission) => permission.code === 'members')?.canEdit ?? false,
)

/** Править раскладку может завхоз или организатор: это же решает бэкенд. */
const canEditMeals = computed(
  () => permissions.value.find((permission) => permission.code === 'meals')?.canEdit ?? false,
)

/**
 * «Трансфер» правят организатор, соорганизатор и водитель (роль `driver`
 * получает вкладку сидом `seed-role-tabs`). Свою машину водитель правит
 * и без права на вкладку — это решает бэкенд, экран лишь не рисует то,
 * что заведомо не сработает. Поэтому отдельного флага страница не считает:
 * вкладка спрашивает права у своего ответа.
 */

/** Править поход может только организатор. */
const isOrganizer = computed(
  () => trip.value !== null && trip.value.organizerUserId === auth.user?.id,
)

/**
 * Вкладки — в мобильную панель похода.
 *
 * Сама панель открывается кнопкой рядом с заголовком раздела (`TripsView`),
 * а список вкладок знает эта страница: права и доступность приходят
 * с сервера. Поэтому страница кладёт свой контекст в стор
 * (`useMobileMenuStore`), а панель его показывает — кнопка и страница
 * про вкладки ничего друг о друге не знают.
 *
 * `watchEffect` пересобирает список сам: пришли права, переключилась
 * вкладка — подсветка в панели обязана совпасть с содержимым. Уходя со
 * страницы, контекст снимаем: иначе кнопка «Разделы похода» осталась бы
 * на «Моих походах» и открыла бы вкладки покинутого похода.
 */
watchEffect(() => {
  if (!trip.value) return

  mobileMenu.setContext({
    title: 'Разделы похода',
    items: displayTabs.value.map((item) => ({
      key: item.code,
      label: item.label,
      icon: item.code,
      iconSet: 'trip',
      available: item.available,
      active: activeTab.value === item.code,
      onSelect: () => {
        activeTab.value = item.code
      },
    })),
  })
})

onUnmounted(() => mobileMenu.clearContext())

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
  <main class="flex flex-col gap-4">
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
          class="-mb-px flex cursor-pointer items-center gap-1.5 border-b-2 bg-transparent px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50"
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
          <span class="h-4 w-4 shrink-0"><TripTabIcon :name="item.code" /></span>
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

      <TripMeals
        v-else-if="activeTab === 'meals'"
        :trip="trip"
        :can-edit="canEditMeals"
      />

      <TripTransfer v-else-if="activeTab === 'transfer'" :trip="trip" />

      <p v-else class="text-sm text-muted" data-test="tab-soon">
        Вкладка «{{ displayTabs.find((item) => item.code === activeTab)?.label }}» появится вместе
        с Ф7: сейчас готовы «Гостевая», «Участники», «Питание» и «Трансфер».
      </p>

      <!--
        Нижней полосы вкладок здесь больше нет (26.10.2026). Десять вкладок
        в сетке по четыре давали три ряда высотой 157 px и закрывали 53 px
        содержимого у низа страницы, а подписи у всех десяти читались как
        список, а не как переключатель. Теперь на телефоне вкладки открывает
        гамбургер в шапке — той же кнопкой, что и разделы сайта на остальных
        страницах.
      -->
    </template>
  </main>
</template>
