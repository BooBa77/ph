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

// ─── Типы снаряжения, их характеристики и списки вариантов ───
/**
 * Инварианты справочника `gear_types` / `gear_type_attributes` /
 * `gear_attribute_options`.
 *
 * Проверяется то, из-за чего справочник придётся чинить руками: код
 * нелатинской записью, пустое имя из формы, `sort_order` меньше нуля,
 * вид значения вне разрешённых. Отдельно — **уникальность кода
 * с архивными строками**: в Stage B на код будут ссылаться значения, и
 * активный с архивным атрибут с одним кодом сделали бы `attributes {code:
 * value}` неоднозначным.
 *
 * С 30.10.2026 здесь же четвёртый вид значения — `select` — и его флаг
 * `allow_custom_value`: флаг осмыслен только у списка, поэтому у числа,
 * строки и галочки его запрещает CHECK. Варианты списка
 * (`gear_attribute_options`) держат код, имя, порядок и архив отдельными
 * колонками, а не массивом.
 */
const gearTentId = (
  await client.query(
    `INSERT INTO gear_types (code, name) VALUES ('e2e_check_tent', 'Проверочная палатка')
     RETURNING id`,
  )
).rows[0].id;

const gearAxeId = (
  await client.query(
    `INSERT INTO gear_types (code, name) VALUES ('e2e_check_axe', 'Проверочный топор')
     RETURNING id`,
  )
).rows[0].id;

await check(
  'тип: латинский код обязателен (заглавные запрещены)',
  'fail',
  `INSERT INTO gear_types (code, name) VALUES ('Tent', 'Палатка')`,
);

await check(
  'тип: код длиннее 40 символов запрещён',
  'fail',
  `INSERT INTO gear_types (code, name)
   VALUES ('a' || repeat('b', 40), 'Длинный код')`,
);

await check(
  'тип: код повторно запрещён (unique)',
  'fail',
  `INSERT INTO gear_types (code, name) VALUES ('e2e_check_tent', 'Дубль')`,
);

await check(
  'тип: имя из пробелов запрещено (btrim)',
  'fail',
  `INSERT INTO gear_types (code, name) VALUES ('e2e_check_blank', '   ')`,
);

await check(
  'тип: отрицательный sort_order запрещён',
  'fail',
  `INSERT INTO gear_types (code, name, sort_order)
   VALUES ('e2e_check_sort', 'Порядок', -1)`,
);

await check(
  'тип: имя длиннее 100 символов запрещено',
  'fail',
  `INSERT INTO gear_types (code, name)
   VALUES ('e2e_check_long', repeat('я', 101))`,
);

const gearAttribute = (
  await client.query(
    `INSERT INTO gear_type_attributes (gear_type_id, code, name, value_kind, unit)
     VALUES ($1, 'seats', 'Вместимость', 'number', 'мест')
     RETURNING id, is_active, is_required, sort_order`,
    [gearTentId],
  )
).rows[0];

const attributeDefaultsOk =
  gearAttribute.is_active === true &&
  gearAttribute.is_required === false &&
  gearAttribute.sort_order === 0;
if (!attributeDefaultsOk) failed += 1;
rows.push([
  attributeDefaultsOk ? 'ok' : 'НЕВЕРНЫЕ УМОЛЧАНИЯ',
  'характеристика: is_active = true, is_required = false, sort_order = 0 по умолчанию',
  '',
]);

await check(
  'характеристика: вид значения вне number/text/bool/select запрещён',
  'fail',
  `INSERT INTO gear_type_attributes (gear_type_id, code, name, value_kind)
   VALUES ($1, 'volume', 'Объём', 'число')`,
  [gearTentId],
);

await check(
  'характеристика: пустой unit запрещён (btrim)',
  'fail',
  `INSERT INTO gear_type_attributes (gear_type_id, code, name, value_kind, unit)
   VALUES ($1, 'empty_unit', 'Пустая единица', 'text', '')`,
  [gearTentId],
);

await check(
  'характеристика: unit длиннее 20 символов запрещён',
  'fail',
  `INSERT INTO gear_type_attributes (gear_type_id, code, name, value_kind, unit)
   VALUES ($1, 'long_unit', 'Длинная единица', 'text', repeat('я', 21))`,
  [gearTentId],
);

await check(
  'характеристика: код повторно у того же типа запрещён',
  'fail',
  `INSERT INTO gear_type_attributes (gear_type_id, code, name, value_kind)
   VALUES ($1, 'seats', 'Вместимость снова', 'number')`,
  [gearTentId],
);

await check(
  'характеристика: тот же код у другого типа разрешён',
  'ok',
  `INSERT INTO gear_type_attributes (gear_type_id, code, name, value_kind)
   VALUES ($1, 'seats', 'Вместимость', 'number')`,
  [gearAxeId],
);

await check(
  'характеристика: отрицательный sort_order запрещён',
  'fail',
  `INSERT INTO gear_type_attributes (gear_type_id, code, name, value_kind, sort_order)
   VALUES ($1, 'negative_sort', 'Порядок', 'text', -1)`,
  [gearTentId],
);

/** Архив — это `UPDATE`, а не удаление: строка остаётся и держит код. */
await client.query(
  `UPDATE gear_type_attributes SET is_active = false WHERE id = $1`,
  [gearAttribute.id],
);
const archivedAttribute = await client.query(
  `SELECT is_active FROM gear_type_attributes WHERE id = $1`,
  [gearAttribute.id],
);
const archivedKept = archivedAttribute.rows[0]?.is_active === false;
if (!archivedKept) failed += 1;
rows.push([
  archivedKept ? 'ok' : 'АРХИВ НЕ СОХРАНИЛСЯ',
  'характеристика: архив — это is_active = false, строка остаётся',
  '',
]);

await check(
  'характеристика: архивная строка держит код (unique без WHERE is_active)',
  'fail',
  `INSERT INTO gear_type_attributes (gear_type_id, code, name, value_kind)
   VALUES ($1, 'seats', 'Тот же код после архива', 'number')`,
  [gearTentId],
);

// ─── Списки вариантов (30.10.2026) ───
/**
 * Четвёртый вид значения и его варианты.
 *
 * `allow_custom_value` осмыслен только у списка — флаг у числа или галочки
 * означал бы галочку, которая ничего не меняет. Правило держится CHECK-ом,
 * а не только API. Варианты: код латиницей, имя не из пробелов, порядок
 * не отрицательный, код уникален внутри характеристики **вместе
 * с архивными** строками — на код будут опираться фильтры Stage B.
 */
const gearSelectAttribute = (
  await client.query(
    `INSERT INTO gear_type_attributes (gear_type_id, code, name, value_kind)
     VALUES ($1, 'connection', 'Соединение', 'select')
     RETURNING id, allow_custom_value, is_active`,
    [gearTentId],
  )
).rows[0];

const selectDefaultsOk =
  gearSelectAttribute.allow_custom_value === false &&
  gearSelectAttribute.is_active === true;
if (!selectDefaultsOk) failed += 1;
rows.push([
  selectDefaultsOk ? 'ok' : 'НЕВЕРНЫЕ УМОЛЧАНИЯ',
  'характеристика: вид select разрешён, allow_custom_value по умолчанию false',
  '',
]);

await check(
  'характеристика: allow_custom_value у числа запрещён',
  'fail',
  `INSERT INTO gear_type_attributes (gear_type_id, code, name, value_kind, allow_custom_value)
   VALUES ($1, 'custom_number', 'Своё число', 'number', true)`,
  [gearTentId],
);

await check(
  'характеристика: allow_custom_value у галочки запрещён',
  'fail',
  `INSERT INTO gear_type_attributes (gear_type_id, code, name, value_kind, allow_custom_value)
   VALUES ($1, 'custom_bool', 'Своя галочка', 'bool', true)`,
  [gearTentId],
);

const gearCustomListId = (
  await client.query(
    `INSERT INTO gear_type_attributes (gear_type_id, code, name, value_kind, allow_custom_value)
     VALUES ($1, 'own_list', 'Свой список', 'select', true)
     RETURNING id`,
    [gearTentId],
  )
).rows[0].id;

const gearOption = (
  await client.query(
    `INSERT INTO gear_attribute_options (gear_type_attribute_id, code, name)
     VALUES ($1, 'thread', 'резьбовой')
     RETURNING id, is_active, sort_order`,
    [gearSelectAttribute.id],
  )
).rows[0];

const optionDefaultsOk =
  gearOption.is_active === true && gearOption.sort_order === 0;
if (!optionDefaultsOk) failed += 1;
rows.push([
  optionDefaultsOk ? 'ok' : 'НЕВЕРНЫЕ УМОЛЧАНИЯ',
  'вариант: is_active = true и sort_order = 0 по умолчанию',
  '',
]);

await check(
  'вариант: латинский код обязателен',
  'fail',
  `INSERT INTO gear_attribute_options (gear_type_attribute_id, code, name)
   VALUES ($1, 'Thread', 'резьбовой')`,
  [gearSelectAttribute.id],
);

await check(
  'вариант: код длиннее 40 символов запрещён',
  'fail',
  `INSERT INTO gear_attribute_options (gear_type_attribute_id, code, name)
   VALUES ($1, 'a' || repeat('b', 40), 'Длинный код')`,
  [gearSelectAttribute.id],
);

await check(
  'вариант: имя из пробелов запрещено (btrim)',
  'fail',
  `INSERT INTO gear_attribute_options (gear_type_attribute_id, code, name)
   VALUES ($1, 'blank_name', '   ')`,
  [gearSelectAttribute.id],
);

await check(
  'вариант: имя длиннее 100 символов запрещено',
  'fail',
  `INSERT INTO gear_attribute_options (gear_type_attribute_id, code, name)
   VALUES ($1, 'long_name', repeat('я', 101))`,
  [gearSelectAttribute.id],
);

await check(
  'вариант: отрицательный sort_order запрещён',
  'fail',
  `INSERT INTO gear_attribute_options (gear_type_attribute_id, code, name, sort_order)
   VALUES ($1, 'negative_sort', 'Порядок', -1)`,
  [gearSelectAttribute.id],
);

await check(
  'вариант: код повторно у той же характеристики запрещён',
  'fail',
  `INSERT INTO gear_attribute_options (gear_type_attribute_id, code, name)
   VALUES ($1, 'thread', 'резьбовой снова')`,
  [gearSelectAttribute.id],
);

await check(
  'вариант: тот же код у другой характеристики разрешён',
  'ok',
  `INSERT INTO gear_attribute_options (gear_type_attribute_id, code, name)
   VALUES ($1, 'thread', 'резьбовой')`,
  [gearCustomListId],
);

/** Архив — это `UPDATE`, а не удаление: строка остаётся и держит код. */
await client.query(
  `UPDATE gear_attribute_options SET is_active = false WHERE id = $1`,
  [gearOption.id],
);
const archivedOption = await client.query(
  `SELECT is_active FROM gear_attribute_options WHERE id = $1`,
  [gearOption.id],
);
const archivedOptionKept = archivedOption.rows[0]?.is_active === false;
if (!archivedOptionKept) failed += 1;
rows.push([
  archivedOptionKept ? 'ok' : 'АРХИВ НЕ СОХРАНИЛСЯ',
  'вариант: архив — это is_active = false, строка остаётся',
  '',
]);

await check(
  'вариант: архивная строка держит код (unique без WHERE is_active)',
  'fail',
  `INSERT INTO gear_attribute_options (gear_type_attribute_id, code, name)
   VALUES ($1, 'thread', 'Тот же код после архива')`,
  [gearSelectAttribute.id],
);

// Варианты вложены в характеристику: удаление типа уносит и их. Считаем
// до удаления и после — по id характеристик, которых к тому моменту уже
// не будет, поэтому id запоминаем заранее.
const optionAttributeIds = [gearSelectAttribute.id, gearCustomListId];
const optionCountBefore = await client.query(
  `SELECT count(*)::int AS count
     FROM gear_attribute_options
    WHERE gear_type_attribute_id = ANY($1::int[])`,
  [optionAttributeIds],
);

const attributeCountBefore = await client.query(
  `SELECT count(*)::int AS count FROM gear_type_attributes WHERE gear_type_id = $1`,
  [gearTentId],
);
await client.query(`DELETE FROM gear_types WHERE id = $1`, [gearTentId]);
const attributeCountAfter = await client.query(
  `SELECT count(*)::int AS count FROM gear_type_attributes WHERE gear_type_id = $1`,
  [gearTentId],
);
const attributesCascadeClean =
  attributeCountBefore.rows[0].count > 0 &&
  attributeCountAfter.rows[0].count === 0;
if (!attributesCascadeClean) failed += 1;
rows.push([
  attributesCascadeClean ? 'ok' : 'ОСТАЛИСЬ ХАРАКТЕРИСТИКИ',
  `тип: удаление уносит характеристики (CASCADE, было ${attributeCountBefore.rows[0].count})`,
  '',
]);

const optionCountAfter = await client.query(
  `SELECT count(*)::int AS count
     FROM gear_attribute_options
    WHERE gear_type_attribute_id = ANY($1::int[])`,
  [optionAttributeIds],
);
const optionsCascadeClean =
  optionCountBefore.rows[0].count > 0 && optionCountAfter.rows[0].count === 0;
if (!optionsCascadeClean) failed += 1;
rows.push([
  optionsCascadeClean ? 'ok' : 'ОСТАЛИСЬ ВАРИАНТЫ',
  `тип: удаление уносит и варианты списков (CASCADE, было ${optionCountBefore.rows[0].count})`,
  '',
]);

await client.query(`DELETE FROM gear_types WHERE id = $1`, [gearAxeId]);

// ─── Вещь, её тип и значения характеристик ───
/**
 * Инварианты `gear_items` и `gear_item_attributes` (Stage B, часть 1).
 *
 * Проверяется то, из-за чего данные придётся чинить руками: вещь без типа,
 * тип, которого нет, «две вместимости у одной палатки» и значение
 * не в своей колонке. Отдельно — **форма таблицы**: вида `kind` больше нет,
 * а `gear_type_id` обязателен; удаление вещи уносит значения (`CASCADE`),
 * а тип с вещами не удаляется (`RESTRICT`) — иначе палатка осталась бы
 * без типа молча.
 */
const gearShape = await client.query(
  `SELECT column_name, is_nullable
     FROM information_schema.columns
    WHERE table_name = 'gear_items'
      AND column_name IN ('kind', 'gear_type_id')
    ORDER BY column_name`,
);
const gearShapeOk =
  gearShape.rows.length === 1 &&
  gearShape.rows[0].column_name === 'gear_type_id' &&
  gearShape.rows[0].is_nullable === 'NO';
if (!gearShapeOk) failed += 1;
rows.push([
  gearShapeOk ? 'ok' : 'СТАРАЯ СХЕМА',
  'вещь: вида kind нет, gear_type_id обязателен',
  `колонки: ${gearShape.rows.map((row) => `${row.column_name}(${row.is_nullable})`).join(', ') || 'нет'}`,
]);

const itemTypeId = (
  await client.query(
    `INSERT INTO gear_types (code, name)
     VALUES ('e2e_check_item_type', 'Проверочный тип вещи')
     RETURNING id`,
  )
).rows[0].id;

const itemSeatsId = (
  await client.query(
    `INSERT INTO gear_type_attributes (gear_type_id, code, name, value_kind)
     VALUES ($1, 'seats', 'Вместимость', 'number')
     RETURNING id`,
    [itemTypeId],
  )
).rows[0].id;

const itemModelId = (
  await client.query(
    `INSERT INTO gear_type_attributes (gear_type_id, code, name, value_kind)
     VALUES ($1, 'model', 'Модель', 'text')
     RETURNING id`,
    [itemTypeId],
  )
).rows[0].id;

// ─── Группы снаряжения (31.10.2026) ───
/**
 * Инварианты `gear_groups` и полки у вещи.
 *
 * Проверяется то, что держит каталог собранным: **группа у вещи
 * обязательна** (иначе вещь выпала бы из секций), **группа с вещами
 * не удаляется** (`RESTRICT`), **код — контракт** (латиница, уникален
 * даже у архивной строки), а **порядок** — неотрицательное число.
 * Отдельно — «Прочее»: умолчание API, без него `POST /api/gear` без
 * `groupId` некуда положить вещь.
 */
const groupShape = await client.query(
  `SELECT column_name, is_nullable, column_default
     FROM information_schema.columns
    WHERE table_name = 'gear_groups'
      AND column_name IN ('code', 'name', 'is_active', 'sort_order')
    ORDER BY column_name`,
);
const groupShapeByName = new Map(
  groupShape.rows.map((row) => [row.column_name, row]),
);
const groupShapeOk =
  groupShape.rows.length === 4 &&
  groupShapeByName.get('code')?.is_nullable === 'NO' &&
  groupShapeByName.get('name')?.is_nullable === 'NO' &&
  groupShapeByName.get('is_active')?.is_nullable === 'NO' &&
  (groupShapeByName.get('is_active')?.column_default ?? '').includes('true') &&
  groupShapeByName.get('sort_order')?.is_nullable === 'NO' &&
  (groupShapeByName.get('sort_order')?.column_default ?? '').includes('0');
if (!groupShapeOk) failed += 1;
rows.push([
  groupShapeOk ? 'ok' : 'СТАРАЯ СХЕМА',
  'группа: code/name обязательны, is_active=true и sort_order=0 по умолчанию',
  `колонки: ${groupShape.rows
    .map((row) => `${row.column_name}(${row.is_nullable})`)
    .join(', ') || 'нет'}`,
]);

const defaultGroup = await client.query(
  `SELECT id FROM gear_groups WHERE code = 'other'`,
);
const defaultGroupId = defaultGroup.rows[0]?.id;
const defaultGroupOk = defaultGroupId !== undefined;
if (!defaultGroupOk) failed += 1;
rows.push([
  defaultGroupOk ? 'ok' : 'НЕТ ГРУППЫ ПО УМОЛЧАНИЮ',
  'группа: «Прочее» (other) заведена — умолчание для вещи без полки',
  '',
]);

const groupItemShape = await client.query(
  `SELECT column_name, is_nullable, column_default
     FROM information_schema.columns
    WHERE table_name = 'gear_items'
      AND column_name IN ('group_id', 'sort_order')
    ORDER BY column_name`,
);
const groupItemShapeByName = new Map(
  groupItemShape.rows.map((row) => [row.column_name, row]),
);
const groupItemShapeOk =
  groupItemShape.rows.length === 2 &&
  groupItemShapeByName.get('group_id')?.is_nullable === 'NO' &&
  groupItemShapeByName.get('sort_order')?.is_nullable === 'NO' &&
  (groupItemShapeByName.get('sort_order')?.column_default ?? '').includes('0');
if (!groupItemShapeOk) failed += 1;
rows.push([
  groupItemShapeOk ? 'ok' : 'СТАРАЯ СХЕМА',
  'вещь: group_id обязателен, sort_order=0 по умолчанию',
  `колонки: ${groupItemShape.rows
    .map((row) => `${row.column_name}(${row.is_nullable})`)
    .join(', ') || 'нет'}`,
]);

const groupIndexName = 'IDX_gear_items_owner_order';
const groupIndex = await client.query(
  `SELECT indexdef FROM pg_indexes WHERE indexname = $1`,
  [groupIndexName],
);
const groupIndexDef = groupIndex.rows[0]?.indexdef ?? '';
const groupIndexOk =
  groupIndex.rowCount === 1 &&
  groupIndexDef.includes('group_id') &&
  groupIndexDef.includes('sort_order');
if (!groupIndexOk) failed += 1;
rows.push([
  groupIndexOk ? 'ok' : 'НЕТ ИНДЕКСА',
  'вещь: каталог читается по группе и личному порядку — индекс',
  groupIndexDef,
]);

const testGroupId = (
  await client.query(
    `INSERT INTO gear_groups (code, name, sort_order)
     VALUES ('e2e_check_group', 'Проверочная группа', 50)
     RETURNING id`,
  )
).rows[0].id;

await check(
  'группа: кириллица в коде запрещена (CHECK)',
  'fail',
  `INSERT INTO gear_groups (code, name) VALUES ('Проверочная', 'Кириллица')`,
);

await check(
  'группа: пустое имя запрещено (CHECK)',
  'fail',
  `INSERT INTO gear_groups (code, name) VALUES ('e2e_check_group_empty', '   ')`,
);

await check(
  'группа: отрицательный порядок запрещён (CHECK)',
  'fail',
  `INSERT INTO gear_groups (code, name, sort_order)
   VALUES ('e2e_check_group_sort', 'Минус', -10)`,
);

await check(
  'группа: код уникален, в том числе с архивными строками',
  'fail',
  `INSERT INTO gear_groups (code, name) VALUES ('e2e_check_group', 'Дубль')`,
);

const groupItemId = (
  await client.query(
    `INSERT INTO gear_items (owner_user_id, gear_type_id, group_id, title)
     VALUES ($1, $2, $3, 'Вещь в проверочной группе')
     RETURNING id`,
    [user1, itemTypeId, testGroupId],
  )
).rows[0].id;

await check(
  'вещь: без группы не создаётся (NOT NULL)',
  'fail',
  `INSERT INTO gear_items (owner_user_id, gear_type_id, title)
   VALUES ($1, $2, 'Вещь без полки')`,
  [user1, itemTypeId],
);

await check(
  'вещь: отрицательный личный порядок запрещён (CHECK)',
  'fail',
  `UPDATE gear_items SET sort_order = -10 WHERE id = $1`,
  [groupItemId],
);

await check(
  'группа: с вещами не удаляется (RESTRICT)',
  'fail',
  `DELETE FROM gear_groups WHERE id = $1`,
  [testGroupId],
);

await check(
  'группа: архив при вещах разрешён — вещь остаётся на месте',
  'ok',
  `UPDATE gear_groups SET is_active = false WHERE id = $1`,
  [testGroupId],
);

await client.query(`DELETE FROM gear_items WHERE id = $1`, [groupItemId]);
await client.query(`DELETE FROM gear_groups WHERE id = $1`, [testGroupId]);

const itemId = (
  await client.query(
    `INSERT INTO gear_items (owner_user_id, gear_type_id, group_id, title)
     VALUES ($1, $2, $3, 'Проверочная палатка')
     RETURNING id`,
    [user1, itemTypeId, defaultGroupId],
  )
).rows[0].id;

await check(
  'вещь: без типа не создаётся (NOT NULL)',
  'fail',
  `INSERT INTO gear_items (owner_user_id, title) VALUES ($1, 'Вещь без типа')`,
  [user1],
);

await check(
  'вещь: несуществующий тип запрещён (внешний ключ)',
  'fail',
  `INSERT INTO gear_items (owner_user_id, gear_type_id, group_id, title)
   VALUES ($1, 2147483000, $2, 'Вещь с чужим типом')`,
  [user1, defaultGroupId],
);

await check(
  'вещь: колонки kind больше нет',
  'fail',
  `INSERT INTO gear_items (owner_user_id, gear_type_id, title, kind)
   VALUES ($1, $2, 'Вещь по-старому', 'tent')`,
  [user1, itemTypeId],
);

await check(
  'тип: с вещами не удаляется (RESTRICT)',
  'fail',
  `DELETE FROM gear_types WHERE id = $1`,
  [itemTypeId],
);

await check(
  'значение: число у числовой характеристики записывается',
  'ok',
  `INSERT INTO gear_item_attributes
     (gear_item_id, gear_type_attribute_id, number_value)
   VALUES ($1, $2, 3)`,
  [itemId, itemSeatsId],
);

await check(
  'значение: две вместимости у одной вещи запрещены (unique)',
  'fail',
  `INSERT INTO gear_item_attributes
     (gear_item_id, gear_type_attribute_id, number_value)
   VALUES ($1, $2, 4)`,
  [itemId, itemSeatsId],
);

await check(
  'значение: два значения сразу запрещены (num_nonnulls)',
  'fail',
  `INSERT INTO gear_item_attributes
     (gear_item_id, gear_type_attribute_id, number_value, text_value)
   VALUES ($1, $2, 3, 'MSR')`,
  [itemId, itemModelId],
);

await check(
  'значение: пустое значение запрещено (num_nonnulls)',
  'fail',
  `INSERT INTO gear_item_attributes
     (gear_item_id, gear_type_attribute_id)
   VALUES ($1, $2)`,
  [itemId, itemModelId],
);

await check(
  'значение: текст из пробелов запрещён (btrim)',
  'fail',
  `INSERT INTO gear_item_attributes
     (gear_item_id, gear_type_attribute_id, text_value)
   VALUES ($1, $2, '   ')`,
  [itemId, itemModelId],
);

await check(
  'значение: текст записывается',
  'ok',
  `INSERT INTO gear_item_attributes
     (gear_item_id, gear_type_attribute_id, text_value)
   VALUES ($1, $2, 'MSR')`,
  [itemId, itemModelId],
);

// Каскады считаем вручную: `check()` откатывает упавшие вставки, а тут
// нужны две успешные операции подряд и сравнение до/после.
const valuesBeforeItemDelete = await client.query(
  `SELECT count(*)::int AS count FROM gear_item_attributes WHERE gear_item_id = $1`,
  [itemId],
);
await client.query(`DELETE FROM gear_items WHERE id = $1`, [itemId]);
const valuesAfterItemDelete = await client.query(
  `SELECT count(*)::int AS count FROM gear_item_attributes WHERE gear_item_id = $1`,
  [itemId],
);
const valuesCascadeClean =
  valuesBeforeItemDelete.rows[0].count === 2 &&
  valuesAfterItemDelete.rows[0].count === 0;
if (!valuesCascadeClean) failed += 1;
rows.push([
  valuesCascadeClean ? 'ok' : 'ОСТАЛИСЬ ЗНАЧЕНИЯ',
  `вещь: удаление уносит значения (CASCADE, было ${valuesBeforeItemDelete.rows[0].count})`,
  '',
]);

const modelItemId = (
  await client.query(
    `INSERT INTO gear_items (owner_user_id, gear_type_id, group_id, title)
     VALUES ($1, $2, $3, 'Проверочная модель')
     RETURNING id`,
    [user1, itemTypeId, defaultGroupId],
  )
).rows[0].id;
await client.query(
  `INSERT INTO gear_item_attributes
     (gear_item_id, gear_type_attribute_id, text_value)
   VALUES ($1, $2, 'Naturehike')`,
  [modelItemId, itemModelId],
);
await client.query(`DELETE FROM gear_type_attributes WHERE id = $1`, [
  itemModelId,
]);
const valuesAfterAttributeDelete = await client.query(
  `SELECT count(*)::int AS count
     FROM gear_item_attributes
    WHERE gear_type_attribute_id = $1`,
  [itemModelId],
);
const attributeCascadeClean = valuesAfterAttributeDelete.rows[0].count === 0;
if (!attributeCascadeClean) failed += 1;
rows.push([
  attributeCascadeClean ? 'ok' : 'ОСТАЛИСЬ ЗНАЧЕНИЯ',
  'характеристика: удаление уносит значения (CASCADE)',
  '',
]);

await client.query(`DELETE FROM gear_items WHERE id = $1`, [modelItemId]);
await client.query(`DELETE FROM gear_types WHERE id = $1`, [itemTypeId]);

// ─── Люди без аккаунта и одноразовое снаряжение (31.10.2026) ───
/**
 * Инварианты виртуальных участников (`users.is_virtual`,
 * `users.virtual_owner_user_id`) и одноразовых вещей
 * (`gear_items.is_trip_only`) — задание `docs/ph/virtual-participants.md`.
 *
 * Проверяется то, что нельзя доказать обычным тестом поведения: правило
 * «одно без другого нельзя» живёт в CHECK, «создателя не теряем» —
 * во внешнем ключе, а частичный индекс «мои виртуальные» — в базе. Если
 * из базы убрать CHECK, тесты API останутся зелёными, а данные поедут:
 * именно так однажды и пропустил мусор CHECK спортивного вида с NULL.
 *
 * «Виртуальный не может войти» проверяется здесь буквально: у него нет
 * строки в `auth_identities`, и API не заводит её ни одной ручкой. Это
 * не схема, а связка двух таблиц, поэтому проверка стоит рядом.
 */
const usersShape = await client.query(
  `SELECT column_name, is_nullable, column_default
     FROM information_schema.columns
    WHERE table_name = 'users'
      AND column_name IN ('is_virtual', 'virtual_owner_user_id')
    ORDER BY column_name`,
);
const usersShapeByName = new Map(
  usersShape.rows.map((row) => [row.column_name, row]),
);
const virtualShapeOk =
  usersShape.rows.length === 2 &&
  usersShapeByName.get('is_virtual')?.is_nullable === 'NO' &&
  (usersShapeByName.get('is_virtual')?.column_default ?? '').includes('false') &&
  usersShapeByName.get('virtual_owner_user_id')?.is_nullable === 'YES';
if (!virtualShapeOk) failed += 1;
rows.push([
  virtualShapeOk ? 'ok' : 'СТАРАЯ СХЕМА',
  'виртуальный: is_virtual (NOT NULL, default false) и создатель (nullable)',
  `колонки: ${usersShape.rows
    .map((row) => `${row.column_name}(${row.is_nullable})`)
    .join(', ') || 'нет'}`,
]);

const tripOnlyShape = await client.query(
  `SELECT is_nullable, column_default
     FROM information_schema.columns
    WHERE table_name = 'gear_items' AND column_name = 'is_trip_only'`,
);
const tripOnlyShapeOk =
  tripOnlyShape.rowCount === 1 &&
  tripOnlyShape.rows[0].is_nullable === 'NO' &&
  (tripOnlyShape.rows[0].column_default ?? '').includes('false');
if (!tripOnlyShapeOk) failed += 1;
rows.push([
  tripOnlyShapeOk ? 'ok' : 'СТАРАЯ СХЕМА',
  'вещь: is_trip_only (NOT NULL, default false)',
  tripOnlyShape.rowCount === 0 ? 'колонки нет' : '',
]);

const virtualIndexName = 'IDX_users_virtual_owner';
const virtualIndex = await client.query(
  `SELECT indexdef FROM pg_indexes WHERE indexname = $1`,
  [virtualIndexName],
);
const virtualIndexDef = virtualIndex.rows[0]?.indexdef ?? '';
const virtualIndexOk =
  virtualIndex.rowCount === 1 &&
  virtualIndexDef.includes('virtual_owner_user_id') &&
  /WHERE/i.test(virtualIndexDef);
if (!virtualIndexOk) failed += 1;
rows.push([
  virtualIndexOk ? 'ok' : 'НЕТ ИНДЕКСА',
  'виртуальный: «мои люди без аккаунта» — частичный индекс',
  virtualIndexDef,
]);

const tripOnlyIndexName = 'IDX_gear_items_owner_trip_only';
const tripOnlyIndex = await client.query(
  `SELECT indexdef FROM pg_indexes WHERE indexname = $1`,
  [tripOnlyIndexName],
);
const tripOnlyIndexOk =
  tripOnlyIndex.rowCount === 1 &&
  (tripOnlyIndex.rows[0]?.indexdef ?? '').includes('is_trip_only');
if (!tripOnlyIndexOk) failed += 1;
rows.push([
  tripOnlyIndexOk ? 'ok' : 'НЕТ ИНДЕКСА',
  'вещь: каталог и одноразовые читаются разными запросами',
  tripOnlyIndex.rows[0]?.indexdef ?? '',
]);

const virtualOwnerId = (
  await client.query(
    `INSERT INTO users (display_name) VALUES ('Проверочный организатор')
     RETURNING id`,
  )
).rows[0].id;

const virtualUserId = (
  await client.query(
    `INSERT INTO users (display_name, is_virtual, virtual_owner_user_id)
     VALUES ('Дядя Витя', true, $1) RETURNING id`,
    [virtualOwnerId],
  )
).rows[0].id;

await check(
  'виртуальный: без создателя не создаётся (CHECK)',
  'fail',
  `INSERT INTO users (display_name, is_virtual) VALUES ('Без создателя', true)`,
);

await check(
  'виртуальный: создатель без флага не создаётся (CHECK)',
  'fail',
  `INSERT INTO users (display_name, virtual_owner_user_id)
   VALUES ('Флаг забыли', $1)`,
  [virtualOwnerId],
);

await check(
  'виртуальный: несуществующий создатель запрещён (внешний ключ)',
  'fail',
  `INSERT INTO users (display_name, is_virtual, virtual_owner_user_id)
   VALUES ('Чужой создатель', true, '00000000-0000-0000-0000-000000000000')`,
);

await check(
  'виртуальный: создатель с виртуальными не удаляется (RESTRICT)',
  'fail',
  `DELETE FROM users WHERE id = $1`,
  [virtualOwnerId],
);

const virtualIdentity = await client.query(
  `SELECT count(*)::int AS count FROM auth_identities WHERE user_id = $1`,
  [virtualUserId],
);
const virtualIdentityOk = virtualIdentity.rows[0].count === 0;
if (!virtualIdentityOk) failed += 1;
rows.push([
  virtualIdentityOk ? 'ok' : 'МОЖЕТ ВОЙТИ',
  'виртуальный: без входа — строки в auth_identities нет',
  '',
]);

const manualTypeId = (
  await client.query(
    `INSERT INTO gear_types (code, name)
     VALUES ('e2e_check_manual_type', 'Проверочный тип вручную')
     RETURNING id`,
  )
).rows[0].id;

const defaultTripOnly = await client.query(
  `INSERT INTO gear_items (owner_user_id, gear_type_id, group_id, title)
   VALUES ($1, $2, $3, 'Обычная вещь каталога')
   RETURNING is_trip_only`,
  [user2, manualTypeId, defaultGroupId],
);
const defaultTripOnlyOk = defaultTripOnly.rows[0].is_trip_only === false;
if (!defaultTripOnlyOk) failed += 1;
rows.push([
  defaultTripOnlyOk ? 'ok' : 'СТАРАЯ СХЕМА',
  'вещь: без флага вещь принадлежит каталогу (default false)',
  '',
]);

await check(
  'вещь: одноразовую вещь может держать человек без аккаунта',
  'ok',
  `INSERT INTO gear_items (owner_user_id, gear_type_id, group_id, title, is_trip_only)
   VALUES ($1, $2, $3, 'Бутылка бензина', true)`,
  [virtualUserId, manualTypeId, defaultGroupId],
);

// ─── Таблица ночёвок: ночи, варианты и кто где живёт (31.10.2026) ───
/**
 * Инварианты «Ночёвок» (`docs/ph/NEXT.md` §3, решения 31.10.2026): ночь,
 * варианты ночи и место жительства.
 *
 * Проверяется то, чего не видно из API: правило «ссылка есть ровно у того
 * варианта, которому она нужна» живёт в CHECK, «одно место на поход» —
 * в уникальном ключе, «палатка из чужого похода не приедет» — в составном
 * внешнем ключе, уборка — в каскадах. Тесты API останутся зелёными, если
 * из базы убрать CHECK, — а данные поедут. Ровно так уже случалось
 * с видом снаряжения.
 */
const routeShape = await client.query(
  `SELECT table_name
     FROM information_schema.tables
    WHERE table_name IN ('trip_route_nights', 'trip_route_options',
                         'trip_route_lodgers')`,
);
const routeShapeOk = routeShape.rowCount === 3;
if (!routeShapeOk) failed += 1;
rows.push([
  routeShapeOk ? 'ok' : 'СТАРАЯ СХЕМА',
  'ночёвки: таблицы ночей, вариантов и мест жительства',
  routeShape.rows.map((row) => row.table_name).join(', ') || 'таблиц нет',
]);

/**
 * Свой поход для блока ночёвок: основной `tripId` скрипта к этому месту
 * уже удалён проверкой каскадов, поэтому «ночной» поход заводится здесь же
 * (id переиспользуется, чтобы остальные проверки блока читались прежними).
 * Состав — раньше снаряжения: `trip_gear.owner_user_id` ссылается
 * на участника, и «вещь не участника похода» база не примет.
 */
const routeObjectId = (
  await client.query(
    `INSERT INTO objects (name, type)
     VALUES ('Перевал проверки ночёвок', 'перевал') RETURNING id`,
  )
).rows[0].id;

await client.query(
  `INSERT INTO trips (id, organizer_user_id, goal_object_id)
   VALUES ($1, $2, $3)`,
  [tripId, user1, routeObjectId],
);

await client.query(
  `INSERT INTO trip_participants (trip_id, user_id, status)
   VALUES ($1, $2, 'going'), ($1, $3, 'going')
   ON CONFLICT (trip_id, user_id) DO NOTHING`,
  [tripId, user1, user2],
);

const routeTentTypeId = (
  await client.query(
    `INSERT INTO gear_types (code, name)
     VALUES ('check_route_tent', 'Палатка проверки ночёвок') RETURNING id`,
  )
).rows[0].id;

const routeAxeTypeId = (
  await client.query(
    `INSERT INTO gear_types (code, name)
     VALUES ('check_route_axe', 'Топор проверки ночёвок') RETURNING id`,
  )
).rows[0].id;

const routeTentItemId = (
  await client.query(
    `INSERT INTO gear_items (owner_user_id, gear_type_id, group_id, title)
     VALUES ($1, $2, $3, 'Палатка проверки') RETURNING id`,
    [user1, routeTentTypeId, defaultGroupId],
  )
).rows[0].id;

const routeAxeItemId = (
  await client.query(
    `INSERT INTO gear_items (owner_user_id, gear_type_id, group_id, title)
     VALUES ($1, $2, $3, 'Топор проверки') RETURNING id`,
    [user1, routeAxeTypeId, defaultGroupId],
  )
).rows[0].id;

const routeTentGearId = (
  await client.query(
    `INSERT INTO trip_gear (trip_id, gear_item_id, owner_user_id, status)
     VALUES ($1, $2, $3, 'approved') RETURNING id`,
    [tripId, routeTentItemId, user1],
  )
).rows[0].id;

await client.query(
  `INSERT INTO trip_gear (trip_id, gear_item_id, owner_user_id, status)
   VALUES ($1, $2, $3, 'approved')`,
  [tripId, routeAxeItemId, user1],
);

await client.query(
  `INSERT INTO trip_transfer_legs
     (trip_id, direction, departs_at, from_place, to_place, mode,
      is_own_vehicle, owner_user_id, seats)
   VALUES ($1, 'there', now(), 'Иркутск', 'Ольхон', 'car', true, $2, 4)`,
  [tripId, user1],
);

const routeNightId = (
  await client.query(
    `INSERT INTO trip_route_nights (trip_id, position, place)
     VALUES ($1, 1, 'Ольхон, у скалы') RETURNING id`,
    [tripId],
  )
).rows[0].id;

await client.query(
  `INSERT INTO trip_route_options (trip_id, night_id, kind, tent_gear_id, cooking)
   VALUES ($1, $2, 'tent', $3, 'fire')`,
  [tripId, routeNightId, routeTentGearId],
);

await check(
  'ночёвки: номер ночи начинается с 1',
  'fail',
  `INSERT INTO trip_route_nights (trip_id, position) VALUES ($1, 0)`,
  [tripId],
);

await check(
  'ночёвки: две «ночи 1» в походе невозможны',
  'fail',
  `INSERT INTO trip_route_nights (trip_id, position) VALUES ($1, 1)`,
  [tripId],
);

await check(
  'ночёвки: место — не длиннее 120 знаков',
  'fail',
  `INSERT INTO trip_route_nights (trip_id, position, place)
   VALUES ($1, 9, repeat('я', 121))`,
  [tripId],
);

await check(
  'ночёвки: «палатка» без палатки запрещена',
  'fail',
  `INSERT INTO trip_route_options (trip_id, night_id, kind)
   VALUES ($1, $2, 'tent')`,
  [tripId, routeNightId],
);

await check(
  'ночёвки: «гостиница» со ссылкой на палатку запрещена',
  'fail',
  `INSERT INTO trip_route_options (trip_id, night_id, kind, tent_gear_id)
   VALUES ($1, $2, 'hotel', $3)`,
  [tripId, routeNightId, routeTentGearId],
);

await check(
  'ночёвки: «машина» без карточки ТС запрещена',
  'fail',
  `INSERT INTO trip_route_options (trip_id, night_id, kind)
   VALUES ($1, $2, 'car')`,
  [tripId, routeNightId],
);

await check(
  'ночёвки: готовка у гостиницы запрещена',
  'fail',
  `INSERT INTO trip_route_options (trip_id, night_id, kind, cooking)
   VALUES ($1, $2, 'hotel', 'fire')`,
  [tripId, routeNightId],
);

await check(
  'ночёвки: вид ночи — только из словаря',
  'fail',
  `INSERT INTO trip_route_options (trip_id, night_id, kind)
   VALUES ($1, $2, 'spaceship')`,
  [tripId, routeNightId],
);

await check(
  'ночёвки: одна палатка в ночи — одна строка',
  'fail',
  `INSERT INTO trip_route_options (trip_id, night_id, kind, tent_gear_id)
   VALUES ($1, $2, 'tent', $3)`,
  [tripId, routeNightId, routeTentGearId],
);

await check(
  'ночёвки: готовка у избы разрешена',
  'ok',
  `INSERT INTO trip_route_options (trip_id, night_id, kind, cooking)
   VALUES ($1, $2, 'hut', 'both')`,
  [tripId, routeNightId],
);

/**
 * Палатка того же каталога, но взятого в другой поход: составной ключ
 * `(trip_id, tent_gear_id)` не пускает её в эту ночь. Одного внешнего
 * ключа по `tent_gear_id` мало — он бы пропустил чужую строку.
 */
const routeOtherTripId = (
  await client.query(
    `INSERT INTO trips (organizer_user_id, goal_object_id)
     SELECT $1, goal_object_id FROM trips WHERE id = $2 RETURNING id`,
    [user1, tripId],
  )
).rows[0].id;

// В чужом походе нужен свой участник: `trip_gear.owner_user_id` ссылается
// на состав именно этого похода.
await client.query(
  `INSERT INTO trip_participants (trip_id, user_id, status)
   VALUES ($1, $2, 'going')
   ON CONFLICT (trip_id, user_id) DO NOTHING`,
  [routeOtherTripId, user1],
);

const routeForeignGearId = (
  await client.query(
    `INSERT INTO trip_gear (trip_id, gear_item_id, owner_user_id, status)
     VALUES ($1, $2, $3, 'approved') RETURNING id`,
    [routeOtherTripId, routeTentItemId, user1],
  )
).rows[0].id;

await check(
  'ночёвки: палатка из чужого похода не принимается (составной ключ)',
  'fail',
  `INSERT INTO trip_route_options (trip_id, night_id, kind, tent_gear_id)
   VALUES ($1, $2, 'tent', $3)`,
  [tripId, routeNightId, routeForeignGearId],
);

await client.query(
  `INSERT INTO trip_route_lodgers (trip_id, user_id, tent_gear_id, status)
   VALUES ($1, $2, $3, 'accepted')`,
  [tripId, user1, routeTentGearId],
);

await check(
  'ночёвки: у человека одно место на поход',
  'fail',
  `INSERT INTO trip_route_lodgers (trip_id, user_id, tent_gear_id)
   VALUES ($1, $2, $3)`,
  [tripId, user1, routeTentGearId],
);

await check(
  'ночёвки: статус места — только «заявка» или «живёт»',
  'fail',
  `INSERT INTO trip_route_lodgers (trip_id, user_id, tent_gear_id, status)
   VALUES ($1, $2, $3, 'sleeping')`,
  [tripId, user2, routeTentGearId],
);

await check(
  'ночёвки: жить в палатке может только участник похода',
  'fail',
  `INSERT INTO trip_route_lodgers (trip_id, user_id, tent_gear_id)
   VALUES ($1, '00000000-0000-0000-0000-000000000000', $2)`,
  [tripId, routeTentGearId],
);

await client.query(
  `INSERT INTO trip_route_lodgers (trip_id, user_id, tent_gear_id)
   VALUES ($1, $2, $3)`,
  [tripId, user2, routeTentGearId],
);

// Убрали ночь — ушли её варианты.
const routeExtraNightId = (
  await client.query(
    `INSERT INTO trip_route_nights (trip_id, position)
     VALUES ($1, 2) RETURNING id`,
    [tripId],
  )
).rows[0].id;

await client.query(
  `INSERT INTO trip_route_options (trip_id, night_id, kind)
   VALUES ($1, $2, 'allnight')`,
  [tripId, routeExtraNightId],
);
await client.query(`DELETE FROM trip_route_nights WHERE id = $1`, [
  routeExtraNightId,
]);

const routeOptionsLeft = (
  await client.query(
    `SELECT count(*)::int AS count FROM trip_route_options
      WHERE night_id = $1`,
    [routeExtraNightId],
  )
).rows[0].count;

if (routeOptionsLeft !== 0) failed += 1;
rows.push([
  routeOptionsLeft === 0 ? 'ok' : 'ОСТАЛИСЬ ВАРИАНТЫ',
  'ночёвки: убрали ночь — ушли её варианты (каскад)',
  routeOptionsLeft === 0 ? '' : `осталось ${routeOptionsLeft}`,
]);

// Убрали палатку из похода — ушёл вариант ночи и место живущего.
await client.query(`DELETE FROM trip_gear WHERE id = $1`, [routeTentGearId]);

const routeTentOptionsLeft = (
  await client.query(
    `SELECT count(*)::int AS count FROM trip_route_options
      WHERE tent_gear_id = $1`,
    [routeTentGearId],
  )
).rows[0].count;
const routeLodgersLeft = (
  await client.query(
    `SELECT count(*)::int AS count FROM trip_route_lodgers
      WHERE tent_gear_id = $1`,
    [routeTentGearId],
  )
).rows[0].count;
const routeGearCascadeOk = routeTentOptionsLeft === 0 && routeLodgersLeft === 0;
if (!routeGearCascadeOk) failed += 1;
rows.push([
  routeGearCascadeOk ? 'ok' : 'ОСТАЛИСЬ СТРОКИ',
  'ночёвки: убрали палатку из похода — ушёл вариант и место живущего',
  routeGearCascadeOk
    ? ''
    : `вариантов ${routeTentOptionsLeft}, мест ${routeLodgersLeft}`,
]);

await check(
  'ночёвки: вариант машины ссылается на карточку из этого похода',
  'fail',
  `INSERT INTO trip_route_options (trip_id, night_id, kind, car_leg_id)
   VALUES ($1, $2, 'car', 999999999)`,
  [tripId, routeNightId],
);

// ─── Чек-листы: пункт-ссылка на вещь (31.10.2026) ───
/**
 * Инварианты `checklist_items.gear_item_id`.
 *
 * Проверяется то, чего не видно в e2e: **форма схемы** (колонка, внешний
 * ключ `SET NULL`, индекс под триггер и сам триггер) и **поведение удаления
 * вещи** — пункт не исчезает, а становится текстом имени типа. Поведение
 * проверяется прямо здесь, потому что триггер живёт в базе: подмени его
 * сервисом — и каскадное удаление вещи похода снова оставит ссылку в никуда.
 */
const checklistGearShape = await client.query(
  `SELECT
     (SELECT is_nullable FROM information_schema.columns
       WHERE table_name = 'checklist_items' AND column_name = 'gear_item_id') AS nullable,
     (SELECT confdeltype FROM pg_constraint
       WHERE conname = 'FK_checklist_items_gear_item') AS delete_action,
     (SELECT 1 FROM pg_indexes
       WHERE indexname = 'IDX_checklist_items_gear') AS has_index,
     (SELECT 1 FROM pg_trigger
       WHERE tgname = 'trg_gear_items_unlink_checklists') AS has_trigger`,
);

const checklistGearShapeRow = checklistGearShape.rows[0];
const checklistGearShapeOk =
  checklistGearShapeRow.nullable === 'YES' &&
  // «n» — ON DELETE SET NULL: страховка уровня FK, если триггер снимут.
  checklistGearShapeRow.delete_action === 'n' &&
  checklistGearShapeRow.has_index === 1 &&
  checklistGearShapeRow.has_trigger === 1;

if (!checklistGearShapeOk) failed += 1;
rows.push([
  checklistGearShapeOk ? 'ok' : 'НЕТ СХЕМЫ',
  'чек-листы: пункт ссылается на вещь (колонка, SET NULL, индекс, триггер)',
  checklistGearShapeOk
    ? ''
    : `nullable=${checklistGearShapeRow.nullable}, fk=${checklistGearShapeRow.delete_action}, index=${checklistGearShapeRow.has_index}, trigger=${checklistGearShapeRow.has_trigger}`,
]);

const checklistTypeId = (
  await client.query(
    `INSERT INTO gear_types (code, name)
     VALUES ('check_checklist_type', 'Тип пункта проверки') RETURNING id`,
  )
).rows[0].id;

const checklistGearItemId = (
  await client.query(
    `INSERT INTO gear_items (owner_user_id, gear_type_id, group_id, title)
     VALUES ($1, $2, $3, 'Вещь пункта') RETURNING id`,
    [user1, checklistTypeId, defaultGroupId],
  )
).rows[0].id;

const checklistListId = (
  await client.query(
    `INSERT INTO checklists (scope, owner_user_id, title)
     VALUES ('template', $1, 'Проверка ссылки') RETURNING id`,
    [user1],
  )
).rows[0].id;

const checklistItemId = (
  await client.query(
    `INSERT INTO checklist_items (checklist_id, title, gear_item_id)
     VALUES ($1, 'Вещь пункта', $2) RETURNING id`,
    [checklistListId, checklistGearItemId],
  )
).rows[0].id;

await client.query(`DELETE FROM gear_items WHERE id = $1`, [checklistGearItemId]);

const checklistUnlinked = (
  await client.query(
    `SELECT title, gear_item_id FROM checklist_items WHERE id = $1`,
    [checklistItemId],
  )
).rows[0];

const checklistUnlinkOk =
  checklistUnlinked !== undefined &&
  checklistUnlinked.gear_item_id === null &&
  checklistUnlinked.title === 'Тип пункта проверки';

if (!checklistUnlinkOk) failed += 1;
rows.push([
  checklistUnlinkOk ? 'ok' : 'ССЫЛКА ОСТАЛАСЬ',
  'чек-листы: удалили вещь — пункт стал текстом имени типа',
  checklistUnlinkOk
    ? ''
    : `title=${checklistUnlinked?.title ?? 'нет строки'}, gear=${checklistUnlinked?.gear_item_id ?? 'нет строки'}`,
]);

await check(
  'чек-листы: пункт не ссылается на несуществующую вещь',
  'fail',
  `INSERT INTO checklist_items (checklist_id, title, gear_item_id)
   VALUES ($1, 'Ссылка в никуда', 999999999)`,
  [checklistListId],
);

await client.query(`DELETE FROM checklists WHERE id = $1`, [checklistListId]);

const checklistItemsLeft = (
  await client.query(
    `SELECT count(*)::int AS count FROM checklist_items WHERE checklist_id = $1`,
    [checklistListId],
  )
).rows[0].count;

if (checklistItemsLeft !== 0) failed += 1;
rows.push([
  checklistItemsLeft === 0 ? 'ok' : 'ОСТАЛИСЬ ПУНКТЫ',
  'чек-листы: удалили список — ушли его пункты (каскад)',
  checklistItemsLeft === 0 ? '' : `осталось ${checklistItemsLeft}`,
]);

await client.query('ROLLBACK');
await client.end();

for (const [status, name, detail] of rows) {
  console.log(`${status.padEnd(32)} ${name}${detail ? `  ← ${detail}` : ''}`);
}
console.log('');
console.log(failed === 0 ? 'ВСЕ ПРОВЕРКИ ПРОШЛИ' : `ПРОВАЛЕНО: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
