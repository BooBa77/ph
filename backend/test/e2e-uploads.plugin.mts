import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vitest/config';

/** Корень бэкенда — от этого файла на уровень выше. */
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Корень хранилища для e2e. См. комментарий у плагина ниже. */
const E2E_UPLOADS_DIR = join(PROJECT_ROOT, '.tmp-e2e-uploads');

/**
 * Уводит хранилище файлов в отдельный каталог для e2e-прогона.
 *
 * Зачем плагином, а не через `node --env-file` или setup-файл:
 *
 *  - `--env-file` требует, чтобы файл существовал ДО старта Node,
 *    а сгенерировать его успевает только globalSetup, который
 *    запускается уже внутри. Курица и яйцо.
 *  - setup-файл Vitest выполняется после того, как загружены импорты
 *    тестового файла, а `UPLOADS_DIR` — это константа модуля: она
 *    вычисляется в момент импорта и к этому времени уже посчитана.
 *
 * `config()` вызывается на этапе загрузки конфига, то есть раньше
 * и импортов, и setup-файлов. Побочный эффект (переменная окружения
 * и подготовка каталога) здесь оправдан: другого места, которое
 * гарантированно выполнится раньше, у нас нет.
 *
 * Свойство `enforce: 'pre'` — на случай, если в конфиг добавят ещё
 * плагины: порядок вызова `config()` тогда предсказуем.
 */
export function e2eUploads(): Plugin {
  return {
    name: 'e2e-uploads',
    enforce: 'pre',
    config() {
      // Каталог чистим на каждый прогон: иначе тесты, проверяющие
      // удаление файла, зависели бы от следов прошлого запуска.
      rmSync(E2E_UPLOADS_DIR, { recursive: true, force: true });
      mkdirSync(E2E_UPLOADS_DIR, { recursive: true });
      process.env.UPLOADS_DIR = E2E_UPLOADS_DIR;
    },
  };
}
