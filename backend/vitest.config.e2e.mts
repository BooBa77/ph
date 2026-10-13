import { defineConfig } from 'vitest/config';
import { e2eUploads } from './test/e2e-uploads.plugin.mts';

/**
 * Конфиг Vitest для e2e-тестов (test/**\/*.e2e-spec.ts).
 *
 * Вынесен отдельно от vitest.config.ts, потому что e2e поднимает всё
 * приложение целиком — вместе с подключением к БД. Настройки SWC те же:
 * без метаданных декораторов NestJS не соберёт граф зависимостей.
 *
 * Плагин `e2eUploads` уводит каталог загруженных файлов в сторону
 * от боевого хранилища — подробности в самом плагине.
 *
 * Переключатель `VITEST_NO_SWC` — как в `vitest.config.mts`: он нужен, чтобы
 * локально в песочнице DSH конфиг вообще загружался (аддон SWC не проходит
 * проверку ACL). В CI переменная не выставляется и SWC работает.
 */
const useSwc = process.env.VITEST_NO_SWC !== '1';

const plugins = useSwc
  ? [
      e2eUploads(),
      (
        await import('unplugin-swc')
      ).default.vite({
        jsc: {
          parser: { syntax: 'typescript', decorators: true },
          transform: { legacyDecorator: true, decoratorMetadata: true },
          target: 'es2023',
        },
        module: { type: 'es6' },
      }),
    ]
  : [e2eUploads()];

export default defineConfig({
  test: {
    root: './',
    environment: 'node',
    include: ['test/**/*.e2e-spec.ts'],
    // Файлы прогоняются последовательно: тесты идут в одну живую БД
    // и в один каталог файлов, параллельный запуск дал бы гонки.
    fileParallelism: false,
  },
  plugins,
});
