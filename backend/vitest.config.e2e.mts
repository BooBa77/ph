import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Конфиг Vitest для e2e-тестов (test/**\/*.e2e-spec.ts).
 *
 * Вынесен отдельно от vitest.config.ts, потому что e2e поднимает всё
 * приложение целиком — вместе с подключением к БД. Настройки SWC те же:
 * без метаданных декораторов NestJS не соберёт граф зависимостей.
 */
const swcPlugin = swc.vite({
  jsc: {
    parser: { syntax: 'typescript', decorators: true },
    transform: { legacyDecorator: true, decoratorMetadata: true },
    target: 'es2023',
  },
  module: { type: 'es6' },
});

export default defineConfig({
  test: {
    root: './',
    environment: 'node',
    include: ['test/**/*.e2e-spec.ts'],
  },
  plugins: [swcPlugin],
});
