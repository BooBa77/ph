<script setup lang="ts">
import { computed, onUnmounted, ref, watch, watchEffect } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import { ApiError } from '@/api/errors'
import { subscribeTripEvents } from '@/api/events'
import {
  completeTrip,
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
import { formatRub } from '@/utils/money'
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

/**
 * Открыть вкладку из адреса: `?tab=transfer` (19.11.2026).
 *
 * Правка дат похода возвращает организатора не в «Гостевую», а в «Трансфер»:
 * рейсы уже сдвинуты, но билеты и заброски надо перепроверить, и человек
 * должен увидеть тревогу сразу (`useTransferDatesAlert`), а не искать вкладку
 * руками. Чужие и неготовые коды игнорируем: адрес — просьба, а не приказ.
 */
function applyRequestedTab(): void {
  const requested = route.query.tab
  if (typeof requested !== 'string') return

  const tab = displayTabs.value.find((item) => item.code === requested)
  if (tab && tab.available) activeTab.value = tab.code
}

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

/**
 * Править поход может организатор **и соорганизатор** (20.11.2026).
 *
 * Заказчик: «соорганизатор равен организатору во всём, отличий ровно
 * пять» ([lifecycle.md](../../../docs/ph/lifecycle.md) §4.5). Правка
 * похода и дат — не отличие, поэтому кнопки шапки у него те же. Роль
 * считаем по своей строке состава: сервер права вкладок уже отдал, но
 * именно этот флаг гасит действия, которых нет у рядового участника.
 */
const isOrganizer = computed(
  () => trip.value !== null && trip.value.organizerUserId === auth.user?.id,
)

/** Соорганизатор — по роли `coOrganizer` в своей строке состава. */
const isCoOrganizer = computed(() =>
  (myParticipant.value?.roles ?? []).some((role) => role.code === 'coOrganizer'),
)

/**
 * Действия организатора и соорганизатора в шапке.
 *
 * В офлайне их нет: правка и закрытие набора — изменения, а изменения
 * без связи не уходят. Показать кнопку, которая заведомо не сработает,
 * хуже, чем не показать её.
 *
 * После завершения похода (20.11.2026) их тоже нет: поход — история,
 * правка закрыта навсегда и даже автору. Кнопка на экране, которая
 * заведомо получит 409, — тот же обман. Это проверяет шаблон
 * (`canOrganize && !isCompleted`), а не сам флаг: он про роль и связь.
 */
const canOrganize = computed(
  () => (isOrganizer.value || isCoOrganizer.value) && offline.isOnline,
)

// ───────────────────────── завершение похода (20.11.2026) ─────────────────────────

/**
 * Завершён ли поход. `null` — не завершён; отметку ставит сервер и снять
 * её нельзя.
 */
const isCompleted = computed(() => Boolean(trip.value?.completedAt))

/** Можно ли завершить поход — флаг считает сервер (только автор и условия). */
const canComplete = computed(
  () => trip.value?.canComplete === true && !isCompleted.value,
)

/**
 * Ответ «Ещё остались правки» в этом входе.
 *
 * Вопрос повторяется при каждом входе, пока поход не завершён (заказчик),
 * а кнопка «Завершить поход» появляется в разделе после этого ответа.
 * Поэтому флаг живёт в памяти страницы, а не на сервере: сам ответ ничего
 * не меняет, и второй колонки в базе он не стоит.
 */
const completionDismissed = ref(false)
const isCompleting = ref(false)

/** Вопрос «Поход состоялся?» — один раз за вход, и только автору. */
const completionQuestion = computed(() => canComplete.value && !completionDismissed.value)

/**
 * «Да» на вопрос и кнопка «Завершить поход» — одно действие.
 *
 * Отмены нет (решение заказчика), поэтому ошибку показываем текстом,
 * а поход перечитываем ответом сервера: после завершения меню и шапка
 * должны сразу перестать предлагать правки.
 */
async function completeTripNow(): Promise<void> {
  if (!trip.value || !canComplete.value) return

  isCompleting.value = true
  actionError.value = null

  try {
    trip.value = await completeTrip(trip.value.id)
    completionDismissed.value = true

    /**
     * Права вкладок после завершения меняются, и их надо перечитать.
     * Без этого меню и вкладки остаются с прежними `canEdit` до перезахода:
     * у автора кнопки правки состава и «Редактировать» продолжали бы
     * рисоваться, а сервер отвечал бы на них 409.
     */
    permissions.value = await fetchTripTabs(trip.value.id)
  } catch (problem) {
    actionError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось завершить поход'
  } finally {
    isCompleting.value = false
  }
}

/** Сохранённая на устройстве копия этого похода. */
const offlineCopy = computed(() =>
  trip.value ? offline.currentTripById(trip.value.id) : null,
)

/** Когда поход сохраняли для офлайна: свежий прогрев важнее старой отметки. */
const prefetchedAt = ref<number | null>(null)

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
  } catch {
    // Прогрев — улучшение: не сохранилось, значит просто не будет офлайн-копии.
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

onUnmounted(() => {
  mobileMenu.clearContext()
  // Поток живёт, пока открыта страница похода: ушли — закрыли соединение.
  stopLive?.()
  stopLive = null
})

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

  // Когда вкладку просил адрес (`?tab=transfer` после правки дат), открываем
  // именно её — но только теперь, когда список доступного известен.
  applyRequestedTab()

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

  listenForTripChanges(id)
}

// ───────────────────────── свойства похода по SSE (19.11.2026) ─────────────────────────

/**
 * Живые свойства похода: даты, видимость, набор, залог.
 *
 * Заказчик: «по SSE не обновляются подписи свойства похода на всех
 * вкладках». Шапка — не вкладка, а рамка над ними, и своего потока у неё
 * не было: подписки жили только внутри вкладок и перечитывали свои данные.
 * Поэтому «1 декабря — 5 декабря» и «Залог участия» на второй вкладке
 * браузера оставались прежними до перезахода.
 *
 * Слушаем канал «Снаряжения» (`gear` по умолчанию): канал на бэкенде один
 * на поход, а `scope` в кадре говорит, чьё это изменение. Подписка нужна
 * только участнику — у гостя вкладок «Снаряжения» нет, и сервер ответил бы
 * `403`, а клиент переподключался бы в пустоту.
 */
let stopLive: (() => void) | null = null

/** Идёт перечитывание — второе событие подряд не гоняет второй запрос. */
let isRefreshingTrip = false

function listenForTripChanges(id: string) {
  stopLive?.()
  stopLive = null

  const isParticipant = isTripParticipant.value
  if (!isParticipant) return

  stopLive = subscribeTripEvents(id, (event) => {
    if (event.scope !== 'trip') return
    void refreshTrip()
  })
}

/**
 * Перечитать свойства похода.
 *
 * Своё действие тоже повод: у одного человека бывает две вкладки, и даты
 * чаще правят не в той, где открыта шапка. Пока идёт «Закрыть набор», своим
 * ответом уже занят `trip` — тогда не перечитываем, чтобы не перетереть
 * ответ более старым `GET`. И не подменяем поход, если за время запроса
 * открыли другой: `id` сверяем после ответа.
 */
async function refreshTrip(): Promise<void> {
  const current = trip.value
  if (current === null || isRefreshingTrip || isTogglingRecruitment.value) return

  isRefreshingTrip = true

  try {
    const fresh = await getTrip(current.id)
    if (trip.value?.id === fresh.id) trip.value = fresh
  } catch {
    // Тихо: живые подписи — удобство, а не данные, и красить шапку
    // в красное из-за них незачем.
  } finally {
    isRefreshingTrip = false
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
    prefetchedAt.value = null
    // «Вопрос при входе» возвращается на каждом входе в поход, а не на
    // каждое перечитывание страницы: после «Ещё остались правки» карточка
    // не должна всплывать заново из-за чужой правки состава.
    completionDismissed.value = false
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

/**
 * Человек в составе, а не гость.
 *
 * Своя строка состава грузится отдельным запросом и приходит позже вкладок;
 * чтобы «Залог участия» не мигал, считаем участником и по набору вкладок:
 * гостю бэкенд отдаёт только «Гостевую». С 22.11.2026 второй вкладки
 * у гостя нет: альманах — секция «Гостевой», а не отдельная вкладка.
 */
const isTripParticipant = computed(
  () =>
    myParticipant.value !== null ||
    permissions.value.some((permission) => permission.code !== 'guest'),
)
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

            <!--
              Бейдж соорганизатора (20.11.2026). Заказчик: «кто соорганизатор,
              видно бейджем „соорганизатор“ в „Участниках“ и в шапке похода».
              В шапке он про смотрящего: «этот поход ведёшь ты наравне
              с автором», и без него человек с правами организатора не
              понимал, почему у него есть кнопки правки.
            -->
            <span
              v-if="isCoOrganizer"
              class="self-start rounded-full border border-primary px-2 py-0.5 text-xs text-primary"
              data-test="trip-coorganizer-badge"
            >
              соорганизатор
            </span>

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

          <div v-if="canOrganize && !isCompleted" class="flex flex-wrap items-center gap-2">
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

          <!--
            «Завершить поход» (20.11.2026) появляется в разделе после ответа
            «Ещё остались правки»: вопрос при входе отложен, но решение
            осталось за автором. Кнопка — то же действие, что «Да».
          -->
          <div v-if="canComplete && completionDismissed" class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="cursor-pointer rounded-xl border border-primary bg-primary px-3 py-2 text-sm text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              :disabled="isCompleting || !offline.isOnline"
              data-test="complete-trip"
              @click="completeTripNow"
            >
              Завершить поход
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
          Поход завершён (20.11.2026): «закрыто всё и навсегда, даже админу;
          остаются „Дневник“ и „Бухгалтерия“». Вкладки видны — поход это
          история, её читают; закрыта только правка, и решает это сервер.
        -->
        <p
          v-if="isCompleted"
          class="rounded-2xl border border-border bg-surface px-3 py-2 text-sm text-text"
          data-test="trip-completed"
        >
          Поход завершён.
        </p>

        <!--
          Объявленный залог участия (18.11.2026). Раньше сумма жила только
          в секции «Бухгалтерии», а её видит организатор; рядовой участник
          не знал, что залог вообще объявлен. Здесь строка видна каждому
          участнику похода, в том числе на «Гостевой».
        -->
        <p
          v-if="isTripParticipant && trip.depositRub"
          class="text-sm text-muted"
          data-test="trip-deposit"
        >
          Залог участия: {{ formatRub(trip.depositRub) }} с человека
        </p>

        <!--
          Офлайн-копия похода. Пока связь есть, копия обновляется тихо:
          человеку в поле важно, откроется ли поход без связи, а не когда
          его сохраняли. Поэтому строка «Сохранён для офлайна… Обновить»
          убрана (19.11.2026), а прогрев и сверка работают как раньше —
          под капотом. В офлайне подпись остаётся: там она объясняет,
          почему данные могут быть неполными.
        -->
        <p v-if="offline.isOffline" class="text-sm text-muted" data-test="trip-offline-note">
          Нет связи: поход открыт из сохранённой копии.
          <template v-if="savedAt"> Сохранено {{ savedText }}, могли быть изменения.</template>
          Изменения недоступны.
        </p>

        <p v-if="actionError" class="text-sm text-red-600" data-test="trip-action-error">
          {{ actionError }}
        </p>
      </header>

      <!--
        Завершение похода (20.11.2026). Заказчик: «когда `ends_at` прошёл
        и все идущие отметили „вернулся“, организатору (только автору)
        приходит вопрос: „Все участники похода … благополучно вернулись.
        Поход состоялся?“». «Да» завершает поход навсегда, «Ещё остались
        правки» оставляет его открытым и возвращает вопрос при следующем
        входе. Условия и авторство проверяет сервер (`canComplete`).
      -->
      <div
        v-if="completionQuestion"
        class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary bg-surface p-4"
        data-test="completion-question"
      >
        <div class="flex min-w-0 flex-col gap-1">
          <p class="text-sm font-medium text-text" data-test="completion-question-text">
            Все участники похода «{{ goalName }}» благополучно вернулись. Поход состоялся?
          </p>
        </div>

        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="cursor-pointer rounded-xl border border-primary bg-primary px-3 py-1.5 text-sm text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            :disabled="isCompleting || !offline.isOnline"
            data-test="completion-yes"
            @click="completeTripNow"
          >
            Да
          </button>

          <button
            type="button"
            class="cursor-pointer rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-text transition-colors hover:border-primary disabled:opacity-50"
            :disabled="isCompleting"
            data-test="completion-later"
            @click="completionDismissed = true"
          >
            Ещё остались правки
          </button>
        </div>
      </div>

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
