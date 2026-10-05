import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Конфиг Vitest для юнит-тестов (src/**\/*.spec.ts).
 *
 * Зачем SWC, а не штатный транспайлер Vitest (esbuild): NestJS держится
 * на emitDecoratorMetadata — по метаданным типов он понимает, что
 * подставлять в конструктор. esbuild эти метаданные не генерирует,
 * и внедрение зависимостей падает, не найдя провайдера. SWC умеет.
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
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/migrations/**'],
    },
  },
  plugins: [swcPlugin],
});
