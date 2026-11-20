import { ConflictException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import type { Trip } from '../trips/entities/trip.entity';

/**
 * Запросы по ключу физической вещи — `gear_uid` (11.11.2026, шаг 2).
 *
 * Каталог живёт клонами: у каждого родного своя строка `gear_items`, и только
 * `gear_uid` говорит, что это **одна и та же** палатка. Значит, все правила
 * «вещь занята» считаются не по строке каталога, а по ключу, и запросы эти
 * нужны сразу трём местам:
 *
 * - `TripGearService.propose` / `addPersonal` — не дать взять занятую вещь;
 * - `TripRouteService.addSleeping` — то же для «Спальника»;
 * - `TripsService.update` / `restore` — снять ставшие конфликтными строки,
 *   когда меняются даты или поход становится решённым.
 *
 * **Почему отдельный файл, а не методы сервиса.** `TripsModule` про каталог
 * ничего не знает, а `GearModule` импортирует его — сервис из `GearModule`
 * внутри `TripsService` дал бы цикл модулей. Чистые функции над `EntityManager`
 * решают ту же задачу без новой зависимости.
 *
 * **Занятость — только живой решённый поход.** Заказчик: «Завершённые походы
 * не занимают снаряжение. Занятость — только решённые (`decided`)
 * нескончавшиеся походы; `proposed` занимает, `declined` — нет». Поэтому
 * везде стоит `status = 'decided'`, `cancelled_at IS NULL` и
 * `ends_at >= now()`.
 *
 * **Уникальность — проверка в сервисе, а не индекс** (решение заказчика,
 * план §8). Окно гонки принято: в походе два-три человека и они нажимают
 * руками. Индекс по `(trip_id, gear_item_id)` не видит вторую копию той же
 * вещи, потому что `gear_item_id` у клонов разный, — именно его и ловят
 * проверки ниже.
 */

/** Вид строки, которая держит вещь в походе. */
export type GearUseKind = 'shared' | 'personal' | 'sleeping';

/**
 * Название вещи для человеческого сообщения.
 *
 * У одноразовой вещи похода названия может не быть — её подписывает тип
 * («Топор», «Палатка»). Пустое название в тексте ошибки («» уже в походе)
 * выглядело бы поломкой, поэтому берём имя типа.
 */
export function gearTitleOf(item: {
  title?: string | null;
  gearType?: { name?: string | null } | null;
}): string {
  const title = item.title?.trim();
  if (title) return title;

  const typeName = item.gearType?.name?.trim();
  return typeName ? typeName : 'Снаряжение';
}

/** Живой чужой поход, где та же физическая вещь уже занята. */
export interface GearBusyTrip {
  tripId: string;
  tripTitle: string;
  startsAt: string | null;
  endsAt: string | null;
}

/** Занятая вещь в каталоге смотрящего — для бейджа «занята» в выборе. */
export interface GearBusyCatalogItem {
  gearItemId: string;
  tripId: string;
  tripTitle: string;
}

/** Строка похода, снятая при разрешении конфликтов. */
export interface GearRemoval {
  kind: GearUseKind;
  id: string;
  gearUid: string;
  title: string;
  /** Чужой поход, из-за которого строку сняли; `null` — дубль внутри похода. */
  busyTrip: string | null;
}

/**
 * Все строки походов, которые вообще могут держать вещь.
 *
 * Одна и та же подвыборка нужна и проверке занятости, и разрешению
 * конфликтов: три таблицы, потому что вещь может стоять в общественном
 * снаряжении, в личном «Взял» и в «Спальнике» ночёвок. `declined`
 * не занимает — «не берём» это отказ, а не решение.
 */
const GEAR_USE_SOURCE = `
  SELECT tg.trip_id, tg.gear_item_id
    FROM trip_gear tg
   WHERE tg.status <> 'declined'
  UNION ALL
  SELECT pg.trip_id, pg.gear_item_id
    FROM trip_personal_gear pg
  UNION ALL
  SELECT rs.trip_id, rs.gear_item_id
    FROM trip_route_sleeping rs
`;

/** Строка выборки занятости: ключ вещи и чужой поход с датами. */
interface BusyRow {
  gearUid: string;
  tripId: string;
  tripTitle: string;
  startsAt: string;
  endsAt: string;
}

/**
 * Живой чужой поход на пересекающихся датах для каждой из вещей.
 *
 * Даты обязательны с **обеих** сторон: если у сдвигаемого похода их ещё нет
 * (он «планирую» без числа), пересечения не доказать, и проверка молчит.
 * Такой поход поймает переход в `decided` — там даты уже обязательны
 * (`CHECK chk_trips_decided_dates`), и конфликт разрешается удалением строк.
 *
 * Расхождение в один день считается пересечением: `starts_at::date <=
 * $конец AND ends_at::date >= $начало`. Поход «1–3» и поход «3–5» делят
 * третье число, а вещь одна.
 */
async function busyByUid(
  manager: EntityManager,
  trip: Trip,
  uids: string[],
): Promise<Map<string, GearBusyTrip>> {
  if (uids.length === 0 || trip.startsAt === null || trip.endsAt === null) {
    return new Map();
  }

  const rows: BusyRow[] = await manager.query(
    `
    SELECT DISTINCT ON (gi.gear_uid)
           gi.gear_uid::text AS "gearUid",
           t.id::text        AS "tripId",
           COALESCE(t.announcement, o.name, 'поход') AS "tripTitle",
           t.starts_at       AS "startsAt",
           t.ends_at         AS "endsAt"
      FROM (${GEAR_USE_SOURCE}) used
      JOIN gear_items gi ON gi.id = used.gear_item_id
      JOIN trips t       ON t.id = used.trip_id
      LEFT JOIN objects o ON o.id = t.goal_object_id
     WHERE gi.gear_uid = ANY($1::uuid[])
       AND used.trip_id <> $2
       AND t.status = 'decided'
       AND t.cancelled_at IS NULL
       AND t.starts_at IS NOT NULL
       AND t.ends_at IS NOT NULL
       AND t.ends_at >= now()
       AND t.starts_at::date <= $4::date
       AND t.ends_at::date   >= $3::date
     ORDER BY gi.gear_uid, t.starts_at ASC
    `,
    [uids, trip.id, trip.startsAt, trip.endsAt],
  );

  const busy = new Map<string, GearBusyTrip>();
  for (const row of rows) {
    busy.set(row.gearUid, {
      tripId: row.tripId,
      tripTitle: row.tripTitle,
      startsAt:
        row.startsAt === null ? null : new Date(row.startsAt).toISOString(),
      endsAt: row.endsAt === null ? null : new Date(row.endsAt).toISOString(),
    });
  }

  return busy;
}

/** Занята ли вещь в чужом живом решённом походе на те же даты. */
export async function busyTrips(
  manager: EntityManager,
  trip: Trip,
  gearUid: string,
): Promise<GearBusyTrip[]> {
  const busy = await busyByUid(manager, trip, [gearUid]);
  const found = busy.get(gearUid);

  return found === undefined ? [] : [found];
}

/**
 * Стоит ли **другой клон** этой вещи в походе — в любой из трёх таблиц.
 *
 * `exceptItemId` — строка каталога, которую добавляют. Один и тот же клон
 * в двух таблицах (общественная вещь и её личная копия у одного человека)
 * — решение заказчика 06.11.2026, и этот шаг его не отменяет. Ловим именно
 * **второй клон той же вещи**: у родных он свой, `gear_item_id` разный,
 * и уникальный индекс `(trip_id, gear_item_id)` его не видит.
 */
export async function gearInTrip(
  manager: EntityManager,
  tripId: string,
  gearUid: string,
  exceptItemId?: string,
): Promise<boolean> {
  const rows: Array<{ found: number }> = await manager.query(
    `
    SELECT 1 AS "found"
      FROM (${GEAR_USE_SOURCE}) used
      JOIN gear_items gi ON gi.id = used.gear_item_id
     WHERE used.trip_id = $1
       AND gi.gear_uid = $2
       AND ($3::bigint IS NULL OR used.gear_item_id <> $3::bigint)
     LIMIT 1
    `,
    [tripId, gearUid, exceptItemId ?? null],
  );

  return rows.length > 0;
}

/**
 * Можно ли поставить вещь в поход — или 409 с человеческим текстом.
 *
 * Две проверки и две разные причины, поэтому и тексты разные:
 *
 * 1. **эта же вещь уже в этом походе** — второй клон того же `gear_uid`
 *    (в снаряжении, «Взял» или «Спальнике»): одну вещь дважды не берут,
 *    и вес её в рюкзаке считался бы дважды. Индекс `(trip_id, gear_item_id)`
 *    этого не видит — у клонов разные строки каталога;
 * 2. **вещь занята в другом живом решённом походе** на пересекающихся
 *    датах. Формулировка без рода: «уже в походе «Витязь»», потому что
 *    вещь бывает и палаткой, и спальником.
 *
 * Второй пункт — предупреждение, а не окончательный запрет: строки из похода,
 * который **сдвигают**, всё равно снимутся при смене дат (§6 плана). Но
 * молча ставить вещь, которая в это время едет в другом походе, значит
 * обещать человеку то, чего не будет.
 */
export async function assertGearUidFree(
  manager: EntityManager,
  trip: Trip,
  gearUid: string,
  title: string,
  gearItemId?: string,
): Promise<void> {
  if (await gearInTrip(manager, trip.id, gearUid, gearItemId)) {
    throw new ConflictException(
      `«${title}» уже в этом походе — одну вещь дважды не берут`,
    );
  }

  const busy = await busyTrips(manager, trip, gearUid);
  const first = busy[0];
  if (first !== undefined) {
    throw new ConflictException(
      `«${title}» уже в походе «${first.tripTitle}» на те же даты — в этот поход её взять нельзя`,
    );
  }
}

/** Строка похода с ключом вещи: из какой таблицы и что это за вещь. */
interface TripGearUseRow {
  kind: GearUseKind;
  id: string;
  gearItemId: string;
  gearUid: string;
  title: string;
  tripOnly: boolean;
}

/**
 * Строки похода вместе с ключом вещи, в порядке приоритета.
 *
 * Порядок задан намеренно: `shared` → `personal` → `sleeping`, внутри — по id.
 * Если в походе оказались два клона одной вещи, остаётся **общественная**
 * строка: именно она видна всей вкладке и участвует в раскладке груза,
 * а личная копия — личное решение одного человека.
 */
async function tripUses(
  manager: EntityManager,
  tripId: string,
): Promise<TripGearUseRow[]> {
  return manager.query(`
    SELECT kind, id, "gearItemId", "gearUid", title, "tripOnly"
      FROM (
        SELECT 'shared' AS kind,
               tg.id::text AS id,
               tg.gear_item_id::text AS "gearItemId",
               gi.gear_uid::text AS "gearUid",
               COALESCE(NULLIF(gi.title, ''), gt.name) AS title,
               gi.is_trip_only AS "tripOnly"
          FROM trip_gear tg
          JOIN gear_items gi ON gi.id = tg.gear_item_id
          JOIN gear_types gt ON gt.id = gi.gear_type_id
         WHERE tg.trip_id = $1 AND tg.status <> 'declined'
        UNION ALL
        SELECT 'personal', pg.id::text, pg.gear_item_id::text,
               gi.gear_uid::text,
               COALESCE(NULLIF(gi.title, ''), gt.name),
               gi.is_trip_only
          FROM trip_personal_gear pg
          JOIN gear_items gi ON gi.id = pg.gear_item_id
          JOIN gear_types gt ON gt.id = gi.gear_type_id
         WHERE pg.trip_id = $1
        UNION ALL
        SELECT 'sleeping', rs.id::text, rs.gear_item_id::text,
               gi.gear_uid::text,
               COALESCE(NULLIF(gi.title, ''), gt.name),
               gi.is_trip_only
          FROM trip_route_sleeping rs
          JOIN gear_items gi ON gi.id = rs.gear_item_id
          JOIN gear_types gt ON gt.id = gi.gear_type_id
         WHERE rs.trip_id = $1
      ) uses
     ORDER BY CASE kind
                WHEN 'shared' THEN 1
                WHEN 'personal' THEN 2
                ELSE 3
              END,
              id::bigint ASC
  `, [tripId]);
}

/**
 * Разрешить конфликты похода: снять строки, которым новые даты больше
 * не подходят (11.11.2026, шаг 2).
 *
 * Вызывается, когда поход **становится решённым** или **меняет даты**.
 * Решение заказчика (план §6): «сдвигаемый поход теряет вещь, второй
 * сохраняет». Поэтому строки снимаются только у того похода, который
 * сдвинулся, а в оба его чата (`trip_route`, `trip_gear`) уходит одно
 * сообщение со списком — историю правки видит весь состав.
 *
 * Три условия, без которых не делаем ничего:
 *
 * - поход решённый и не отменённый — только он занимает снаряжение;
 * - у него есть даты — иначе пересечения не считается;
 * - он ещё не закончился (`ends_at >= now()`).
 *   Прошедший поход — история, и трогать её нельзя: «завершённые походы
 *   не занимают снаряжение».
 *
 * Внутрипоходные дубли (два клона одной вещи в одном походе) снимаются
 * здесь же: без этого они существовали бы вечно, потому что появились
 * в «планирую», где проверок ещё не было.
 */
export async function removeConflictingGear(
  manager: EntityManager,
  trip: Trip,
): Promise<GearRemoval[]> {
  const alive: Array<{ found: number }> = await manager.query(
    `
    SELECT 1 AS "found"
      FROM trips t
     WHERE t.id = $1
       AND t.status = 'decided'
       AND t.cancelled_at IS NULL
       AND t.starts_at IS NOT NULL
       AND t.ends_at IS NOT NULL
       AND t.ends_at >= now()
    `,
    [trip.id],
  );
  if (alive.length === 0) return [];

  const rows = await tripUses(manager, trip.id);
  if (rows.length === 0) return [];

  const busy = await busyByUid(manager, trip, [
    ...new Set(rows.map((row) => row.gearUid)),
  ]);

  const keptItemByUid = new Map<string, string>();
  const busyByKind = new Map<GearUseKind, string[]>();
  const removals: GearRemoval[] = [];

  for (const row of rows) {
    const busyTrip = busy.get(row.gearUid)?.tripTitle ?? null;

    if (busyTrip === null) {
      const keptItemId = keptItemByUid.get(row.gearUid);
      // Тот же клон в другой таблице — законная пара 06.11.2026
      // («общественная вещь и её личная копия»). Убираем только **другой**
      // клон той же физической вещи: он и даёт двойной вес.
      if (keptItemId === undefined || keptItemId === row.gearItemId) {
        keptItemByUid.set(row.gearUid, row.gearItemId);
        continue;
      }
    }

    removals.push({
      kind: row.kind,
      id: row.id,
      gearUid: row.gearUid,
      title: row.title,
      busyTrip,
    });

    const ids = busyByKind.get(row.kind) ?? [];
    ids.push(row.id);
    busyByKind.set(row.kind, ids);
  }

  if (removals.length === 0) return [];

  const sharedIds = busyByKind.get('shared') ?? [];
  const personalIds = busyByKind.get('personal') ?? [];
  const sleepingIds = busyByKind.get('sleeping') ?? [];

  if (sharedIds.length > 0) {
    /**
     * Одноразовые вещи уходят вместе со строкой: каталогу они
     * не принадлежат, и, оставшись, висели бы в базе невидимой никому
     * (каталог одноразовые не отдаёт). Та же логика, что в `remove`.
     */
    const tripOnly: string[] = rows
      .filter(
        (row) =>
          row.kind === 'shared' &&
          row.tripOnly &&
          sharedIds.includes(row.id),
      )
      .map((row) => row.gearItemId);

    await manager.query(
      `DELETE FROM trip_gear WHERE id = ANY($1::bigint[])`,
      [sharedIds],
    );

    if (tripOnly.length > 0) {
      await manager.query(
        `DELETE FROM gear_items gi
          WHERE gi.id = ANY($1::bigint[])
            AND gi.is_trip_only = true
            AND NOT EXISTS (
              SELECT 1 FROM trip_gear tg WHERE tg.gear_item_id = gi.id
            )`,
        [tripOnly],
      );
    }
  }

  if (personalIds.length > 0) {
    await manager.query(
      `DELETE FROM trip_personal_gear WHERE id = ANY($1::bigint[])`,
      [personalIds],
    );
  }

  if (sleepingIds.length > 0) {
    await manager.query(
      `DELETE FROM trip_route_sleeping WHERE id = ANY($1::bigint[])`,
      [sleepingIds],
    );
  }

  return removals;
}

/**
 * Сообщение о снятых строках — одно на два чата.
 *
 * Заказчик: «в чаты `trip_route` и `trip_gear` уходит сообщение со списком».
 * Одно сообщение, а не по одному на чат: правка одна, и два разных текста
 * в двух чатах читались бы как два события.
 */
export function conflictMessage(
  removals: GearRemoval[],
  reason: 'decided' | 'dates' | 'restore',
): string | null {
  if (removals.length === 0) return null;

  const parts = removals.map((row) =>
    row.busyTrip === null
      ? `«${row.title}» — второй раз в этом походе`
      : `«${row.title}» — в походе «${row.busyTrip}»`,
  );

  const heads: Record<'decided' | 'dates' | 'restore', string> = {
    decided:
      'Поход решён, но часть снаряжения на эти даты уже занята. Убрали из этого похода',
    dates:
      'Даты изменились, и часть снаряжения на них уже занята. Убрали из этого похода',
    restore:
      'Поход вернули в строй, но часть снаряжения на эти даты уже занята. Убрали из этого похода',
  };

  return `${heads[reason]}: ${parts.join('; ')}.`;
}

/**
 * Кто из активных клонов держит вещь сейчас (`deleted_at IS NULL`).
 *
 * История похода читает и мягко удалённые строки — иначе старый поход
 * терял бы снаряжение (11.11.2026). Но человеку нужно не «ундефинед»,
 * а ответ на вопрос «где эта вещь»: у бывшего родного копия осталась,
 * и он «знает, что ответить» (слова заказчика, план «Архив похода»).
 * Поэтому по ключу вещи ищутся живые клоны, и экран говорит «есть у Анны».
 */
export async function activeHolders(
  manager: EntityManager,
  uids: string[],
): Promise<Map<string, Array<{ userId: string; name: string }>>> {
  const holders = new Map<string, Array<{ userId: string; name: string }>>();
  if (uids.length === 0) return holders;

  const rows: Array<{ gearUid: string; userId: string; name: string }> =
    await manager.query(
      `
      SELECT gi.gear_uid::text AS "gearUid",
             u.id::text AS "userId",
             u.display_name AS "name"
        FROM gear_items gi
        JOIN users u ON u.id = gi.owner_user_id
       WHERE gi.gear_uid = ANY($1::uuid[])
         AND gi.deleted_at IS NULL
         AND gi.is_trip_only = false
         AND u.deleted_at IS NULL
         AND u.is_virtual = false
       ORDER BY u.display_name ASC
      `,
      [uids],
    );

  for (const row of rows) {
    const list = holders.get(row.gearUid) ?? [];
    if (list.some((person) => person.userId === row.userId)) continue;
    list.push({ userId: row.userId, name: row.name });
    holders.set(row.gearUid, list);
  }

  return holders;
}

/**
 * Вещи каталога смотрящего, занятые в чужих живых решённых походах, — для
 * бейджа «занята» в выборе снаряжения.
 *
 * Считается по каталогу смотрящего, а не по походу: в выборе лежат его вещи,
 * и бейдж нужен у конкретной строки каталога. По одной вещи на ответ —
 * если она занята в двух походах, показываем ближайший по дате.
 */
export async function busyCatalogForViewer(
  manager: EntityManager,
  trip: Trip,
  viewerId: string,
): Promise<GearBusyCatalogItem[]> {
  if (trip.startsAt === null || trip.endsAt === null) return [];

  const rows: Array<{
    gearItemId: string;
    tripId: string;
    tripTitle: string;
  }> = await manager.query(
    `
    SELECT DISTINCT ON (gi.id)
           gi.id::text AS "gearItemId",
           t.id::text  AS "tripId",
           COALESCE(t.announcement, o.name, 'поход') AS "tripTitle"
      FROM gear_items gi
      JOIN (${GEAR_USE_SOURCE}) used ON used.gear_item_id = gi.id
      JOIN trips t ON t.id = used.trip_id
      LEFT JOIN objects o ON o.id = t.goal_object_id
     WHERE gi.owner_user_id = $1
       AND gi.deleted_at IS NULL
       AND gi.is_trip_only = false
       AND used.trip_id <> $2
       AND t.status = 'decided'
       AND t.cancelled_at IS NULL
       AND t.starts_at IS NOT NULL
       AND t.ends_at IS NOT NULL
       AND t.ends_at >= now()
       AND t.starts_at::date <= $4::date
       AND t.ends_at::date   >= $3::date
     ORDER BY gi.id, t.starts_at ASC
    `,
    [viewerId, trip.id, trip.startsAt, trip.endsAt],
  );

  return rows.map((row) => ({
    gearItemId: row.gearItemId,
    tripId: row.tripId,
    tripTitle: row.tripTitle,
  }));
}
