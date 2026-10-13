import { defineConfig } from 'vitest/config';

/**
 * Конфиг Vitest для юнит-тестов (src/**\/*.spec.ts).
 *
 * Зачем SWC, а не штатный транспайлер Vitest (esbuild): NestJS держится
 * на emitDecoratorMetadata — по метаданным типов он понимает, что
 * подставлять в конструктор. esbuild эти метаданные не генерирует,
 * и внедрение зависимостей падает, не найдя провайдера. SWC умеет.
 *
 * ## Переключатель VITEST_NO_SWC
 *
 * Нативный аддон SWC проверяет ACL каталога кэша, и в песочнице DSH проверка не
 * проходит ни на одном пути — поэтому локальный запуск идёт без SWC (переменную
 * ставит `fvds/scripts/test-backend.ps1`). Тот же приём сделан в u40ta, чтобы
 * тесты в обоих проектах запускались одинаково.
 *
 * В CI переменная не выставляется, поэтому там подключается SWC и работают в
 * том числе тесты с внедрением зависимостей.
 */
const useSwc = process.env.VITEST_NO_SWC !== '1';

/** Динамический импорт: статический загрузил бы аддон даже при отключённом SWC. */
const plugins = useSwc
  ? [
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
  : [];

export default defineConfig({
  test: {
    root: './',
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/migrations/**'],
    },
  },
  plugins,
});
