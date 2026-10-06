import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StorageService as StorageServiceType } from './storage.service';

const USER_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const OTHER_USER_ID = '9c858901-8a57-4791-81fe-4c455b099bc9';

/**
 * Корень хранилища и URL-префикс.
 *
 * Заполняются в beforeAll, до первого динамического импорта модуля
 * конфигурации: `UPLOADS_DIR` — это константа модуля, она вычисляется
 * в момент импорта. Поэтому переменную окружения выставляем заранее,
 * а сам модуль подгружаем уже после этого.
 */
let dir = '';
let service: StorageServiceType;
let avatarUrlPrefix = '';

/**
 * Пути в URL и на диске — самая опасная часть работы с загрузками:
 * ошибка здесь означает запись или удаление файла за пределами
 * хранилища. Поэтому разбор URL проверяем отдельно и злобно.
 */
describe('StorageService', () => {
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ph-storage-'));
    process.env.UPLOADS_DIR = dir;

    const [{ StorageService }, { AVATAR_URL_PREFIX }] = await Promise.all([
      import('./storage.service'),
      import('../config/uploads.config'),
    ]);
    avatarUrlPrefix = AVATAR_URL_PREFIX;

    service = new StorageService();
    await service.init();
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('сохраняет файл и возвращает публичный URL', async () => {
    const saved = await service.saveAvatar(USER_ID, Buffer.from('данные'));

    expect(saved.url).toMatch(
      new RegExp(`^${avatarUrlPrefix}/${USER_ID}/[0-9a-f-]{36}\\.webp$`),
    );
    expect(readFileSync(saved.filePath).toString()).toBe('данные');
  });

  it('отказывается сохранять с некорректным id пользователя', async () => {
    await expect(
      service.saveAvatar('../../etc', Buffer.from('x')),
    ).rejects.toThrow(/Некорректный id/);
  });

  it('разбирает свой URL', () => {
    const url = `${avatarUrlPrefix}/${USER_ID}/3f2504e0-4f89-41d3-9a0c-0305e82c3301.webp`;
    expect(service.parseAvatarUrl(url)).toEqual({
      userId: USER_ID,
      fileName: '3f2504e0-4f89-41d3-9a0c-0305e82c3301.webp',
    });
  });

  it.each([
    [
      'чужой префикс',
      `/uploads/avatars/${USER_ID}/3f2504e0-4f89-41d3-9a0c-0305e82c3301.webp`,
    ],
    [
      'абсолютный URL на чужой хост',
      `https://evil.example.com/avatars/${USER_ID}/3f2504e0-4f89-41d3-9a0c-0305e82c3301.webp`,
    ],
    [
      'выход из каталога',
      `${avatarUrlPrefix}/${USER_ID}/../../../etc/passwd`,
    ],
    [
      'чужое расширение',
      `${avatarUrlPrefix}/${USER_ID}/3f2504e0-4f89-41d3-9a0c-0305e82c3301.png`,
    ],
    ['произвольное имя файла', `${avatarUrlPrefix}/${USER_ID}/avatar.webp`],
    [
      'не UUID в id',
      `${avatarUrlPrefix}/../../etc/3f2504e0-4f89-41d3-9a0c-0305e82c3301.webp`,
    ],
    [
      'лишний сегмент пути',
      `${avatarUrlPrefix}/${USER_ID}/sub/3f2504e0-4f89-41d3-9a0c-0305e82c3301.webp`,
    ],
    ['пустая строка', ''],
  ])('не считает своим URL: %s', (_title, url) => {
    expect(service.parseAvatarUrl(url)).toBeNull();
    expect(service.isAvatarUrl(url)).toBe(false);
  });

  it('удаляет только свой файл', async () => {
    const saved = await service.saveAvatar(USER_ID, Buffer.from('x'));

    // Чужой пользователь по тому же URL — не удаляем.
    await expect(
      service.deleteAvatarByUrl(OTHER_USER_ID, saved.url),
    ).resolves.toBe(false);
    expect(readFileSync(saved.filePath)).toBeDefined();

    await expect(service.deleteAvatarByUrl(USER_ID, saved.url)).resolves.toBe(
      true,
    );
    // Повторное удаление — не ошибка: файла просто нет.
    await expect(service.deleteAvatarByUrl(USER_ID, saved.url)).resolves.toBe(
      false,
    );
  });
});
