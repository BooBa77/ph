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
  'характеристика: пустой placeholder запрещён (btrim)',
  'fail',
  `INSERT INTO gear_type_attributes (gear_type_id, code, name, value_kind, placeholder)
   VALUES ($1, 'empty_hint', 'Пустая подсказка', 'text', '')`,
  [gearTentId],
);

await check(
  'характеристика: placeholder длиннее 100 символов запрещён',
  'fail',
  `INSERT INTO gear_type_attributes (gear_type_id, code, name, value_kind, placeholder)
   VALUES ($1, 'long_hint', 'Длинная подсказка', 'text', repeat('я', 101))`,
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

// ─── Группы снаряжения (02.11.2026) ───
/**
 * Инварианты рекомендуемых и личных групп.
 *
 * С 02.11.2026 группы двух видов: **шаблоны админа**
 * (`gear_group_templates`) и **личные копии** (`gear_groups`), а собирают
 * они **типы** (`gear_type_groups`). Проверяется то, что держит каталог
 * собранным: код шаблона — контракт, у личной группы обязателен владелец,
 * тип лежит ровно в одной группе, «Прочее» есть всегда, а вещь больше
 * не ссылается на группу — её полка выводится из типа.
 *
 * **Удаление теперь разрешено только у личной группы.** Шаблон с типами
 * не удаляют (архив), а личную группу человек вправе убрать: её типы
 * сервис переносит в «Прочее». Схема это не запрещает — правило живёт
 * в API, и e2e проверяет его отдельно.
 */
const templateShape = await client.query(
  `SELECT column_name, is_nullable, column_default
     FROM information_schema.columns
    WHERE table_name = 'gear_group_templates'
      AND column_name IN ('code', 'name', 'is_active', 'sort_order')
    ORDER BY column_name`,
);
const templateShapeByName = new Map(
  templateShape.rows.map((row) => [row.column_name, row]),
);
const templateShapeOk =
  templateShape.rows.length === 4 &&
  templateShapeByName.get('code')?.is_nullable === 'NO' &&
  templateShapeByName.get('name')?.is_nullable === 'NO' &&
  templateShapeByName.get('is_active')?.is_nullable === 'NO' &&
  (templateShapeByName.get('is_active')?.column_default ?? '').includes('true') &&
  templateShapeByName.get('sort_order')?.is_nullable === 'NO' &&
  (templateShapeByName.get('sort_order')?.column_default ?? '').includes('0');
if (!templateShapeOk) failed += 1;
rows.push([
  templateShapeOk ? 'ok' : 'СТАРАЯ СХЕМА',
  'шаблон: code/name обязательны, is_active=true и sort_order=0 по умолчанию',
  `колонки: ${templateShape.rows
    .map((row) => `${row.column_name}(${row.is_nullable})`)
    .join(', ') || 'нет'}`,
]);

const otherTemplate = await client.query(
  `SELECT id FROM gear_group_templates WHERE code = 'other'`,
);
const otherTemplateOk = otherTemplate.rowCount === 1;
if (!otherTemplateOk) failed += 1;
rows.push([
  otherTemplateOk ? 'ok' : 'НЕТ ГРУППЫ ПО УМОЛЧАНИЮ',
  'шаблон: «Прочее» (other) заведён — умолчание для типа без рекомендации',
  '',
]);

const personalGroupShape = await client.query(
  `SELECT column_name, is_nullable, column_default
     FROM information_schema.columns
    WHERE table_name = 'gear_groups'
      AND column_name IN ('owner_user_id', 'template_code', 'name', 'sort_order')
    ORDER BY column_name`,
);
const personalGroupShapeByName = new Map(
  personalGroupShape.rows.map((row) => [row.column_name, row]),
);
const personalGroupShapeOk =
  personalGroupShape.rows.length === 4 &&
  personalGroupShapeByName.get('owner_user_id')?.is_nullable === 'NO' &&
  personalGroupShapeByName.get('template_code')?.is_nullable === 'YES' &&
  personalGroupShapeByName.get('name')?.is_nullable === 'NO' &&
  personalGroupShapeByName.get('sort_order')?.is_nullable === 'NO' &&
  (personalGroupShapeByName.get('sort_order')?.column_default ?? '').includes('0');
if (!personalGroupShapeOk) failed += 1;
rows.push([
  personalGroupShapeOk ? 'ok' : 'СТАРАЯ СХЕМА',
  'личная группа: владелец и имя обязательны, шаблон необязателен, порядок=0',
  `колонки: ${personalGroupShape.rows
    .map((row) => `${row.column_name}(${row.is_nullable})`)
    .join(', ') || 'нет'}`,
]);

const typeGroupShape = await client.query(
  `SELECT column_name, is_nullable
     FROM information_schema.columns
    WHERE table_name = 'gear_type_groups'
      AND column_name IN ('owner_user_id', 'gear_type_id', 'group_id')
    ORDER BY column_name`,
);
const typeGroupShapeByName = new Map(
  typeGroupShape.rows.map((row) => [row.column_name, row]),
);
const typeGroupShapeOk =
  typeGroupShape.rows.length === 3 &&
  typeGroupShapeByName.get('owner_user_id')?.is_nullable === 'NO' &&
  typeGroupShapeByName.get('gear_type_id')?.is_nullable === 'NO' &&
  typeGroupShapeByName.get('group_id')?.is_nullable === 'NO';
if (!typeGroupShapeOk) failed += 1;
rows.push([
  typeGroupShapeOk ? 'ok' : 'СТАРАЯ СХЕМА',
  'раскладка типов: владелец, тип и группа обязательны',
  `колонки: ${typeGroupShape.rows
    .map((row) => `${row.column_name}(${row.is_nullable})`)
    .join(', ') || 'нет'}`,
]);

const typeGroupUnique = await client.query(
  `SELECT indexdef FROM pg_indexes WHERE indexname = 'UQ_gear_type_groups_type'`,
);
const typeGroupUniqueDef = typeGroupUnique.rows[0]?.indexdef ?? '';
const typeGroupUniqueOk =
  typeGroupUnique.rowCount === 1 &&
  typeGroupUniqueDef.includes('UNIQUE') &&
  typeGroupUniqueDef.includes('owner_user_id') &&
  typeGroupUniqueDef.includes('gear_type_id');
if (!typeGroupUniqueOk) failed += 1;
rows.push([
  typeGroupUniqueOk ? 'ok' : 'НЕТ УНИКАЛЬНОСТИ',
  'раскладка: один тип — одна группа у человека',
  typeGroupUniqueDef,
]);

const groupItemShape = await client.query(
  `SELECT column_name, is_nullable, column_default
     FROM information_schema.columns
    WHERE table_name = 'gear_items'
      AND column_name IN ('group_id', 'location', 'sort_order')
    ORDER BY column_name`,
);
const groupItemShapeByName = new Map(
  groupItemShape.rows.map((row) => [row.column_name, row]),
);
const groupItemShapeOk =
  groupItemShape.rows.length === 2 &&
  groupItemShapeByName.get('group_id') === undefined &&
  groupItemShapeByName.get('location')?.is_nullable === 'YES' &&
  groupItemShapeByName.get('sort_order')?.is_nullable === 'NO' &&
  (groupItemShapeByName.get('sort_order')?.column_default ?? '').includes('0');
if (!groupItemShapeOk) failed += 1;
rows.push([
  groupItemShapeOk ? 'ok' : 'СТАРАЯ СХЕМА',
  'вещь: group_id больше нет, location необязателен, sort_order=0',
  `колонки: ${groupItemShape.rows
    .map((row) => `${row.column_name}(${row.is_nullable})`)
    .join(', ') || 'нет'}`,
]);

const groupIndexName = 'IDX_gear_items_owner_type_sort';
const groupIndex = await client.query(
  `SELECT indexdef FROM pg_indexes WHERE indexname = $1`,
  [groupIndexName],
);
const groupIndexDef = groupIndex.rows[0]?.indexdef ?? '';
const groupIndexOk =
  groupIndex.rowCount === 1 &&
  groupIndexDef.includes('gear_type_id') &&
  groupIndexDef.includes('sort_order');
if (!groupIndexOk) failed += 1;
rows.push([
  groupIndexOk ? 'ok' : 'НЕТ ИНДЕКСА',
  'вещь: каталог читается по типу и личному порядку — индекс',
  groupIndexDef,
]);

const testTemplateId = (
  await client.query(
    `INSERT INTO gear_group_templates (code, name, sort_order)
     VALUES ('e2e_check_template', 'Проверочный шаблон', 50)
     RETURNING id`,
  )
).rows[0].id;

await check(
  'шаблон: кириллица в коде запрещена (CHECK)',
  'fail',
  `INSERT INTO gear_group_templates (code, name) VALUES ('Проверочная', 'Кириллица')`,
);

await check(
  'шаблон: пустое имя запрещено (CHECK)',
  'fail',
  `INSERT INTO gear_group_templates (code, name)
   VALUES ('e2e_check_template_empty', '   ')`,
);

await check(
  'шаблон: отрицательный порядок запрещён (CHECK)',
  'fail',
  `INSERT INTO gear_group_templates (code, name, sort_order)
   VALUES ('e2e_check_template_sort', 'Минус', -10)`,
);

await check(
  'шаблон: код уникален, в том числе с архивными строками',
  'fail',
  `INSERT INTO gear_group_templates (code, name)
   VALUES ('e2e_check_template', 'Дубль')`,
);

const testGroupId = (
  await client.query(
    `INSERT INTO gear_groups (owner_user_id, template_code, name, sort_order)
     VALUES ($1, 'e2e_check_personal', 'Проверочная личная', 50)
     RETURNING id`,
    [user1],
  )
).rows[0].id;

await check(
  'личная группа: пустое имя запрещено (CHECK)',
  'fail',
  `INSERT INTO gear_groups (owner_user_id, name) VALUES ($1, '   ')`,
  [user1],
);

await check(
  'личная группа: отрицательный порядок запрещён (CHECK)',
  'fail',
  `INSERT INTO gear_groups (owner_user_id, name, sort_order)
   VALUES ($1, 'Минус', -10)`,
  [user1],
);

await check(
  'личная группа: кириллица в коде шаблона запрещена (CHECK)',
  'fail',
  `INSERT INTO gear_groups (owner_user_id, template_code, name)
   VALUES ($1, 'Проверочная', 'Кириллица')`,
  [user1],
);

await check(
  'личная группа: один шаблон — одна копия у человека (unique)',
  'fail',
  `INSERT INTO gear_groups (owner_user_id, template_code, name)
   VALUES ($1, 'e2e_check_personal', 'Вторая копия')`,
  [user1],
);

await check(
  'раскладка: тип кладётся в личную группу',
  'ok',
  `INSERT INTO gear_type_groups (owner_user_id, gear_type_id, group_id)
   VALUES ($1, $2, $3)`,
  [user1, itemTypeId, testGroupId],
);

await check(
  'раскладка: тот же тип второй раз запрещён (unique)',
  'fail',
  `INSERT INTO gear_type_groups (owner_user_id, gear_type_id, group_id)
   VALUES ($1, $2, $3)`,
  [user1, itemTypeId, testGroupId],
);

const groupItemId = (
  await client.query(
    `INSERT INTO gear_items (owner_user_id, gear_type_id, title, location)
     VALUES ($1, $2, 'Вещь в проверочной группе', 'гараж')
     RETURNING id`,
    [user1, itemTypeId],
  )
).rows[0].id;

await check(
  'вещь: без группы создаётся — полка выводится из типа',
  'ok',
  `INSERT INTO gear_items (owner_user_id, gear_type_id, title)
   VALUES ($1, $2, 'Вещь без полки')`,
  [user1, itemTypeId],
);

await check(
  'вещь: местоположение из пробелов запрещено (CHECK)',
  'fail',
  `UPDATE gear_items SET location = '   ' WHERE id = $1`,
  [groupItemId],
);

await check(
  'вещь: отрицательный личный порядок запрещён (CHECK)',
  'fail',
  `UPDATE gear_items SET sort_order = -10 WHERE id = $1`,
  [groupItemId],
);

// Личная группа удаляется свободно: сервис сначала переносит типы
// в «Прочее», а схема просто уносит раскладку каскадом.
await client.query(`DELETE FROM gear_groups WHERE id = $1`, [testGroupId]);
const mappingAfterGroupDelete = await client.query(
  `SELECT count(*)::int AS count FROM gear_type_groups
    WHERE owner_user_id = $1 AND gear_type_id = $2`,
  [user1, itemTypeId],
);
const groupDeleteCascadeOk = mappingAfterGroupDelete.rows[0].count === 0;
if (!groupDeleteCascadeOk) failed += 1;
rows.push([
  groupDeleteCascadeOk ? 'ok' : 'ОСТАЛАСЬ РАСКЛАДКА',
  'личная группа: удаление уносит раскладку (CASCADE)',
  '',
]);

// Удаление шаблона обнуляет рекомендацию у типа (SET NULL), а не ломает
// справочник: API вместо этого архивирует шаблон, но схема страхует.
await client.query(
  `UPDATE gear_types SET recommended_group_id = $1 WHERE id = $2`,
  [testTemplateId, itemTypeId],
);
await client.query(`DELETE FROM gear_group_templates WHERE id = $1`, [
  testTemplateId,
]);
const recommendationAfterDelete = await client.query(
  `SELECT recommended_group_id FROM gear_types WHERE id = $1`,
  [itemTypeId],
);
const templateDeleteOk = recommendationAfterDelete.rows[0]?.recommended_group_id === null;
if (!templateDeleteOk) failed += 1;
rows.push([
  templateDeleteOk ? 'ok' : 'ОСТАЛАСЬ РЕКОМЕНДАЦИЯ',
  'шаблон: удаление обнуляет рекомендуемую группу типа (SET NULL)',
  '',
]);

await client.query(`DELETE FROM gear_items WHERE id = $1`, [groupItemId]);

// Вещь для проверок значений характеристик: у неё две характеристики,
// чтобы каскад при удалении было на чём проверить.
const itemId = (
  await client.query(
    `INSERT INTO gear_items (owner_user_id, gear_type_id, title)
     VALUES ($1, $2, 'Проверочная вещь')
     RETURNING id`,
    [user1, itemTypeId],
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
  `INSERT INTO gear_items (owner_user_id, gear_type_id, title)
   VALUES ($1, 2147483000, 'Вещь с чужим типом')`,
  [user1],
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
    `INSERT INTO gear_items (owner_user_id, gear_type_id, title)
     VALUES ($1, $2, 'Проверочная модель')
     RETURNING id`,
    [user1, itemTypeId],
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
// ─── Семейный каталог: ключ вещи и мягкое удаление (11.11.2026) ───
/**
 * Инварианты `gear_uid`, `origin_user_id`, `deleted_at`.
 *
 * Заказчик: «Один физический предмет — один неизменный `gear_uid`… Удаление —
 * `deleted_at` на клонах текущей компоненты». Проверяется то, из-за чего
 * данные придётся чинить руками: ключ выдан каждой вещи, автор записан,
 * два клона одной вещи у одного человека невозможны, а удаление строку
 * не уносит — иначе история походов осталась бы без вещи.
 *
 * Заодно проверяется страховка для сырых вставок: у вещи, заведённой
 * без ключа и автора (так делают e2e и этот скрипт), ключ выдаёт DEFAULT,
 * а автора — триггер.
 */
const familyColumns = await client.query(
  `SELECT column_name, is_nullable, column_default
     FROM information_schema.columns
    WHERE table_name = 'gear_items'
      AND column_name IN ('gear_uid', 'origin_user_id', 'deleted_at')
    ORDER BY column_name`,
);
const familyColumnsOk =
  familyColumns.rows.length === 3 &&
  familyColumns.rows.every((row) =>
    row.column_name === 'deleted_at'
      ? row.is_nullable === 'YES'
      : row.is_nullable === 'NO',
  ) &&
  familyColumns.rows.some(
    (row) => row.column_name === 'gear_uid' && row.column_default === 'gen_random_uuid()',
  );
if (!familyColumnsOk) failed += 1;
rows.push([
  familyColumnsOk ? 'ok' : 'НЕТ КОЛОНОК КЛОНА',
  'вещь: gear_uid и origin_user_id обязательны, deleted_at — мягкое удаление',
  familyColumns.rows
    .map((row) => `${row.column_name}(${row.is_nullable})`)
    .join(', '),
]);

const cloneIndex = await client.query(
  `SELECT indexdef FROM pg_indexes
    WHERE tablename = 'gear_items' AND indexname = 'UQ_gear_items_uid_owner'`,
);
const cloneIndexOk =
  cloneIndex.rows.length === 1 && cloneIndex.rows[0].indexdef.includes('UNIQUE');
if (!cloneIndexOk) failed += 1;
rows.push([
  cloneIndexOk ? 'ok' : 'НЕТ ИНДЕКСА КЛОНОВ',
  'вещь: один клон на человека — UNIQUE (gear_uid, owner_user_id)',
  cloneIndex.rows[0]?.indexdef ?? '',
]);

const cloneParent = (
  await client.query(
    `INSERT INTO gear_items (owner_user_id, gear_type_id, title)
     VALUES ($1, $2, 'Вещь с ключом')
     RETURNING id, gear_uid, origin_user_id`,
    [user1, itemTypeId],
  )
).rows[0];
const cloneKeyFilled =
  cloneParent.gear_uid !== null &&
  cloneParent.origin_user_id === user1;
if (!cloneKeyFilled) failed += 1;
rows.push([
  cloneKeyFilled ? 'ok' : 'КЛЮЧ НЕ ВЫДАН',
  'вещь: без ключа и автора в INSERT — оба выданы базой',
  `gear_uid=${cloneParent.gear_uid}, автор=${cloneParent.origin_user_id}`,
]);

await check(
  'вещь: второй клон той же вещи тому же человеку запрещён',
  'fail',
  `INSERT INTO gear_items (owner_user_id, gear_type_id, title, gear_uid)
   VALUES ($1, $2, 'Второй клон', $3)`,
  [user1, itemTypeId, cloneParent.gear_uid],
);

const cloneForSecondOwner = (
  await client.query(
    `INSERT INTO gear_items (owner_user_id, gear_type_id, title, gear_uid, origin_user_id)
     VALUES ($1, $2, 'Клон у второго', $3, $4)
     RETURNING id`,
    [user2, itemTypeId, cloneParent.gear_uid, user1],
  )
).rows[0];

await client.query(`UPDATE gear_items SET deleted_at = now() WHERE id = $1`, [
  cloneParent.id,
]);
const softDeleted = await client.query(
  `SELECT deleted_at FROM gear_items WHERE id = $1`,
  [cloneParent.id],
);
const softDeleteOk =
  softDeleted.rows.length === 1 && softDeleted.rows[0].deleted_at !== null;
if (!softDeleteOk) failed += 1;
rows.push([
  softDeleteOk ? 'ok' : 'СТРОКА ИСЧЕЗЛА',
  'вещь: удаление ставит deleted_at, строку не уносит',
  '',
]);

await client.query(
  `DELETE FROM gear_items WHERE id = ANY($1::bigint[])`,
  [[cloneParent.id, cloneForSecondOwner.id]],
);

// «Вещь без полки» из проверки выше осталась висеть на типе — без этой
// уборки тип с вещами не удалить (RESTRICT), и скрипт падал бы на своей же
// проверке.
await client.query(`DELETE FROM gear_items WHERE gear_type_id = $1`, [itemTypeId]);
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

// ─── Родные (10.11.2026) ───
/**
 * Инварианты родства (`family_links`).
 *
 * Правила, которые нельзя доказать тестом API: пара хранится один раз
 * в каноническом порядке, запрос отправила одна из двух сторон, а
 * `accepted` без даты согласия невозможен. Если из базы убрать CHECK,
 * e2e останутся зелёными, а данные поедут: появятся две встречные строки
 * об одном родстве или «согласие», которого никто не давал.
 */
const familyShape = await client.query(
  `SELECT
     (SELECT count(*)::int FROM information_schema.tables
       WHERE table_name = 'family_links') AS table_exists,
     (SELECT column_default FROM information_schema.columns
       WHERE table_name = 'family_links' AND column_name = 'status') AS status_default,
     (SELECT 1 FROM pg_indexes
       WHERE indexname = 'UQ_family_links_pair') AS has_unique,
     (SELECT confdeltype FROM pg_constraint
       WHERE conname = 'FK_family_links_user_a') AS delete_a,
     (SELECT confdeltype FROM pg_constraint
       WHERE conname = 'FK_family_links_user_b') AS delete_b,
     (SELECT confdeltype FROM pg_constraint
       WHERE conname = 'FK_family_links_requested_by') AS delete_requester`,
);
const familyShapeRow = familyShape.rows[0];
const familyShapeOk =
  familyShapeRow.table_exists === 1 &&
  (familyShapeRow.status_default ?? '').includes('pending') &&
  familyShapeRow.has_unique === 1 &&
  familyShapeRow.delete_a === 'c' &&
  familyShapeRow.delete_b === 'c' &&
  familyShapeRow.delete_requester === 'c';

if (!familyShapeOk) failed += 1;
rows.push([
  familyShapeOk ? 'ok' : 'НЕТ СХЕМЫ',
  'родные: таблица, значение по умолчанию, уникальная пара и каскады',
  familyShapeOk
    ? ''
    : `table=${familyShapeRow.table_exists}, default=${familyShapeRow.status_default}, unique=${familyShapeRow.has_unique}, delete=${familyShapeRow.delete_a}/${familyShapeRow.delete_b}/${familyShapeRow.delete_requester}`,
]);

const familyThirdId = (
  await client.query(
    `INSERT INTO users (display_name) VALUES ('Проверочный третий') RETURNING id`,
  )
).rows[0].id;

// Канонический порядок пары — как его держит база: меньший uuid первым.
const [familyA, familyB] =
  user1 < user2 ? [user1, user2] : [user2, user1];
const [familyThirdA, familyThirdB] =
  familyA < familyThirdId
    ? [familyA, familyThirdId]
    : [familyThirdId, familyA];

await check(
  'родные: пара в обратном порядке запрещена',
  'fail',
  `INSERT INTO family_links (user_a_id, user_b_id, requested_by_user_id)
   VALUES ($1, $2, $1)`,
  [familyB, familyA],
);

await check(
  'родные: отправитель запроса обязан быть стороной пары',
  'fail',
  `INSERT INTO family_links (user_a_id, user_b_id, requested_by_user_id)
   VALUES ($1, $2, $3)`,
  [familyA, familyB, familyThirdId],
);

await check(
  'родные: запрос со стороной пары принимается',
  'ok',
  `INSERT INTO family_links (user_a_id, user_b_id, requested_by_user_id)
   VALUES ($1, $2, $1)`,
  [familyA, familyB],
);

await check(
  'родные: вторая строка о той же паре запрещена',
  'fail',
  `INSERT INTO family_links (user_a_id, user_b_id, requested_by_user_id, status, responded_at)
   VALUES ($1, $2, $2, 'accepted', now())`,
  [familyA, familyB],
);

await check(
  'родные: согласие без даты запрещено',
  'fail',
  `INSERT INTO family_links (user_a_id, user_b_id, requested_by_user_id, status)
   VALUES ($1, $2, $1, 'accepted')`,
  [familyThirdA, familyThirdB],
);

await check(
  'родные: согласие с датой принимается',
  'ok',
  `INSERT INTO family_links (user_a_id, user_b_id, requested_by_user_id, status, responded_at)
   VALUES ($1, $2, $1, 'accepted', now())`,
  [familyThirdA, familyThirdB],
);

await check(
  'родные: родство с самим собой невозможно',
  'fail',
  `INSERT INTO family_links (user_a_id, user_b_id, requested_by_user_id)
   VALUES ($1, $1, $1)`,
  [familyA],
);

const manualTypeId = (
  await client.query(
    `INSERT INTO gear_types (code, name)
     VALUES ('e2e_check_manual_type', 'Проверочный тип вручную')
     RETURNING id`,
  )
).rows[0].id;

const defaultTripOnly = await client.query(
  `INSERT INTO gear_items (owner_user_id, gear_type_id, title)
   VALUES ($1, $2, 'Обычная вещь каталога')
   RETURNING is_trip_only`,
  [user2, manualTypeId],
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
  `INSERT INTO gear_items (owner_user_id, gear_type_id, title, is_trip_only)
   VALUES ($1, $2, 'Бутылка бензина', true)`,
  [virtualUserId, manualTypeId],
);

// ─── Таблица ночёвок: ночи, кто где живёт и личные вещи (01.11.2026) ───
/**
 * Инварианты «Ночёвок» (решения 31.10.2026 и 01.11.2026): ночь с одним
 * вариантом, место жительства на весь поход и личные спальники.
 *
 * Проверяется то, чего не видно из API: «у ночи один вариант» — это колонка
 * `kind`, а таблицы вариантов больше нет; «место — только у ночи с ночёвкой»
 * и «готовка — только у палатки, избы и машины» живут в CHECK; «одно место
 * на поход» — в уникальном ключе; личная вещь — в каскадах. Тесты API
 * останутся зелёными, если из базы убрать CHECK, — а данные поедут. Ровно
 * так уже случалось с видом снаряжения.
 */
const routeShape = await client.query(
  `SELECT table_name
     FROM information_schema.tables
    WHERE table_name IN ('trip_route_nights', 'trip_route_lodgers',
                         'trip_route_sleeping')`,
);
const routeShapeOk = routeShape.rowCount === 3;
if (!routeShapeOk) failed += 1;
rows.push([
  routeShapeOk ? 'ok' : 'СТАРАЯ СХЕМА',
  'ночёвки: таблицы ночей, мест жительства и личных вещей',
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
    `INSERT INTO gear_items (owner_user_id, gear_type_id, title)
     VALUES ($1, $2, 'Палатка проверки') RETURNING id`,
    [user1, routeTentTypeId],
  )
).rows[0].id;

const routeAxeItemId = (
  await client.query(
    `INSERT INTO gear_items (owner_user_id, gear_type_id, title)
     VALUES ($1, $2, 'Спальник проверки') RETURNING id`,
    [user1, routeAxeTypeId],
  )
).rows[0].id;

const routeTentGearId = (
  await client.query(
    `INSERT INTO trip_gear (trip_id, gear_item_id, owner_user_id, status)
     VALUES ($1, $2, $3, 'approved') RETURNING id`,
    [tripId, routeTentItemId, user1],
  )
).rows[0].id;

/**
 * «Добавить ещё» (01.11.2026): у вещи снаряжения похода есть пометка
 * секции, в которой её добавили. По типу такая вещь ни в одну секцию
 * не попадает — «хоть лодку», — поэтому `route_section` и существует.
 * Проверяется словарь в CHECK: мусор в колонке сломал бы фильтр секций
 * молча, а e2e этого не увидит — API словарь тоже проверяет.
 */
const routeExtraTypeId = (
  await client.query(
    `INSERT INTO gear_types (code, name)
     VALUES ('check_route_extra', 'Лодка проверки ночёвок') RETURNING id`,
  )
).rows[0].id;

const routeExtraItemId = (
  await client.query(
    `INSERT INTO gear_items (owner_user_id, gear_type_id, title)
     VALUES ($1, $2, 'Лодка проверки') RETURNING id`,
    [user1, routeExtraTypeId],
  )
).rows[0].id;

await check(
  'ночёвки: секция «Добавить ещё» — только из словаря',
  'fail',
  `INSERT INTO trip_gear (trip_id, gear_item_id, owner_user_id, route_section)
   VALUES ($1, $2, $3, 'boat')`,
  [tripId, routeExtraItemId, user1],
);

await check(
  'ночёвки: секция «Посуда» у вещи похода разрешена',
  'ok',
  `INSERT INTO trip_gear (trip_id, gear_item_id, owner_user_id, route_section)
   VALUES ($1, $2, $3, 'dishes')`,
  [tripId, routeExtraItemId, user1],
);

// Ночь с одним вариантом: `kind` и `cooking` — её колонки.
const routeNightId = (
  await client.query(
    `INSERT INTO trip_route_nights
       (trip_id, position, place, kind, cooking)
     VALUES ($1, 1, 'Ольхон, у скалы', 'tent', 'fire') RETURNING id`,
    [tripId],
  )
).rows[0].id;

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
  `INSERT INTO trip_route_nights (trip_id, position, place, kind)
   VALUES ($1, 9, repeat('я', 121), 'hotel')`,
  [tripId],
);

await check(
  'ночёвки: место без ночлега запрещено (kind пустой)',
  'fail',
  `INSERT INTO trip_route_nights (trip_id, position, place)
   VALUES ($1, 8, 'Байкал')`,
  [tripId],
);

await check(
  'ночёвки: место у «в пути» запрещено',
  'fail',
  `INSERT INTO trip_route_nights (trip_id, position, place, kind)
   VALUES ($1, 7, 'Байкал', 'transit')`,
  [tripId],
);

await check(
  'ночёвки: вид ночи — только из словаря',
  'fail',
  `INSERT INTO trip_route_nights (trip_id, position, kind)
   VALUES ($1, 6, 'spaceship')`,
  [tripId],
);

await check(
  'ночёвки: готовка у гостиницы запрещена',
  'fail',
  `INSERT INTO trip_route_nights (trip_id, position, kind, cooking)
   VALUES ($1, 5, 'hotel', 'fire')`,
  [tripId],
);

await check(
  'ночёвки: готовка у избы разрешена',
  'ok',
  `INSERT INTO trip_route_nights (trip_id, position, kind, cooking)
   VALUES ($1, 4, 'hut', 'both')`,
  [tripId],
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

// Личная вещь: своя вещь каталога, повторно — нельзя.
/**
 * Проверка «только участник» идёт **до** первой вставки: с 10.11.2026
 * уникальность считается по (trip, item), и после первой строки этот же
 * предмет упал бы на ней, а не на внешнем ключе участника — проверка
 * перестала бы проверять то, что написано в её названии.
 */
await check(
  'ночёвки: спальник бывает только у участника похода',
  'fail',
  `INSERT INTO trip_route_sleeping (trip_id, user_id, gear_item_id)
   VALUES ($1, '00000000-0000-0000-0000-000000000000', $2)`,
  [tripId, routeAxeItemId],
);

await check(
  'ночёвки: личный спальник — участник и вещь каталога',
  'ok',
  `INSERT INTO trip_route_sleeping (trip_id, user_id, gear_item_id)
   VALUES ($1, $2, $3)`,
  [tripId, user1, routeAxeItemId],
);

await check(
  'ночёвки: одну и ту же вещь дважды не добавить',
  'fail',
  `INSERT INTO trip_route_sleeping (trip_id, user_id, gear_item_id)
   VALUES ($1, $2, $3)`,
  [tripId, user1, routeAxeItemId],
);

/**
 * «Нельзя один спальник обоим взять» (10.11.2026, вечер) — дословно
 * правило заказчика. Второй участник с той же вещью падает на индексе
 * по (trip, item): вещь в походе занимает один человек.
 */
await check(
  'ночёвки: один спальник не взять двоим',
  'fail',
  `INSERT INTO trip_route_sleeping (trip_id, user_id, gear_item_id)
   VALUES ($1, $2, $3)`,
  [tripId, user2, routeAxeItemId],
);

await check(
  'ночёвки: спальник не ссылается на несуществующую вещь',
  'fail',
  `INSERT INTO trip_route_sleeping (trip_id, user_id, gear_item_id)
   VALUES ($1, $2, $3)`,
  [tripId, user1, '999999999'],
);

// Убрали вещь каталога — ушла и её строка в ночёвке.
await client.query(`DELETE FROM gear_items WHERE id = $1`, [routeAxeItemId]);

const routeSleepingLeft = (
  await client.query(
    `SELECT count(*)::int AS count FROM trip_route_sleeping
      WHERE gear_item_id = $1`,
    [routeAxeItemId],
  )
).rows[0].count;

if (routeSleepingLeft !== 0) failed += 1;
rows.push([
  routeSleepingLeft === 0 ? 'ok' : 'ОСТАЛИСЬ СТРОКИ',
  'ночёвки: убрали вещь из каталога — ушёл её спальник (каскад)',
  routeSleepingLeft === 0 ? '' : `осталось ${routeSleepingLeft}`,
]);

// Убрали палатку из похода — ушло место живущего, а ночь осталась:
// ночь больше не ссылается на палатку.
await client.query(`DELETE FROM trip_gear WHERE id = $1`, [routeTentGearId]);

const routeLodgersLeft = (
  await client.query(
    `SELECT count(*)::int AS count FROM trip_route_lodgers
      WHERE tent_gear_id = $1`,
    [routeTentGearId],
  )
).rows[0].count;
const routeNightLeft = (
  await client.query(
    `SELECT count(*)::int AS count FROM trip_route_nights
      WHERE id = $1 AND kind = 'tent'`,
    [routeNightId],
  )
).rows[0].count;

if (routeLodgersLeft !== 0 || routeNightLeft !== 1) failed += 1;
rows.push([
  routeLodgersLeft === 0 && routeNightLeft === 1 ? 'ok' : 'НЕ ТАК',
  'ночёвки: убрали палатку — ушло место живущего, а ночь осталась',
  routeLodgersLeft === 0 && routeNightLeft === 1
    ? ''
    : `мест ${routeLodgersLeft}, ночь ${routeNightLeft}`,
]);

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
    `INSERT INTO gear_items (owner_user_id, gear_type_id, title)
     VALUES ($1, $2, 'Вещь пункта') RETURNING id`,
    [user1, checklistTypeId],
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

// ─── Чек-листы: рекомендация и личные отметки (05.11.2026) ───
/**
 * «Список» вкладки «Снаряжение»: рекомендация принадлежит походу
 * (scope = 'recommendation'), она одна на поход, а отметки участников
 * живут отдельными строками «пункт + человек». Проверяется форма схемы
 * и то, что видно только в базе: частичный уникальный индекс и каскад
 * отметок при удалении пункта.
 */
const recommendationShape = await client.query(
  `SELECT
     (SELECT pg_get_constraintdef(oid) FROM pg_constraint
       WHERE conname = 'chk_checklists_scope') AS scope_check,
     (SELECT 1 FROM pg_indexes
       WHERE indexname = 'UQ_checklists_trip_recommendation') AS has_unique,
     (SELECT confdeltype FROM pg_constraint
       WHERE conname = 'FK_checklist_recommendation_marks_item') AS mark_delete_action`,
);

const recommendationShapeRow = recommendationShape.rows[0];
const recommendationShapeOk =
  String(recommendationShapeRow.scope_check).includes("'recommendation'") &&
  recommendationShapeRow.has_unique === 1 &&
  // «c» — ON DELETE CASCADE: убрали совет — ушли галочки на него.
  recommendationShapeRow.mark_delete_action === 'c';

if (!recommendationShapeOk) failed += 1;
rows.push([
  recommendationShapeOk ? 'ok' : 'НЕТ СХЕМЫ',
  'чек-листы: рекомендация в CHECK, одна на поход, отметки каскадом',
  recommendationShapeOk
    ? ''
    : `check=${recommendationShapeRow.scope_check}, index=${recommendationShapeRow.has_unique}, marks=${recommendationShapeRow.mark_delete_action}`,
]);

await check(
  'чек-листы: рекомендация без похода запрещена',
  'fail',
  `INSERT INTO checklists (scope, owner_user_id, title)
   VALUES ('recommendation', $1, 'Рекомендация без похода')`,
  [user1],
);

const recommendationListId = (
  await client.query(
    `INSERT INTO checklists (scope, trip_id, title)
     VALUES ('recommendation', $1, 'Рекомендация') RETURNING id`,
    [tripId],
  )
).rows[0].id;

await check(
  'чек-листы: вторая рекомендация в походе запрещена',
  'fail',
  `INSERT INTO checklists (scope, trip_id, title)
   VALUES ('recommendation', $1, 'Ещё одна')`,
  [tripId],
);

const recommendationItemId = (
  await client.query(
    `INSERT INTO checklist_items (checklist_id, title)
     VALUES ($1, 'Рюкзак') RETURNING id`,
    [recommendationListId],
  )
).rows[0].id;

await client.query(
  `INSERT INTO checklist_recommendation_marks (item_id, user_id)
   VALUES ($1, $2)`,
  [recommendationItemId, user1],
);

await check(
  'чек-листы: одна отметка на пункт и человека',
  'fail',
  `INSERT INTO checklist_recommendation_marks (item_id, user_id)
   VALUES ($1, $2)`,
  [recommendationItemId, user1],
);

await client.query(`DELETE FROM checklist_items WHERE id = $1`, [
  recommendationItemId,
]);

const recommendationMarksLeft = (
  await client.query(
    `SELECT count(*)::int AS count FROM checklist_recommendation_marks
      WHERE item_id = $1`,
    [recommendationItemId],
  )
).rows[0].count;

if (recommendationMarksLeft !== 0) failed += 1;
rows.push([
  recommendationMarksLeft === 0 ? 'ok' : 'ОСТАЛИСЬ ОТМЕТКИ',
  'чек-листы: удалили пункт рекомендации — ушли его отметки',
  recommendationMarksLeft === 0 ? '' : `осталось ${recommendationMarksLeft}`,
]);

// ─── Разделы «Берём» и «Взял» (05.11.2026) ───
/**
 * Инварианты `trip_gear_sections` и двух ссылок на них из `trip_gear`.
 *
 * Проверяется то, чего не видно в e2e: **форма схемы** (согласие `scope`
 * с владельцем, длина названия, отметки засева шаблонов) и **поведение
 * базы**: удаление раздела обнуляет ссылку у вещи («высыпается в корень»),
 * дочерние разделы уходят каскадом, а раздел из чужого похода или другого
 * вида в вещь не попадает — это держит триггер, а не только сервис.
 */
const sectionShape = await client.query(
  `SELECT
     (SELECT is_nullable FROM information_schema.columns
       WHERE table_name = 'trips' AND column_name = 'gear_sections_seeded_at') AS trip_seed,
     (SELECT is_nullable FROM information_schema.columns
       WHERE table_name = 'trip_participants'
         AND column_name = 'gear_sections_seeded_at') AS participant_seed,
     (SELECT confdeltype FROM pg_constraint
       WHERE conname = 'FK_trip_gear_shared_section') AS shared_delete_action,
     (SELECT confdeltype FROM pg_constraint
       WHERE conname = 'FK_trip_gear_personal_section') AS personal_delete_action,
     (SELECT 1 FROM pg_trigger
       WHERE tgname = 'trg_trip_gear_section_scope') AS has_trigger`,
);

const sectionShapeRow = sectionShape.rows[0];
const sectionShapeOk =
  sectionShapeRow.trip_seed === 'YES' &&
  sectionShapeRow.participant_seed === 'YES' &&
  // «n» — ON DELETE SET NULL: раздел убрали, вещь осталась в корне.
  sectionShapeRow.shared_delete_action === 'n' &&
  sectionShapeRow.personal_delete_action === 'n' &&
  sectionShapeRow.has_trigger === 1;

if (!sectionShapeOk) failed += 1;
rows.push([
  sectionShapeOk ? 'ok' : 'НЕТ СХЕМЫ',
  'разделы: отметки шаблонов, SET NULL у вещей, триггер похода и вида',
  sectionShapeOk
    ? ''
    : `seed=${sectionShapeRow.trip_seed}/${sectionShapeRow.participant_seed}, delete=${sectionShapeRow.shared_delete_action}/${sectionShapeRow.personal_delete_action}, trigger=${sectionShapeRow.has_trigger}`,
]);

await check(
  'разделы: общественный раздел с владельцем запрещён',
  'fail',
  `INSERT INTO trip_gear_sections (trip_id, scope, owner_user_id, title)
   VALUES ($1, 'shared', $2, 'Лишний владелец')`,
  [tripId, user1],
);

await check(
  'разделы: личный раздел без владельца запрещён',
  'fail',
  `INSERT INTO trip_gear_sections (trip_id, scope, title)
   VALUES ($1, 'personal', 'Ничей')`,
  [tripId],
);

await check(
  'разделы: пустое название запрещено',
  'fail',
  `INSERT INTO trip_gear_sections (trip_id, scope, title)
   VALUES ($1, 'shared', '   ')`,
  [tripId],
);

await check(
  'разделы: название длиннее 60 знаков запрещено',
  'fail',
  `INSERT INTO trip_gear_sections (trip_id, scope, title)
   VALUES ($1, 'shared', repeat('я', 61))`,
  [tripId],
);

const sectionGearRow = (
  await client.query(
    `SELECT id FROM trip_gear WHERE trip_id = $1 AND gear_item_id = $2 LIMIT 1`,
    [tripId, routeExtraItemId],
  )
).rows[0].id;

const sharedSectionId = (
  await client.query(
    `INSERT INTO trip_gear_sections (trip_id, scope, title)
     VALUES ($1, 'shared', 'Пешая часть') RETURNING id`,
    [tripId],
  )
).rows[0].id;

const personalSectionId = (
  await client.query(
    `INSERT INTO trip_gear_sections (trip_id, scope, owner_user_id, title)
     VALUES ($1, 'personal', $2, 'Одежда') RETURNING id`,
    [tripId, user1],
  )
).rows[0].id;

// Второй поход: раздел из него не должен связаться с вещью первого.
// Цель заводим свою: объект `objectId` выше уже удалён проверкой каскада.
const sectionObjectId = (
  await client.query(
    `INSERT INTO objects (name, type) VALUES ('Вершина разделов', 'вершина') RETURNING id`,
  )
).rows[0].id;
const otherTripId = (
  await client.query(
    `INSERT INTO trips (organizer_user_id, goal_object_id)
     VALUES ($1, $2) RETURNING id`,
    [user1, sectionObjectId],
  )
).rows[0].id;
const foreignSectionId = (
  await client.query(
    `INSERT INTO trip_gear_sections (trip_id, scope, title)
     VALUES ($1, 'shared', 'Чужой поход') RETURNING id`,
    [otherTripId],
  )
).rows[0].id;

await check(
  'разделы: раздел из чужого похода к вещи не привязать',
  'fail',
  `UPDATE trip_gear SET shared_section_id = $1 WHERE id = $2`,
  [foreignSectionId, sectionGearRow],
);

await check(
  'разделы: личный раздел не встаёт в общественное поле вещи',
  'fail',
  `UPDATE trip_gear SET shared_section_id = $1 WHERE id = $2`,
  [personalSectionId, sectionGearRow],
);

await check(
  'разделы: общественный раздел встаёт в своё поле вещи',
  'ok',
  `UPDATE trip_gear SET shared_section_id = $1 WHERE id = $2`,
  [sharedSectionId, sectionGearRow],
);

// Удаление раздела высыпает вещь в корень — это и есть SET NULL.
await client.query(`DELETE FROM trip_gear_sections WHERE id = $1`, [sharedSectionId]);

const sectionSpilled = (
  await client.query(
    `SELECT shared_section_id FROM trip_gear WHERE id = $1`,
    [sectionGearRow],
  )
).rows[0].shared_section_id;

if (sectionSpilled !== null) failed += 1;
rows.push([
  sectionSpilled === null ? 'ok' : 'ВЕЩЬ ПОТЕРЯЛАСЬ',
  'разделы: удалили раздел — вещь осталась и высыпалась в корень',
  sectionSpilled === null ? '' : `shared_section_id=${sectionSpilled}`,
]);

// Удаление родителя уносит подраздел: дерево не оставляет сирот.
const parentSectionId = (
  await client.query(
    `INSERT INTO trip_gear_sections (trip_id, scope, title)
     VALUES ($1, 'shared', 'Родитель') RETURNING id`,
    [tripId],
  )
).rows[0].id;
const childSectionId = (
  await client.query(
    `INSERT INTO trip_gear_sections (trip_id, scope, parent_id, title)
     VALUES ($1, 'shared', $2, 'Ребёнок') RETURNING id`,
    [tripId, parentSectionId],
  )
).rows[0].id;

await client.query(`DELETE FROM trip_gear_sections WHERE id = $1`, [parentSectionId]);

const sectionChildLeft = (
  await client.query(
    `SELECT count(*)::int AS count FROM trip_gear_sections WHERE id = $1`,
    [childSectionId],
  )
).rows[0].count;

if (sectionChildLeft !== 0) failed += 1;
rows.push([
  sectionChildLeft === 0 ? 'ok' : 'ПОДРАЗДЕЛ ОСТАЛСЯ',
  'разделы: удалили родителя — подраздел ушёл каскадом',
  sectionChildLeft === 0 ? '' : `осталось ${sectionChildLeft}`,
]);

// ─── Личные вещи «Взял» (06.11.2026) ───
/**
 * `trip_personal_gear`: личная вещь живёт отдельно от `trip_gear`
 * и в «Распределение» не протекает. Проверяем форму (CASCADE и SET NULL)
 * и то, что раздел обязан быть личным разделом того же человека.
 */
const personalShape = await client.query(
  `SELECT
     (SELECT 1 FROM information_schema.tables
       WHERE table_name = 'trip_personal_gear') AS table_exists,
     (SELECT confdeltype FROM pg_constraint
       WHERE conname = 'FK_trip_personal_gear_member') AS member_delete,
     (SELECT confdeltype FROM pg_constraint
       WHERE conname = 'FK_trip_personal_gear_item') AS item_delete,
     (SELECT confdeltype FROM pg_constraint
       WHERE conname = 'FK_trip_personal_gear_section') AS section_delete,
     (SELECT 1 FROM pg_trigger
       WHERE tgname = 'trg_trip_personal_gear_section') AS has_trigger,
     (SELECT 1 FROM pg_indexes
       WHERE indexname = 'UQ_trip_personal_gear_trip_item') AS has_unique`,
);

const personalShapeRow = personalShape.rows[0];
const personalShapeOk =
  personalShapeRow.table_exists === 1 &&
  // Ушли из состава или удалили предмет каталога — вещь уходит с ними.
  personalShapeRow.member_delete === 'c' &&
  personalShapeRow.item_delete === 'c' &&
  // Раздел убрали — вещь осталась в походе (высыпалась в корень).
  personalShapeRow.section_delete === 'n' &&
  personalShapeRow.has_trigger === 1 &&
  personalShapeRow.has_unique === 1;

if (!personalShapeOk) failed += 1;
rows.push([
  personalShapeOk ? 'ok' : 'НЕТ СХЕМЫ',
  'личные вещи: каскады, SET NULL раздела, триггер и уникальность',
  personalShapeOk
    ? ''
    : `table=${personalShapeRow.table_exists}, member=${personalShapeRow.member_delete}, item=${personalShapeRow.item_delete}, section=${personalShapeRow.section_delete}, trigger=${personalShapeRow.has_trigger}, unique=${personalShapeRow.has_unique}`,
]);

const personalRowId = (
  await client.query(
    `INSERT INTO trip_personal_gear (trip_id, user_id, gear_item_id)
     VALUES ($1, $2, $3) RETURNING id`,
    [tripId, user1, routeExtraItemId],
  )
).rows[0].id;

await check(
  'личные вещи: одну вещь дважды в один поход не положить',
  'fail',
  `INSERT INTO trip_personal_gear (trip_id, user_id, gear_item_id)
   VALUES ($1, $2, $3)`,
  [tripId, user1, routeExtraItemId],
);

/**
 * Снаряжение родных (10.11.2026, вечер): вещь одного человека берёт
 * другой — «у родных снаряжение общее». Запрет при этом остаётся:
 * «нельзя один спальник обоим взять». Поэтому та же вещь на второго
 * участника похода падает на уникальном индексе по (trip, item),
 * а не по (trip, user, item).
 */
await check(
  'личные вещи: одну вещь не взять двум людям',
  'fail',
  `INSERT INTO trip_personal_gear (trip_id, user_id, gear_item_id)
   VALUES ($1, $2, $3)`,
  [tripId, user2, routeExtraItemId],
);

const personalLocalSectionId = (
  await client.query(
    `INSERT INTO trip_gear_sections (trip_id, scope, owner_user_id, title)
     VALUES ($1, 'personal', $2, 'Одежда') RETURNING id`,
    [tripId, user1],
  )
).rows[0].id;

await check(
  'личные вещи: свой личный раздел принимается',
  'ok',
  `UPDATE trip_personal_gear SET section_id = $1 WHERE id = $2`,
  [personalLocalSectionId, personalRowId],
);

const personalSharedSectionId = (
  await client.query(
    `INSERT INTO trip_gear_sections (trip_id, scope, title)
     VALUES ($1, 'shared', 'Общий для проверки') RETURNING id`,
    [tripId],
  )
).rows[0].id;

await check(
  'личные вещи: общественный раздел в личную вещь не встаёт',
  'fail',
  `UPDATE trip_personal_gear SET section_id = $1 WHERE id = $2`,
  [personalSharedSectionId, personalRowId],
);

const personalOtherOwnerSectionId = (
  await client.query(
    `INSERT INTO trip_gear_sections (trip_id, scope, owner_user_id, title)
     VALUES ($1, 'personal', $2, 'Одежда второго') RETURNING id`,
    [tripId, user2],
  )
).rows[0].id;

await check(
  'личные вещи: чужой личный раздел не принимается',
  'fail',
  `UPDATE trip_personal_gear SET section_id = $1 WHERE id = $2`,
  [personalOtherOwnerSectionId, personalRowId],
);

const foreignPersonalSectionId = (
  await client.query(
    `INSERT INTO trip_gear_sections (trip_id, scope, owner_user_id, title)
     VALUES ($1, 'personal', $2, 'Чужой личный') RETURNING id`,
    [otherTripId, user1],
  )
).rows[0].id;

await check(
  'личные вещи: раздел из чужого похода не принимается',
  'fail',
  `UPDATE trip_personal_gear SET section_id = $1 WHERE id = $2`,
  [foreignPersonalSectionId, personalRowId],
);

// Удалили раздел — вещь осталась и высыпалась в корень.
await client.query(`DELETE FROM trip_gear_sections WHERE id = $1`, [
  personalLocalSectionId,
]);

const personalSectionSpilled = (
  await client.query(
    `SELECT section_id FROM trip_personal_gear WHERE id = $1`,
    [personalRowId],
  )
).rows[0].section_id;

if (personalSectionSpilled !== null) failed += 1;
rows.push([
  personalSectionSpilled === null ? 'ok' : 'ЛИЧНАЯ ВЕЩЬ ПОТЕРЯЛАСЬ',
  'личные вещи: удалили раздел — вещь осталась в корне',
  personalSectionSpilled === null ? '' : `section_id=${personalSectionSpilled}`,
]);

await client.query('ROLLBACK');
await client.end();

for (const [status, name, detail] of rows) {
  console.log(`${status.padEnd(32)} ${name}${detail ? `  ← ${detail}` : ''}`);
}
console.log('');
console.log(failed === 0 ? 'ВСЕ ПРОВЕРКИ ПРОШЛИ' : `ПРОВАЛЕНО: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
