<script setup lang="ts">
import { computed, onUnmounted, ref, watch, watchEffect } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import { ApiError } from '@/api/errors'
import {
  fetchTripCacheState,
  fetchTripTabs,
  getTrip,
  listParticipants,
  setTripPresence,
  updateTrip,
} from '@/api/trips'
import { getPublicUser, type PublicUser } from '@/api/users'
import { isTripCacheable } from '@/offline/cacheable'
import { isFreshnessEqual, readCachedFreshness } from '@/offline/freshness'
import { prefetchTripCache, prefetchTripChats } from '@/offline/prefetch'
import { queuePresenceChange } from '@/offline/presenceOutbox'
import { useAuthStore } from '@/stores/auth'
import { useMobileMenuStore } from '@/stores/mobileMenu'
import { useOfflineStore } from '@/stores/offline'
import { applyPresence } from '@/utils/presence'
import GuestTripView from '@/views/trips/GuestTripView.vue'
import TripDiary from '@/views/trips/TripDiary.vue'
import TripFinance from '@/views/trips/TripFinance.vue'
import TripFirstAid from '@/views/trips/TripFirstAid.vue'
import TripGear from '@/views/trips/TripGear.vue'
import TripMeals from '@/views/trips/TripMeals.vue'
import TripParticipants from '@/views/trips/TripParticipants.vue'
import TripRoute from '@/views/trips/TripRoute.vue'
import TripTransfer from '@/views/trips/TripTransfer.vue'
import TripTabIcon from '@/components/trips/TripTabIcon.vue'
import {
  TRIP_TAB_LABELS,
  TRIP_VISIBILITY_LABELS,
  type PresenceAction,
  type Trip,
  type TripParticipant,
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
const offline = useOfflineStore()

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
 * «Выпуск» (код `sport`) приходит только у официального похода — это решает
 * бэкенд (`OFFICIAL_ONLY_TAB`), фронт видимость не досчитывает.
 *
 * Пока реализованы не все: неготовые показываются как «в разработке», чтобы
 * карта была видна целиком и не приходилось переставлять меню на каждой
 * новой вкладке (Ф7).
 */
/**
 * «Трансфер»: строки заброски, машины и пассажиры. Права на правку
 * (в том числе «свою машину водитель правит сам») считает бэкенд и отдаёт
 * в самой вкладке (`plan.canEdit` и `car.canEdit`) — матрицу ролей фронт
 * не повторяет.
 *
 * «Ночёвки» (код `route`) показывают чат табора: 29.10.2026 заказчик
 * переименовал вкладку и попросил её активировать, таблица ночёвок —
 * следующий шаг.
 *
 * «Дневник» открыт 16.11.2026: личные записи участника, работают офлайн
 * с очередью отправки. Права вкладки здесь ни при чём — каждый участник
 * пишет свой дневник, а роль фотографа останется для будущего альманаха.
 */
const IMPLEMENTED: TripTabCode[] = [
  'guest',
  'members',
  'meals',
  'transfer',
  'route',
  'gear',
  'firstAid',
  'finance',
  'diary',
]

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
  () =>
    offline.isOnline &&
    (permissions.value.find((permission) => permission.code === 'members')?.canEdit ?? false),
)

/** Править раскладку может завхоз или организатор: это же решает бэкенд. */
const canEditMeals = computed(
  () =>
    offline.isOnline &&
    (permissions.value.find((permission) => permission.code === 'meals')?.canEdit ?? false),
)

/**
 * «Снаряжение» правит тот, кому роль дала вкладку (завхоз, ремонтник,
 * организатор). Несущего при этом меняет любой участник — это решает
 * не эта страница, а сервер (`PATCH .../gear/:gearId`, §5).
 */
const canEditGear = computed(
  () =>
    offline.isOnline &&
    (permissions.value.find((permission) => permission.code === 'gear')?.canEdit ?? false),
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
 * Действия организатора в шапке.
 *
 * В офлайне их нет: правка и закрытие набора — изменения, а изменения
 * без связи не уходят. Показать кнопку, которая заведомо не сработает,
 * хуже, чем не показать её.
 */
const canOrganize = computed(() => isOrganizer.value && offline.isOnline)

/** Сохранённая на устройстве копия этого похода. */
const offlineCopy = computed(() =>
  trip.value ? offline.currentTripById(trip.value.id) : null,
)

/**
 * Есть ли копия похода (или она вот-вот появится).
 *
 * Считается не по «идёт сейчас»: группа, задержавшаяся в горах, должна
 * видеть, что копия у неё есть, даже когда по плану поход уже кончился.
 */
const hasOfflineCopy = computed(
  () => offlineCopy.value !== null || (trip.value !== null && isTripCacheable(trip.value)),
)

/** Когда поход сохраняли для офлайна: свежий прогрев важнее старой отметки. */
const prefetchedAt = ref<number | null>(null)

/**
 * Копию сверяли с сервером в этой сессии.
 *
 * Подпись «проверено сейчас» — это не украшение: без неё человек не знает,
 * устарела ли копия, которую он откроет в поле через день.
 */
const isFresh = ref(false)

/** Идёт сохранение копии — кнопка «Обновить» заблокирована. */
const isPrefetching = ref(false)

const savedAt = computed(() => prefetchedAt.value ?? offlineCopy.value?.cachedAt ?? null)

const savedText = computed(() => {
  if (savedAt.value === null) return 'ещё не сохраняли'

  return new Date(savedAt.value).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
})

/**
 * Сверить копию с сервером и, если данные разошлись, перечитать.
 *
 * Порядок именно такой: сначала отметка свежести, потом данные. Если
 * отметить копию раньше, чем прочитать содержимое, между двумя запросами
 * успеет пройти чужая правка, и копия навсегда сочтёт себя свежей.
 *
 * Счётчик содержимого не сдвинулся, а курсоры чатов — да: перечитываем
 * только чаты. Одно сообщение не повод дёргать все вкладки.
 *
 * Запускается тихо после загрузки страницы: человек открыл поход — данные
 * уже должны лежать на устройстве к моменту, когда связь пропадёт.
 * Ошибки прогрева не показываем — это фоновая работа, а не действие.
 */
async function prepareOfflineCopy(next: Trip) {
  if (!offline.isOnline) return

  try {
    await offline.rememberTrip(next)
    if (!isTripCacheable(next)) return

    // Отметка сервера нужна только для решения; сама по себе она не кешируется.
    const server = await fetchTripCacheState(next.id).catch(() => null)
    const cached = server ? await readCachedFreshness(next.id) : null

    const changed = server !== null && (cached === null || !isFreshnessEqual(cached, server))
    const chatsOnly = changed && cached?.contentRevision === server?.contentRevision

    if (chatsOnly) {
      await prefetchTripChats(next.id)
      prefetchedAt.value = Date.now()
      await offline.markSaved(next.id, prefetchedAt.value)
    } else {
      const at = await prefetchTripCache(next, changed)
      if (at === null) return

      prefetchedAt.value = at
      await offline.markSaved(next.id, at)
    }

    if (server !== null) isFresh.value = true
  } catch {
    // Прогрев — улучшение: не сохранилось, значит просто не будет офлайн-копии.
  }
}

/** Ручное «Обновить»: тот же прогрев, но без десятиминутного ограничения. */
async function refreshOfflineCopy() {
  if (!trip.value || !offline.isOnline) return

  isPrefetching.value = true
  try {
    const at = await prefetchTripCache(trip.value, true)
    if (at !== null) {
      prefetchedAt.value = at
      isFresh.value = true
      await offline.markSaved(trip.value.id, at)
    }
  } finally {
    isPrefetching.value = false
  }
}

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
        ? 'Поход не найден или закрыт для тебя'
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

  // Своя строка состава — для вопроса о присутствии. Тихо: не загрузилась,
  // значит вопроса не будет, а вкладки похода от него не зависят.
  myParticipant.value = null
  presenceDismissed.value = false
  if (trip.value && auth.user) {
    try {
      const people = await listParticipants(trip.value.id)
      myParticipant.value =
        people.find((person) => person.userId === auth.user?.id) ?? null
    } catch {
      // Тихо — по той же причине.
    }
  }

  // Поход открыт — сохраняем его копию для офлайна (если он идёт сейчас).
  if (trip.value) void prepareOfflineCopy(trip.value)
}

watch(
  () => route.params.id,
  (id) => {
    // Новый поход открывается на «Гостевой»: это его информация, одна
    // для всех. Вкладки прошлого похода к нему не относятся, а «Питание»
    // чужого похода показывать нечего.
    activeTab.value = 'guest'
    actionError.value = null
    prefetchedAt.value = null
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

// ───────────────────────────── присутствие (17.11.2026) ─────────────────────────────

/**
 * «Поход начался. Ты уже стартанул?» и «Ты вернулся?» — те самые вопросы
 * при входе, которые просил заказчик: связь в Прибайкалье появляется только
 * в населёнке, и человек возвращается в онлайн, уже вернувшись из леса.
 *
 * Вопросы не блокируют экран: это карточка над вкладками, её можно отложить
 * («Позже» / «Ещё на маршруте») — и она вернётся при следующем входе.
 * Ответ уходит на сервер; без связи кнопка честно скажет, что связи нет.
 *
 * Свою строку состава берём отдельным запросом: в ответе похода статуса
 * участия нет (решение 16.11.2026 — правило в DTO похода не выразить).
 * Не загрузилось — просто не показываем вопрос, вкладки от него не зависят.
 */
const myParticipant = ref<TripParticipant | null>(null)
const presenceDismissed = ref(false)
const isMarkingPresence = ref(false)

/** Отметка легла в очередь: связи нет, отправится, когда появится. */
const presenceQueued = ref(false)

/** Мой статус присутствия из строки состава. */
const myPresence = computed(() => myParticipant.value?.presenceStatus ?? 'none')

const hasStarted = computed(
  () => trip.value?.startsAt != null && new Date(trip.value.startsAt).getTime() <= Date.now(),
)

const hasFinished = computed(
  () => trip.value?.endsAt != null && new Date(trip.value.endsAt).getTime() < Date.now(),
)

/**
 * Какой вопрос задать: `start` — «уже стартанул?», `return` — «вернулся?».
 * `null` — вопрос не нужен: не иду, не начался, уже ответил или отложил.
 *
 * **Вопрос о возвращении — только со связью** (17.11.2026). Заказчик:
 * «для защиты от миссклика не отображать это в оффлайне. Нельзя отметить
 * возвращение без связи». Офлайн-отметка о старте остаётся: она не врёт
 * о возвращении, а «я на маршруте» группа ждёт ещё в поле.
 */
const presenceQuestion = computed<'start' | 'return' | null>(() => {
  if (presenceDismissed.value) return null
  if (myParticipant.value?.status !== 'going') return null
  if (!hasStarted.value) return null

  if (hasFinished.value) {
    if (!offline.isOnline) return null
    return myPresence.value === 'returned' ? null : 'return'
  }

  return myPresence.value === 'none' ? 'start' : null
})

/**
 * Иду, отметился «на маршруте» — в шапке висит кнопка «Я вернулся».
 * Без связи её нет: возвращение не отмечают офлайн.
 */
const showReturnButton = computed(
  () =>
    offline.isOnline &&
    myParticipant.value?.status === 'going' &&
    hasStarted.value &&
    !hasFinished.value &&
    myPresence.value === 'route',
)

async function markMyPresence(action: PresenceAction): Promise<void> {
  if (trip.value === null || myParticipant.value === null) return

  // Без связи возвращение не отмечаем вовсе: экран его не предлагает,
  // но защищаем и сам обработчик — кнопку могут вызвать и из другого места.
  if (action === 'returned' && !offline.isOnline) {
    actionError.value = 'Вернуться можно только со связью — отметь, когда появится сеть'
    return
  }

  isMarkingPresence.value = true
  actionError.value = null
  presenceQueued.value = false

  try {
    // Без связи в очередь ложится выход на маршрут: это не правка похода,
    // и ждать её не нужно — экран показывает результат сразу.
    if (!offline.isOnline) {
      const at = new Date().toISOString()
      await queuePresenceChange(trip.value.id, {
        userId: myParticipant.value.userId,
        status: action,
        at,
      })

      myParticipant.value = applyPresence(
        myParticipant.value,
        action,
        auth.user?.id ?? myParticipant.value.userId,
        at,
      )
      presenceQueued.value = true
      return
    }

    myParticipant.value = await setTripPresence(
      trip.value.id,
      myParticipant.value.userId,
      action,
    )
    presenceDismissed.value = false
  } catch (problem) {
    actionError.value =
      problem instanceof ApiError
        ? problem.message
        : 'Не удалось отметить присутствие'
  } finally {
    isMarkingPresence.value = false
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
              <template v-else-if="isOrganizer">Ты ведёшь этот поход</template>
            </p>
          </div>

          <div v-if="canOrganize" class="flex flex-wrap items-center gap-2">
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

        <!--
          Офлайн-копия похода. Строка честно говорит, сохранены ли данные
          на устройстве и когда их в последний раз сверяли с сервером:
          человек в поле должен знать, откроется ли поход, когда пропадёт
          связь, и насколько свежа будет эта копия.
        -->
        <p v-if="offline.isOffline" class="text-sm text-muted" data-test="trip-offline-note">
          Нет связи: поход открыт из сохранённой копии.
          <template v-if="savedAt"> Сохранено {{ savedText }}, могли быть изменения.</template>
          Изменения недоступны.
        </p>

        <p
          v-else-if="hasOfflineCopy"
          class="flex flex-wrap items-center gap-2 text-sm text-muted"
          data-test="trip-offline-status"
        >
          <span v-if="savedAt">Сохранён для офлайна: {{ savedText }}</span>
          <span v-else>Сохраняем для офлайна…</span>
          <span v-if="isFresh" class="text-muted" data-test="trip-offline-fresh">
            · проверено сейчас
          </span>

          <button
            type="button"
            class="cursor-pointer text-text underline transition-colors hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="isPrefetching"
            data-test="trip-offline-refresh"
            @click="refreshOfflineCopy"
          >
            {{ isPrefetching ? 'Сохраняем…' : 'Обновить' }}
          </button>
        </p>

        <p v-if="actionError" class="text-sm text-red-600" data-test="trip-action-error">
          {{ actionError }}
        </p>
      </header>

      <!--
        Присутствие (17.11.2026): «поход начался — ты стартанул?» и
        «ты вернулся?». Вопрос возвращается при каждом входе, пока человек
        не ответит: связь в Прибайкалье появляется только в населёнке,
        и «мы за него волнуемся» — слова заказчика. Отложить можно, но
        не забыть: на следующем входе карточка снова здесь.
      -->
      <div
        v-if="presenceQuestion"
        class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary bg-surface p-4"
        data-test="presence-question"
      >
        <div class="flex min-w-0 flex-col gap-1">
          <p class="text-sm font-medium text-text" data-test="presence-question-text">
            <template v-if="presenceQuestion === 'start'">
              Поход «{{ goalName }}» начался. Ты уже стартанул?
            </template>
            <template v-else>Ты вернулся из похода?</template>
          </p>
          <p class="text-xs text-muted">
            Это перекличка, а не факт похода: даты похода отметка не меняет.
          </p>
        </div>

        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="cursor-pointer rounded-xl border border-primary bg-primary px-3 py-1.5 text-sm text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            :disabled="isMarkingPresence"
            :data-test="presenceQuestion === 'start' ? 'presence-start' : 'presence-returned'"
            @click="markMyPresence(presenceQuestion === 'start' ? 'route' : 'returned')"
          >
            {{ presenceQuestion === 'start' ? 'Я на маршруте' : 'Я вернулся' }}
          </button>

          <button
            type="button"
            class="cursor-pointer rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-text transition-colors hover:border-primary disabled:opacity-50"
            :disabled="isMarkingPresence"
            data-test="presence-later"
            @click="presenceDismissed = true"
          >
            {{ presenceQuestion === 'start' ? 'Позже' : 'Ещё на маршруте' }}
          </button>
        </div>
      </div>

      <p
        v-else-if="showReturnButton"
        class="flex flex-wrap items-center gap-2 text-sm"
        data-test="presence-return-row"
      >
        <span class="text-muted">
          Ты на маршруте. Вернулся — отметь, чтобы группа знала.
        </span>
        <button
          type="button"
          class="cursor-pointer rounded-xl border border-border px-3 py-1.5 text-sm text-text transition-colors hover:border-primary disabled:opacity-50"
          :disabled="isMarkingPresence"
          data-test="presence-returned"
          @click="markMyPresence('returned')"
        >
          Я вернулся
        </button>
      </p>

      <p v-if="presenceQueued" class="text-xs text-muted" data-test="presence-queued">
        Нет связи: отметка уйдёт, когда появится сеть.
      </p>

      <!--
        Вкладки: на десктопе сверху. Раньше это были подчёркнутые слова,
        и заказчик 05.11.2026 сказал: «сделай кнопки закладок в виде
        закладок или кнопок, а то сливается с текстом». Теперь это
        сегментированная панель: у каждой вкладки рамка и фон, у активной —
        заливка темой.
      -->
      <nav
        class="hidden flex-wrap gap-1.5 rounded-2xl border border-border bg-surface p-1.5 md:flex"
        aria-label="Разделы похода"
      >
        <button
          v-for="item in displayTabs"
          :key="item.code"
          type="button"
          class="flex cursor-pointer items-center gap-1.5 rounded-xl border px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          :class="
            activeTab === item.code
              ? 'border-primary bg-primary font-medium text-white shadow-sm'
              : 'border-border bg-field text-text hover:border-primary hover:text-primary'
          "
          :disabled="!item.available"
          :aria-current="activeTab === item.code ? 'page' : undefined"
          :title="item.available ? undefined : 'Вкладка ещё не готова'"
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

      <TripRoute v-else-if="activeTab === 'route'" :trip="trip" />

      <TripGear v-else-if="activeTab === 'gear'" :trip="trip" :can-edit="canEditGear" />

      <TripFirstAid v-else-if="activeTab === 'firstAid'" :trip="trip" />

      <TripFinance v-else-if="activeTab === 'finance'" :trip-id="trip.id" />

      <TripDiary v-else-if="activeTab === 'diary'" :trip="trip" />

      <p v-else class="text-sm text-muted" data-test="tab-soon">
        Вкладка «{{ displayTabs.find((item) => item.code === activeTab)?.label }}» ещё не готова:
        сейчас работают «Гостевая», «Участники», «Ночёвки», «Питание», «Трансфер»,
        «Снаряжение», «Аптечка», «Бухгалтерия» и «Дневник».
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
