/**
 * Границы дневника похода — общие для DTO, сервиса и схемы.
 *
 * Дневник — личная закладка участника (16.11.2026): записи принадлежат
 * паре «поход + человек», ходят через синхронизацию с устройством.
 *
 * **Почему пределы вообще есть.** Синхронизация принимает пачку записей
 * одним запросом, и без потолка одно тело смогло бы положить сервер
 * на одном ядре. Потолок текста — не про «короткие записи», а про защиту
 * от случайной вставки мегабайта в поле.
 */

/** Сколько символов может быть в одной записи. */
export const MAX_DIARY_BODY_LENGTH = 20000;

/** Сколько записей принимаем в одной пачке синхронизации. */
export const MAX_DIARY_SYNC_ENTRIES = 200;

/**
 * Правило разрешения спора двух устройств: побеждает более поздняя правка.
 *
 * Сравнивать надо `updated_at`, а не `created_at`: старая запись, поправленная
 * сегодня на планшете, важнее свежей записи, поправленной вчера на телефоне.
 * Равные отметки оставляют серверную версию — повторная отправка той же
 * пачки ничего не меняет.
 *
 * Функция живёт отдельно от SQL, чтобы правило можно было проверить
 * юнит-тестом, а не только живым запросом.
 */
export function shouldApplyDiaryUpdate(
  incomingUpdatedAt: Date,
  storedUpdatedAt: Date,
): boolean {
  return incomingUpdatedAt.getTime() > storedUpdatedAt.getTime();
}

/**
 * Проверить времена записи: `updated_at` не раньше создания, удаление
 * не раньше создания.
 *
 * Клиент присылает времена сам (в поле он пишет без сети), и явная
 * проверка превращает мусор в понятную ошибку 400, а не в кривую строку
 * в базе, на которую потом ругается CHECK.
 */
export function isValidDiaryTimes(
  createdAt: Date,
  updatedAt: Date,
  deletedAt: Date | null,
): boolean {
  const created = createdAt.getTime();
  if (Number.isNaN(created)) return false;
  if (Number.isNaN(updatedAt.getTime()) || updatedAt.getTime() < created) {
    return false;
  }
  if (deletedAt !== null) {
    if (Number.isNaN(deletedAt.getTime())) return false;
    if (deletedAt.getTime() < created) return false;
  }

  return true;
}
