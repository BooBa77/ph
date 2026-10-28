/**
 * Проверка инвариантов схемы походов на живой базе.
 *
 * Зачем отдельный скрипт, если есть тесты. Поведение эндпоинтов проверяют
 * e2e, а **схему** — CHECK-и, уникальные индексы, составные внешние ключи
 * и триггеры — обычный `vitest` не дотягивается: всё это живёт в базе,
 * а не в коде. Скрипт идёт
 * по host-соединению, поэтому работает локально — без Docker и без
 * `@swc/core`, на котором спотыкаются бэкендовые тесты в песочнице.
 *
 * Ценность доказана дважды, и оба раза на ровном месте:
 *   - CHECK вида `"sport_type" IS NULL OR "sport_kind" = 'tourism'`
 *     пропускал мусор: в SQL `NULL = 'tourism'` даёт `NULL`, а CHECK
 *     считает `NULL` выполненным. Дыру нашли здесь, а не на ревью.
 *     Сами спортивные CHECK-и из схемы с тех пор уехали (поход стал
 *     универсальным, спорт — отдельные таблицы), но урок остался: любое
 *     условие с nullable-колонкой надо проверять на NULL-семантику;
 *   - обход `pg_trigger_depth()` в триггере организатора оказался
 *     не нужен — каскадное удаление похода триггер не задевает.
 *
 * **Скрипт ничего не меняет в базе.** Всё идёт в одной транзакции,
 * которая в конце откатывается, а каждая проверка обёрнута в SAVEPOINT:
 * исключения здесь ожидаются, и без savepoint первое же убило бы
 * транзакцию целиком. Успешная проверка фиксируется (`RELEASE SAVEPOINT`),
 * неуспешная откатывается — проверки идут цепочкой и строят состояние
 * друг для друга.
 *
 * Запуск (нужна живая dev-база):
 *   node scripts/check-trips-schema.mjs
 *   npm run check:trips-schema
 */
import pg from 'pg';

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('Нужен MIGRATION_DATABASE_URL или DATABASE_URL');
  process.exit(2);
}

/**
 * Защита от запуска на проде. Транзакция откатывается и данные бы не
 * пострадали, но блокировки на боевой таблице `users` брать незачем,
 * а ошибка в скрипте обошлась бы дорого. Прод живёт за `postgres:5432`
 * внутри docker-сети; локальная разработка — на `127.0.0.1:5434`.
 */
const host = new URL(url).hostname;
if (!['127.0.0.1', 'localhost', '::1', 'postgres'].includes(host)) {
  console.error(
    `Отказ: скрипт только для dev-базы, а хост — ${host}. Проверка рассчитана на пустую dev-базу.`,
  );
  process.exit(2);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

const rows = [];
let failed = 0;

async function check(name, expectation, sql, params = []) {
  await client.query('SAVEPOINT sp');
  try {
    await client.query(sql, params);
    await client.query('RELEASE SAVEPOINT sp');
    if (expectation === 'fail') {
      failed += 1;
      rows.push(['ПРОШЛО, а должно упасть', name, '']);
    } else {
      rows.push(['ok', name, '']);
    }
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT sp');
    await client.query('RELEASE SAVEPOINT sp');
    if (expectation === 'ok') {
      failed += 1;
      rows.push(['УПАЛО, а должно пройти', name, error.message.split('\n')[0]]);
    } else {
      rows.push(['ok (упало, как ждали)', name, error.message.split('\n')[0]]);
    }
  }
}

await client.query('BEGIN');

const user = await client.query(
  'SELECT id FROM users ORDER BY created_at LIMIT 1',
);
const activityType = await client.query(
  'SELECT id FROM calendar_activity_types LIMIT 1',
);

if (user.rowCount === 0 || activityType.rowCount === 0) {
  console.error(
    'Нужны хотя бы один пользователь и один тип активности: без них нечего проверять.',
  );
  await client.query('ROLLBACK');
  await client.end();
  process.exit(2);
}

const user1 = user.rows[0].id;
const user2 = (
  await client.query(
    `INSERT INTO users (display_name) VALUES ('Тестовый участник') RETURNING id`,
  )
).rows[0].id;
const activityTypeId = activityType.rows[0].id;

const objectId = (
  await client.query(
    `INSERT INTO objects (name, type) VALUES ('Тестовая вершина', 'вершина') RETURNING id`,
  )
).rows[0].id;
const parentId = (
  await client.query(
    `INSERT INTO objects (name, type) VALUES ('Тестовая система', 'горная система') RETURNING id`,
  )
).rows[0].id;

const tripId = (
  await client.query(
    `INSERT INTO trips (organizer_user_id, goal_object_id, route_text)
     VALUES ($1, $2, '') RETURNING id`,
    [user1, objectId],
  )
).rows[0].id;

// ─── Справочник объектов ───
await check(
  'objects: самоссылка через parent_id запрещена',
  'fail',
  `UPDATE objects SET parent_id = id WHERE id = $1`,
  [objectId],
);
await check(
  'objects: нормальный родитель принимается',
  'ok',
  `UPDATE objects SET parent_id = $2 WHERE id = $1`,
  [objectId, parentId],
);

// ─── Поход: типы, даты, коммерция, гитара ───
/**
 * Типы похода — связка `trip_types` (миграция `TripTypes`, 20.10.2026).
 * Раньше это был массив `activity_type_ids`, и существование id держал
 * триггер; теперь держит внешний ключ, а триггер убран вместе с колонкой.
 */
await check(
  'типы: несуществующий id активности отклонён внешним ключом',
  'fail',
  `INSERT INTO trip_types (trip_id, activity_type_id) VALUES ($1, 999999)`,
  [tripId],
);
await check(
  'типы: существующий тип принимается',
  'ok',
  `INSERT INTO trip_types (trip_id, activity_type_id) VALUES ($1, $2)`,
  [tripId, activityTypeId],
);
await check(
  'типы: дубликат пары (поход, тип) запрещён составным ключом',
  'fail',
  `INSERT INTO trip_types (trip_id, activity_type_id) VALUES ($1, $2)`,
  [tripId, activityTypeId],
);
await check(
  'типы: поход без типов законен — связка пустая',
  'ok',
  `DELETE FROM trip_types WHERE trip_id = $1`,
  [tripId],
);
await check(
  'гитара: значение по умолчанию — false',
  'ok',
  `UPDATE trips SET has_guitar = false WHERE id = $1`,
  [tripId],
);
await check(
  'гитара: NULL запрещён (NOT NULL)',
  'fail',
  `UPDATE trips SET has_guitar = NULL WHERE id = $1`,
  [tripId],
);
await check(
  'trips: decided без дат запрещён',
  'fail',
  `UPDATE trips SET status = 'decided' WHERE id = $1`,
  [tripId],
);
await check(
  'trips: decided с датами принимается',
  'ok',
  `UPDATE trips SET status = 'decided', starts_at = now(), ends_at = now() + interval '5 days' WHERE id = $1`,
  [tripId],
);
await check(
  'trips: конец раньше начала запрещён',
  'fail',
  `UPDATE trips SET ends_at = starts_at - interval '1 day' WHERE id = $1`,
  [tripId],
);
await check(
  'trips: коммерческий поход без цены запрещён',
  'fail',
  `UPDATE trips SET is_commercial = true WHERE id = $1`,
  [tripId],
);
await check(
  'trips: коммерческий поход с ценой принимается',
  'ok',
  `UPDATE trips SET is_commercial = true, price_rub = 25000 WHERE id = $1`,
  [tripId],
);
await check(
  'trips: нулевая цена запрещена',
  'fail',
  `UPDATE trips SET price_rub = 0 WHERE id = $1`,
  [tripId],
);
await check(
  'trips: снимаем коммерцию вместе с ценой',
  'ok',
  `UPDATE trips SET is_commercial = false, price_rub = NULL, price_note = NULL WHERE id = $1`,
  [tripId],
);
await check(
  'trips: некоммерческий поход с ценой участия запрещён',
  'fail',
  `UPDATE trips SET price_rub = 3000 WHERE id = $1`,
  [tripId],
);
await check(
  'trips: некоммерческий поход с заметкой о цене запрещён',
  'fail',
  `UPDATE trips SET price_note = 'входит питание и заброска' WHERE id = $1`,
  [tripId],
);
await check(
  'trips: идею нельзя отменить',
  'fail',
  `INSERT INTO trips (organizer_user_id, goal_object_id, status, cancelled_at) VALUES ($1, $2, 'idea', now())`,
  [user1, objectId],
);

// ─── Варианты дат ───
await check(
  'варианты: пустая строка запрещена',
  'fail',
  `INSERT INTO trip_date_variants (trip_id) VALUES ($1)`,
  [tripId],
);
await check(
  'варианты: дельта без продолжительности запрещена',
  'fail',
  `INSERT INTO trip_date_variants (trip_id, duration_delta) VALUES ($1, 1)`,
  [tripId],
);
await check(
  'варианты: «летом на неделю» (месяц и дни) принимается',
  'ok',
  `INSERT INTO trip_date_variants (trip_id, month, duration_days, duration_delta) VALUES ($1, 6, 7, 0)`,
  [tripId],
);
await check(
  'варианты: день без месяца запрещён',
  'fail',
  `INSERT INTO trip_date_variants (trip_id, day) VALUES ($1, 5)`,
  [tripId],
);
await check(
  'варианты: год вне диапазона запрещён',
  'fail',
  `INSERT INTO trip_date_variants (trip_id, year) VALUES ($1, 1900)`,
  [tripId],
);

// ─── Участники и роли ───
await client.query(
  `INSERT INTO trip_participants (trip_id, user_id, status) VALUES ($1, $2, 'going')`,
  [tripId, user1],
);
await client.query(
  `INSERT INTO trip_participants (trip_id, user_id, status) VALUES ($1, $2, 'maybe')`,
  [tripId, user2],
);
await check(
  'участники: дубликат пары (поход, человек) запрещён',
  'fail',
  `INSERT INTO trip_participants (trip_id, user_id) VALUES ($1, $2)`,
  [tripId, user2],
);
await check(
  'участники: статус вне словаря запрещён',
  'fail',
  `UPDATE trip_participants SET status = 'thinking' WHERE trip_id = $1 AND user_id = $2`,
  [tripId, user2],
);
await check(
  'участники: организатора удалить нельзя (триггер)',
  'fail',
  `DELETE FROM trip_participants WHERE trip_id = $1 AND user_id = $2`,
  [tripId, user1],
);
await check(
  'участники: обычного участника удалить можно',
  'ok',
  `DELETE FROM trip_participants WHERE trip_id = $1 AND user_id = $2`,
  [tripId, user2],
);

const roleId = (
  await client.query(
    `INSERT INTO roles (code, name) VALUES ('leader', 'Руководитель') RETURNING id`,
  )
).rows[0].id;
await client.query(
  `INSERT INTO trip_participant_roles (trip_id, user_id, role_id) VALUES ($1, $2, $3)`,
  [tripId, user1, roleId],
);
await check(
  'роли: роль человеку не из похода запрещена (составной FK)',
  'fail',
  `INSERT INTO trip_participant_roles (trip_id, user_id, role_id) VALUES ($1, $2, $3)`,
  [tripId, user2, roleId],
);
await check(
  'роли: дубликат роли запрещён',
  'fail',
  `INSERT INTO trip_participant_roles (trip_id, user_id, role_id) VALUES ($1, $2, $3)`,
  [tripId, user1, roleId],
);

// ─── Заявки и приглашения ───
await check(
  'заявки: заявка принимается',
  'ok',
  `INSERT INTO trip_membership_requests (trip_id, user_id, direction) VALUES ($1, $2, 'apply')`,
  [tripId, user2],
);
await check(
  'заявки: приглашение поверх заявки запрещено',
  'fail',
  `INSERT INTO trip_membership_requests (trip_id, user_id, direction) VALUES ($1, $2, 'invite')`,
  [tripId, user2],
);
await check(
  'заявки: направление вне словаря запрещено',
  'fail',
  `INSERT INTO trip_membership_requests (trip_id, user_id, direction) VALUES ($1, $2, 'demand')`,
  [tripId, user1],
);

// ─── Чаты и сообщения ───
/**
 * С 20.10.2026 чат похода и личный диалог — одна модель (`conversations`),
 * а сообщения лежат в `messages` с `conversation_id`. Отдельных `chats`
 * и `group_messages` в схеме больше нет.
 */
const conversationId = (
  await client.query(
    `INSERT INTO conversations (kind, trip_id) VALUES ('trip_guest', $1) RETURNING id`,
    [tripId],
  )
).rows[0].id;
await client.query(
  `INSERT INTO conversations (kind, trip_id) VALUES ('trip_members', $1)`,
  [tripId],
);
await check(
  'чаты: второй чат того же вида на поход запрещён',
  'fail',
  `INSERT INTO conversations (kind, trip_id) VALUES ('trip_guest', $1)`,
  [tripId],
);
await client.query(
  `INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1, $2, 'привет')`,
  [conversationId, user1],
);
await client.query(
  `INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1, NULL, 'Иван подал заявку')`,
  [conversationId],
);

// ─── Триггер на объект в тексте маршрута ───
await client.query(`UPDATE trips SET route_text = $2 WHERE id = $1`, [
  tripId,
  `Идём на [[object:${objectId}]] через перевал`,
]);
await check(
  'объект: удаление упомянутого в route_text запрещено (триггер)',
  'fail',
  `DELETE FROM objects WHERE id = $1`,
  [objectId],
);
await check(
  'объект: удаление родителя с детьми запрещено (RESTRICT)',
  'fail',
  `DELETE FROM objects WHERE id = $1`,
  [parentId],
);

// ─── Трансфер: карточки перемещений и пассажиры ───
/**
 * Те же правила, что и в сервисе, но **базой**: сторона и тип транспорта
 * из списка, «наше ТС» только с владельцем и только на своём транспорте,
 * цена билета только у рейсов, общий расход только у своего, «туда-обратно»
 * только не у рейсов, время отправления обязательно, пассажир только
 * из состава и один раз в карточке. Заброска — либо `chain_id` вместе
 * с номером этапа, либо ни того, ни другого. Плюс каскад: убрали карточку —
 * ушли её пассажиры.
 */
const legId = (
  await client.query(
    `INSERT INTO trip_transfer_legs
       (trip_id, direction, position, departs_at, from_place, to_place, mode)
     VALUES ($1, 'there', 1, now(), 'Иркутск, автовокзал', 'Олхинское плато', 'car')
     RETURNING id`,
    [tripId],
  )
).rows[0].id;

await check(
  'трансфер: тип транспорта вне списка запрещён',
  'fail',
  `UPDATE trip_transfer_legs SET mode = 'вертолёт' WHERE id = $1`,
  [legId],
);

await check(
  'трансфер: сторона кроме «туда» и «обратно» запрещена',
  'fail',
  `UPDATE trip_transfer_legs SET direction = 'вперёд' WHERE id = $1`,
  [legId],
);

await check(
  'трансфер: время отправления обязательно',
  'fail',
  `UPDATE trip_transfer_legs SET departs_at = NULL WHERE id = $1`,
  [legId],
);

await check(
  'трансфер: «наше ТС» без владельца запрещено',
  'fail',
  `UPDATE trip_transfer_legs SET is_own_vehicle = true WHERE id = $1`,
  [legId],
);

await check(
  'трансфер: у рейса не бывает владельца («наше ТС»)',
  'fail',
  `UPDATE trip_transfer_legs
      SET mode = 'bus', is_own_vehicle = true, owner_user_id = $2
    WHERE id = $1`,
  [legId, user1],
);

await check(
  'трансфер: цена билета только у рейсов',
  'fail',
  `UPDATE trip_transfer_legs
      SET compensation = 'ticket', compensation_amount_rub = 500
    WHERE id = $1`,
  [legId],
);

await check(
  'трансфер: общий расход только у своего транспорта',
  'fail',
  `INSERT INTO trip_transfer_legs
     (trip_id, direction, position, departs_at, from_place, to_place, mode, compensation)
   VALUES ($1, 'there', 2, now(), 'Иркутск', 'Витязь', 'train', 'shared')`,
  [tripId],
);

await check(
  'трансфер: «туда-обратно» у своего транспорта разрешено при любой оплате',
  'ok',
  `INSERT INTO trip_transfer_legs
     (trip_id, direction, position, departs_at, from_place, to_place,
      mode, compensation, compensation_amount_rub, is_round_trip)
   VALUES ($1, 'there', 4, now(), 'Иркутск', 'Витязь',
           'car', 'shared', 3000, true)`,
  [tripId],
);

await check(
  'трансфер: «туда-обратно» у рейса тоже можно — это планирование',
  'ok',
  `INSERT INTO trip_transfer_legs
     (trip_id, direction, position, departs_at, from_place, to_place,
      mode, compensation, compensation_amount_rub, is_round_trip)
   VALUES ($1, 'there', 5, now(), 'Иркутск', 'Витязь',
           'bus', 'ticket', 500, true)`,
  [tripId],
);

await check(
  'трансфер: велосипед больше не тип транспорта',
  'fail',
  `UPDATE trip_transfer_legs SET mode = 'bicycle' WHERE id = $1`,
  [legId],
);

await check(
  'трансфер: этап заброски — это флаг у строки',
  'ok',
  `INSERT INTO trip_transfer_legs
     (trip_id, direction, position, departs_at, from_place, to_place,
      mode, compensation, is_stage)
   VALUES ($1, 'there', 6, now(), 'Баяндай', 'Сухой ручей',
           'horses', 'free', true)`,
  [tripId],
);

const ownLegId = (
  await client.query(
    `INSERT INTO trip_transfer_legs
       (trip_id, direction, position, departs_at, from_place, to_place,
        mode, is_own_vehicle, owner_user_id, seats,
        compensation, compensation_amount_rub, is_round_trip)
     VALUES ($1, 'back', 1, now(), 'Олхинское плато', 'Иркутск',
             'car', true, $2, 4, 'shared', 3000, true)
     RETURNING id`,
    [tripId, user1],
  )
).rows[0].id;

await check(
  'трансфер: пассажир не из состава похода запрещён',
  'fail',
  `INSERT INTO trip_transfer_passengers (trip_id, leg_id, user_id)
   VALUES ($1, $2, $3)`,
  [tripId, ownLegId, user2],
);

/** Владелец едет первым — на нём и проверяется дубль. */
await client.query(
  `INSERT INTO trip_transfer_passengers (trip_id, leg_id, user_id)
   VALUES ($1, $2, $3)`,
  [tripId, ownLegId, user1],
);

await check(
  'трансфер: второй раз в той же карточке запрещён',
  'fail',
  `INSERT INTO trip_transfer_passengers (trip_id, leg_id, user_id)
   VALUES ($1, $2, $3)`,
  [tripId, ownLegId, user1],
);

await check(
  'трансфер: статус пассажира вне списка запрещён',
  'fail',
  `UPDATE trip_transfer_passengers SET status = 'может быть'
    WHERE trip_id = $1 AND leg_id = $2`,
  [tripId, ownLegId],
);

await client.query(`DELETE FROM trip_transfer_legs WHERE id = $1`, [ownLegId]);
const orphanPassengers = await client.query(
  `SELECT count(*)::int AS count FROM trip_transfer_passengers WHERE leg_id = $1`,
  [ownLegId],
);
const legCascadeClean = orphanPassengers.rows[0]?.count === 0;
if (!legCascadeClean) failed += 1;
rows.push([
  legCascadeClean ? 'ok' : 'ОСТАЛИСЬ ПАССАЖИРЫ',
  'трансфер: удаление карточки уносит её пассажиров (CASCADE)',
  '',
]);

// ─── Каскад при удалении похода ───
/**
 * Две проверки — пара, и смысл у них общий: триггер организатора не
 * должен мешать каскадному удалению похода. Здесь раньше стоял обход
 * через `pg_trigger_depth()`, но проверка показала, что каскад триггер
 * не задевает вовсе (RI-триггер идёт со снимком, в котором удаляемый
 * поход уже не виден), и обход из схемы убран как лишний. Если кто-то
 * вернёт его «на всякий случай», эти две строки объяснят, почему не надо.
 */
const counts = `
  SELECT (SELECT count(*) FROM trip_participants WHERE trip_id = $1)::int AS participants,
         (SELECT count(*) FROM conversations WHERE trip_id = $1)::int AS chats,
         (SELECT count(*) FROM messages WHERE conversation_id = $2)::int AS messages,
         (SELECT count(*) FROM trip_date_variants WHERE trip_id = $1)::int AS variants,
         (SELECT count(*) FROM trip_participant_roles WHERE trip_id = $1)::int AS roles,
         (SELECT count(*) FROM trip_types WHERE trip_id = $1)::int AS types,
         (SELECT count(*) FROM trip_transfer_legs WHERE trip_id = $1)::int AS transfer_legs,
         (SELECT count(*) FROM trip_transfer_passengers WHERE trip_id = $1)::int AS transfer_people
`;
const before = (await client.query(counts, [tripId, conversationId])).rows[0];
await check(
  'поход: удаление проходит, несмотря на триггер организатора',
  'ok',
  `DELETE FROM trips WHERE id = $1`,
  [tripId],
);
const after = (await client.query(counts, [tripId, conversationId])).rows[0];

const cascadeClean =
  after.participants === 0 &&
  after.chats === 0 &&
  after.messages === 0 &&
  after.variants === 0 &&
  after.roles === 0 &&
  after.types === 0 &&
  after.transfer_legs === 0 &&
  after.transfer_people === 0;
if (!cascadeClean) failed += 1;
rows.push([
  cascadeClean ? 'ok' : 'ОСТАЛСЯ МУСОР',
  `каскад убрал за походом (было: участников ${before.participants}, чатов ${before.chats}, сообщений ${before.messages}, вариантов ${before.variants}, ролей ${before.roles}, типов ${before.types}, карточек трансфера ${before.transfer_legs}, пассажиров ${before.transfer_people})`,
  '',
]);

await check(
  'объект: после удаления похода ссылок нет — объект удаляется',
  'ok',
  `DELETE FROM objects WHERE id = $1`,
  [objectId],
);

await client.query('ROLLBACK');
await client.end();

for (const [status, name, detail] of rows) {
  console.log(`${status.padEnd(32)} ${name}${detail ? `  ← ${detail}` : ''}`);
}
console.log('');
console.log(failed === 0 ? 'ВСЕ ПРОВЕРКИ ПРОШЛИ' : `ПРОВАЛЕНО: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
