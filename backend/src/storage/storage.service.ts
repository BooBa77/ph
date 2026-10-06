import { Injectable } from '@nestjs/common';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  AVATARS_DIR,
  AVATAR_URL_PREFIX,
  UPLOADS_DIR,
} from '../config/uploads.config';

/**
 * Что получилось из сохранения файла.
 *
 * `url` идёт в базу, `filePath` нужен, чтобы удалить файл, если запись
 * в базу не удалась: по URL его пришлось бы разбирать обратно.
 */
export interface SavedFile {
  url: string;
  filePath: string;
}

/** Каталог с аватарками: <uploads>/avatars. */
const AVATARS_ROOT = join(UPLOADS_DIR, AVATARS_DIR);

/**
 * Имя файла, которое мы генерируем сами: <uuid>.webp.
 *
 * UUID v4 в нижнем регистре — ровно то, что отдаёт randomUUID().
 * Проверка по этому шаблону нужна при удалении: она отсекает и чужие
 * имена, и попытки выйти за пределы каталога через `../`.
 */
const FILE_NAME_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;

/** UUID пользователя — тоже проверяем, он приходит из URL/БД. */
const USER_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Работа с файлами на диске.
 *
 * Задача сервиса — не дать вызывающему коду собирать пути руками:
 * любое `join(uploads, ...)` снаружи однажды превратится в выход
 * за пределы каталога. Здесь все пути строятся в одном месте
 * и проверяются на принадлежность хранилищу.
 *
 * Сервис НЕ знает про аватарки в базе и не ходит в репозитории:
 * он умеет сохранить буфер и удалить файл. Кто и когда это вызывает —
 * дело вышестоящего сервиса.
 */
@Injectable()
export class StorageService {
  /**
   * Создать каталоги хранилища, если их нет.
   *
   * Вызывается при старте приложения. Почему не «просто при сохранении»:
   * mkdir на каждый запрос — лишний syscall, а главное, ошибка прав
   * (том смонтирован от root) должна быть видна в логах при старте,
   * а не в момент, когда пользователь жмёт «Сохранить».
   */
  async init(): Promise<void> {
    await mkdir(AVATARS_ROOT, { recursive: true });
  }

  /**
   * Сохранить аватарку пользователя.
   *
   * Имя файла генерируем сами: оригинальное имя не используем вообще —
   * в нём приезжают пробелы, юникод, эмодзи и `../`, а нам нужен
   * предсказуемый путь. Побочный эффект приятный: новое имя файла
   * при каждой загрузке работает как cache-busting, поэтому браузер
   * не покажет старую аватарку из кэша.
   *
   * @param userId — владелец файла, он же имя подкаталога
   * @param data — содержимое картинки (после обработки sharp)
   */
  async saveAvatar(userId: string, data: Buffer): Promise<SavedFile> {
    if (!USER_ID_RE.test(userId)) {
      // Сюда попасть нельзя: id приходит из JWT. Но проверка дешёвая,
      // а цена ошибки — запись в произвольный каталог.
      throw new Error(`Некорректный id пользователя: ${userId}`);
    }

    const userDir = join(AVATARS_ROOT, userId);
    await mkdir(userDir, { recursive: true });

    const fileName = `${randomUUID()}.webp`;
    const filePath = join(userDir, fileName);
    await writeFile(filePath, data);

    return { url: `${AVATAR_URL_PREFIX}/${userId}/${fileName}`, filePath };
  }

  /**
   * Удалить аватарку по её публичному URL.
   *
   * Работает по принципу «лучше не удалить, чем удалить не то»: URL
   * разбирается, и удаление происходит, только если путь ведёт ровно
   * в `<uploads>/avatars/<userId>/<uuid>.webp`. Всё остальное — молча
   * игнорируем.
   *
   * Отсюда же следует, что пути на диске для удаления берутся не из
   * строки URL, а пересобираются из проверенных частей: `../` в URL
   * не пройдёт проверку имени файла и id.
   *
   * @param userId — владелец, сверяется с тем, что в URL
   * @param url — значение `users.avatar_url`
   * @returns true, если файл был удалён; false, если удалять было нечего
   *          или URL нам не принадлежит
   */
  async deleteAvatarByUrl(userId: string, url: string): Promise<boolean> {
    const parts = this.parseAvatarUrl(url);
    // Чужой URL не удаляем: это либо старые данные, либо подделка.
    if (!parts || parts.userId !== userId) return false;

    try {
      await unlink(join(AVATARS_ROOT, parts.userId, parts.fileName));
      return true;
    } catch (e) {
      // ENOENT — файла уже нет (например, том пересоздали). Это не ошибка:
      // цель достигнута, файла по этому пути нет.
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw e;
    }
  }

  /**
   * Разобрать URL аватарки на владельца и имя файла.
   *
   * Возвращает null, если URL не наш. Отдельный метод, потому что
   * проверка нужна в двух местах: при удалении старого файла и при
   * сбросе аватарки.
   */
  parseAvatarUrl(
    url: string,
  ): { userId: string; fileName: string } | null {
    const prefix = `${AVATAR_URL_PREFIX}/`;
    if (!url.startsWith(prefix)) return null;

    const rest = url.slice(prefix.length).split('/');
    if (rest.length !== 2) return null;

    const [userId, fileName] = rest as [string, string];
    if (!USER_ID_RE.test(userId) || !FILE_NAME_RE.test(fileName)) return null;

    return { userId, fileName };
  }

  /**
   * Принадлежит ли URL нашему хранилищу аватарок.
   *
   * Нужен, когда файла может уже не быть, а решить «наше это или нет»
   * всё равно надо — например, при сбросе аватарки.
   */
  isAvatarUrl(url: string): boolean {
    return this.parseAvatarUrl(url) !== null;
  }
}
