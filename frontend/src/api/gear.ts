import { apiFetch } from '@/api/client'
import type { GearAttributePayload } from '@/utils/gearAttributes'
import type {
  GearGroup,
  GearGroupList,
  GearItem,
  GearList,
  TripGearItem,
  TripGearList,
  TripGearLoad,
  TripGearRouteSection,
  TripGearSection,
  TripGearSectionScope,
  TripGearStatus,
} from '@/types/gear'

/**
 * Личное снаряжение: каталог предметов с весом.
 *
 * Как и календарь, работает «от токена»: владельца в теле запроса нет,
 * предмет всегда принадлежит тому, кто его создал.
 *
 * **Тип вместо вида (Stage B, 30.10.2026).** В теле запроса — `typeId`
 * из справочника (`GET /api/gear-types`), значения характеристик — картой
 * «код характеристики → значение». Вида (`kind`) нет ни в запросе, ни
 * в ответе: прослойка перехода удалена 30.10.2026 вместе с экранами,
 * которые читали вид, — с этого шага тип единственный.
 */

/**
 * GET /api/gear — мои предметы и итог по весу.
 *
 * `tripId` — каталог открыт для выбора в походе (11.11.2026, шаг 2): тогда
 * ответ несёт `busyGear`, и в выборе появляется подсказка «занята в „…“».
 * Обычный каталог про походы ничего не знает.
 */
export async function listGear(tripId?: string): Promise<GearList> {
  const query = tripId === undefined ? '' : `?tripId=${encodeURIComponent(tripId)}`

  return apiFetch<GearList>(`/gear${query}`)
}

/**
 * GET /api/gear-groups — мои группы с типами (02.11.2026).
 *
 * Группы личные: сервер при первом обращении заводит копии рекомендуемых
 * и раскладывает по ним типы. В ответе у каждой группы — её типы, поэтому
 * настройщику группировки не нужен отдельный запрос.
 */
export async function fetchGearGroups(): Promise<GearGroup[]> {
  const list = await apiFetch<GearGroupList>('/gear-groups')

  return list.items
}

/**
 * POST /api/gear-groups — своя группа.
 *
 * Встаёт перед «Прочим»: заказчик выбрал, что «Прочее» — последнее.
 * Ответ — список целиком, как у остальных правок групп.
 */
export async function createGearGroup(input: {
  name: string
  sortOrder?: number
}): Promise<GearGroup[]> {
  const list = await apiFetch<GearGroupList>('/gear-groups', {
    method: 'POST',
    body: JSON.stringify(input),
  })

  return list.items
}

/** PATCH /api/gear-groups/:id — имя и порядок. «Прочее» порядок не меняет. */
export async function updateGearGroup(
  id: number,
  patch: { name?: string; sortOrder?: number },
): Promise<GearGroup[]> {
  const list = await apiFetch<GearGroupList>(`/gear-groups/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })

  return list.items
}

/**
 * DELETE /api/gear-groups/:id — удалить группу, её типы уедут в «Прочее».
 *
 * «Прочее» так удалить нельзя — сервер ответит 409.
 */
export async function deleteGearGroup(id: number): Promise<GearGroup[]> {
  const list = await apiFetch<GearGroupList>(`/gear-groups/${id}`, {
    method: 'DELETE',
  })

  return list.items
}

/** POST /api/gear-groups/:id/move — переставить группу ↑/↓. */
export async function moveGearGroup(
  id: number,
  direction: 'up' | 'down',
): Promise<GearGroup[]> {
  const list = await apiFetch<GearGroupList>(`/gear-groups/${id}/move`, {
    method: 'POST',
    body: JSON.stringify({ direction }),
  })

  return list.items
}

/** POST /api/gear-groups/:id/types — переложить тип в эту группу. */
export async function assignGearGroupType(
  groupId: number,
  typeId: number,
): Promise<GearGroup[]> {
  const list = await apiFetch<GearGroupList>(
    `/gear-groups/${groupId}/types`,
    {
      method: 'POST',
      body: JSON.stringify({ typeId }),
    },
  )

  return list.items
}

/**
 * POST /api/gear — новый предмет. Вес и характеристики можно не указывать.
 *
 * `attributes` — карта «код → значение», а не список пар: код уникален
 * внутри типа, и карта не даёт прислать одну характеристику дважды.
 * `null` — «значение не задано»: строка в базе не заводится.
 */
export async function createGearItem(body: {
  typeId: number
  title: string
  weightGrams?: number | null
  note?: string | null
  location?: string | null
  attributes?: GearAttributePayload
}): Promise<GearItem> {
  return apiFetch<GearItem>('/gear', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/**
 * PATCH /api/gear/:id — правка предмета.
 *
 * `weightGrams: null` — осознанно стереть вес («взвешу позже»), поэтому
 * тип поля допускает `null`, а не только число. Так же ведёт себя
 * `attributes`: `null` в значении — стереть характеристику.
 *
 * **Смена типа стирает значения прежнего типа** — это делает сервер,
 * и это единственное поведение, при котором «вместимость палатки» не живёт
 * у топора. Отдельного поля «очистить значения» нет.
 */
export async function updateGearItem(
  id: string,
  patch: {
    typeId?: number
    title?: string
    weightGrams?: number | null
    note?: string | null
    location?: string | null
    attributes?: GearAttributePayload
  },
): Promise<GearItem> {
  return apiFetch<GearItem>(`/gear/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

/**
 * POST /api/gear/:id/move — переставить вещь выше или ниже в её группе.
 *
 * Через границу группы стрелка не переставляет: порядок групп человек
 * настраивает отдельно (`moveGearGroup`), а соседи внутри — вещи всех типов,
 * которые сложены в одну группу. Ответ — список целиком: после перестановки
 * изменились две строки, и клиенту не нужно угадывать вторую.
 */
export async function moveGearItem(
  id: string,
  direction: 'up' | 'down',
): Promise<GearList> {
  return apiFetch<GearList>(`/gear/${id}/move`, {
    method: 'POST',
    body: JSON.stringify({ direction }),
  })
}

/** DELETE /api/gear/:id */
export async function deleteGearItem(id: string): Promise<void> {
  await apiFetch<void>(`/gear/${id}`, { method: 'DELETE' })
}

// ───────────────────── снаряжение похода (вкладка «Снаряжение» и ночёвки) ─────────────────────

/**
 * GET /api/trips/:id/gear — вещи похода.
 *
 * Видят участники. Секция «Палатки» берёт отсюда палатки: плашка палатки —
 * это вещь из снаряжения похода, а не текст, набранный в ночёвках.
 */
export async function listTripGear(tripId: string): Promise<TripGearList> {
  return apiFetch<TripGearList>(`/trips/${tripId}/gear`)
}

/**
 * POST /api/trips/:id/gear — предложить свою вещь в поход.
 *
 * Владельца в теле нет: он тот, кто прислал запрос. Предложить можно только
 * предмет из своего каталога, поэтому `gearItemId` берётся из `listGear`.
 * Ручка существовала и до ночёвок — это то же действие, что «взять палатку
 * в поход» на вкладке «Снаряжение».
 */
export async function proposeTripGear(
  tripId: string,
  gearItemId: string,
  routeSection?: TripGearRouteSection,
): Promise<TripGearItem> {
  const body: { gearItemId: number; routeSection?: TripGearRouteSection } = {
    gearItemId: Number(gearItemId),
  }

  // Секцию присылает только «Добавить ещё» (01.11.2026): обычная вещь
  // показывается по типу, и пометка ей не нужна.
  if (routeSection !== undefined) body.routeSection = routeSection

  return apiFetch<TripGearItem>(`/trips/${tripId}/gear`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/**
 * Тело `POST /api/trips/:id/gear/manual` — вещь, заведённая в походе вручную.
 *
 * Второй путь снаряжения (31.10.2026), слова заказчика: «При добавлении
 * снаряги нужен пункт „Указать вручную“». Любой участник заводит себе
 * одноразовую вещь («бутылка бензина на розжиг»); организатор может
 * указать хозяином человека без аккаунта.
 *
 * - `title` необязателен: пусто — сервер подпишет вещь именем типа;
 * - `ownerUserId` не указан — хозяин я; чужому настоящему участнику вещь
 *   не добавляют (403), виртуальному этого похода — можно;
 * - `addToCatalog` — «добавить в список для регулярного использования»:
 *   у настоящего хозяина заводит вещь ещё и в его каталоге, у виртуального
 *   каталога нет и `true` при нём — 400.
 */
export interface AddManualTripGearRequest {
  typeId: number
  attributes?: GearAttributePayload
  title?: string | null
  weightGrams?: number | null
  ownerUserId?: string | null
  addToCatalog?: boolean
  /** Секция «Добавить ещё»: где вещь покажет себя в «Ночёвках». */
  routeSection?: TripGearRouteSection
}

/** POST /api/trips/:id/gear/manual — вещь «вручную» → строка похода. */
export async function addManualTripGear(
  tripId: string,
  body: AddManualTripGearRequest,
): Promise<TripGearItem> {
  return apiFetch<TripGearItem>(`/trips/${tripId}/gear/manual`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/**
 * Тело `PATCH /api/trips/:id/gear/:gearId` — «берём / не берём» и несущий.
 *
 * Два поля — два разных права (решение заказчика 21.10.2026): статус меняет
 * тот, кто ведёт снаряжение (роль даёт вкладку), а несущего может поменять
 * **любой участник** — перетаскивание вещи между рюкзаками он разрешил всем.
 * `assignedUserId: null` освобождает вещь: «нераспределённая» — законное
 * состояние, а не потерянная.
 */
export interface UpdateTripGearRequest {
  status?: TripGearStatus
  assignedUserId?: string | null
  /** Общественный раздел «Берём»; `null` — вернуть в корень. */
  sharedSectionId?: string | null
  /** Мой личный раздел «Взял»; `null` — вернуть в корень. */
  personalSectionId?: string | null
}

/** PATCH /api/trips/:id/gear/:gearId — статус, несущий и/или раздел. */
export async function updateTripGear(
  tripId: string,
  gearId: string,
  body: UpdateTripGearRequest,
): Promise<TripGearItem> {
  return apiFetch<TripGearItem>(`/trips/${tripId}/gear/${gearId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      ...body,
      // В API разделы — числа; фронт держит id строками, как у всего
      // bigint. `null` — осознанный корень, а не «поле не прислали».
      ...(body.sharedSectionId !== undefined
        ? {
            sharedSectionId:
              body.sharedSectionId === null ? null : Number(body.sharedSectionId),
          }
        : {}),
      ...(body.personalSectionId !== undefined
        ? {
            personalSectionId:
              body.personalSectionId === null ? null : Number(body.personalSectionId),
          }
        : {}),
    }),
  })
}

/**
 * POST /api/trips/:id/gear/personal — своя вещь в раздел «Взял» (06.11.2026).
 *
 * Заказчик: «Личные вещи — это то, что помимо общественного: одежда, каска,
 * трекинговые палочки», и у раздела нужны кнопки «Добавить снаряжение
 * в этот раздел». Вещь обязательно из своего каталога, `gearItemId` —
 * строка, как у каталога; `sectionId` не указан — корень «Взял».
 */
export async function addPersonalTripGear(
  tripId: string,
  body: { gearItemId: string; sectionId?: string | null },
): Promise<TripGearItem> {
  return apiFetch<TripGearItem>(`/trips/${tripId}/gear/personal`, {
    method: 'POST',
    body: JSON.stringify({
      gearItemId: Number(body.gearItemId),
      ...(body.sectionId !== undefined
        ? { sectionId: body.sectionId === null ? null : Number(body.sectionId) }
        : {}),
    }),
  })
}

/**
 * PATCH /api/trips/:id/gear/personal/:personalId — перенос между разделами
 * «Взял». Путь для телефона, где HTML5-drag не работает.
 */
export async function updatePersonalTripGear(
  tripId: string,
  personalId: string,
  body: { sectionId: string | null },
): Promise<TripGearItem> {
  return apiFetch<TripGearItem>(`/trips/${tripId}/gear/personal/${personalId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      sectionId: body.sectionId === null ? null : Number(body.sectionId),
    }),
  })
}

/** DELETE .../gear/personal/:personalId — убрать свою личную вещь. */
export async function removePersonalTripGear(
  tripId: string,
  personalId: string,
): Promise<void> {
  await apiFetch<void>(`/trips/${tripId}/gear/personal/${personalId}`, {
    method: 'DELETE',
  })
}

/**
 * PATCH /api/trips/:id/gear/packages/:packageId — кто несёт пакет еды
 * (06.11.2026). Назначает **любой участник**, как и несущего вещи;
 * `null` — снять назначение. Питающемуся отдельно общий пакет сервер
 * не отдаст: его рюкзак в раскладке еды не участвует.
 */
export async function assignTripGearPackage(
  tripId: string,
  packageId: string,
  assignedUserId: string | null,
): Promise<TripGearLoad> {
  return apiFetch<TripGearLoad>(`/trips/${tripId}/gear/packages/${packageId}`, {
    method: 'PATCH',
    body: JSON.stringify({ assignedUserId }),
  })
}

/**
 * GET /api/trips/:id/gear/load — раскладка груза по рюкзакам (06.11.2026).
 *
 * Один ответ на чтение и на кнопку: вещи похода и пакеты «Питания» уже
 * взвешены и разложены, экран не считает доли и веса сам. В `personal` —
 * свои вещи «Взял», «Спальника» и своя еда для отдельной секции «Личное».
 */
export async function getTripGearLoad(tripId: string): Promise<TripGearLoad> {
  return apiFetch<TripGearLoad>(`/trips/${tripId}/gear/load`)
}

/**
 * POST /api/trips/:id/gear/auto-distribute — «Автоматически распределить
 * груз» (06.11.2026).
 *
 * Полный сброс прежних назначений и раскладка заново: своё — владельцу,
 * тяжёлое вперёд, остаток и пакеты — самому свободному, аптечка — медику.
 * Право — у того, кому роль дала вкладку «Снаряжение»; ответ — та же
 * раскладка. Экран после вызова перечитывает `GET /gear`, чтобы пилюли
 * в «Распределении» и «Берём» взяли новые `assignedUserId`.
 */
export async function autoDistributeTripGear(
  tripId: string,
): Promise<TripGearLoad> {
  return apiFetch<TripGearLoad>(`/trips/${tripId}/gear/auto-distribute`, {
    method: 'POST',
  })
}

/**
 * POST /api/trips/:id/gear/sections — новый раздел (05.11.2026).
 *
 * `scope` выбирает большую секцию: `shared` — «Берём», `personal` — «Взял».
 * Общественный раздел создаёт тот, кому дали вкладку; личный — любой
 * участник, и владельцем становится он сам. `parentId` — вложенность.
 */
export async function createTripGearSection(
  tripId: string,
  body: { scope: TripGearSectionScope; title: string; parentId?: string | null },
): Promise<TripGearSection> {
  return apiFetch<TripGearSection>(`/trips/${tripId}/gear/sections`, {
    method: 'POST',
    body: JSON.stringify({
      scope: body.scope,
      title: body.title,
      ...(body.parentId !== undefined
        ? { parentId: body.parentId === null ? null : Number(body.parentId) }
        : {}),
    }),
  })
}

/** PATCH /api/trips/:id/gear/sections/:sectionId — имя, порядок, родитель. */
export async function updateTripGearSection(
  tripId: string,
  sectionId: string,
  patch: { title?: string; sortOrder?: number; parentId?: string | null },
): Promise<TripGearSection> {
  return apiFetch<TripGearSection>(
    `/trips/${tripId}/gear/sections/${sectionId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        ...patch,
        ...(patch.parentId !== undefined
          ? { parentId: patch.parentId === null ? null : Number(patch.parentId) }
          : {}),
      }),
    },
  )
}

/** DELETE /api/trips/:id/gear/sections/:sectionId — вещи остаются в корне. */
export async function removeTripGearSection(
  tripId: string,
  sectionId: string,
): Promise<void> {
  await apiFetch<void>(`/trips/${tripId}/gear/sections/${sectionId}`, {
    method: 'DELETE',
  })
}

/**
 * DELETE /api/trips/:id/gear/:gearId — убрать вещь из похода (31.10.2026).
 *
 * Крестики в «Палатках» и «Костровом» раньше жили в памяти: ручки не было,
 * и после перезагрузки убранная вещь возвращалась. Теперь это настоящая
 * строка `trip_gear`: владелец убирает свою вещь, тот, кто ведёт снаряжение
 * (организатор, завхоз), — любую. Одноразовая вещь уходит вместе со строкой,
 * вещь из каталога остаётся у владельца — из похода уходит только решение
 * её взять.
 *
 * Права проверяет сервер: чужая вещь без права на вкладку «Снаряжение» —
 * 403, и текст ошибки показывается на экране.
 */
export async function removeTripGear(
  tripId: string,
  gearId: string,
): Promise<void> {
  await apiFetch<void>(`/trips/${tripId}/gear/${gearId}`, { method: 'DELETE' })
}
