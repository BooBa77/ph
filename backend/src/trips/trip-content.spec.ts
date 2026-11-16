import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { touchedTripId } from './trip-content.interceptor';

/**
 * Какие запросы поднимают отметку свежести похода.
 *
 * Это единственная проверяемая здесь часть механизма: сам `UPDATE` пишет
 * одна строка SQL, и её смысл — в том, **на какие запросы** он срабатывает.
 * Покрытие важнее: забытая ручка не поднимает счётчик, и кэш навсегда
 * считает себя свежим (`lifecycle.md` §2.4, риск 1).
 *
 * Проверка идёт по маршруту, а не по URL: у реального Express-запроса
 * `route.path` — это шаблон `/trips/:id/...`, а не конкретный адрес.
 */
function context(
  method: string,
  path: string,
  params: Record<string, string> = { id: '679' },
): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({ method, route: { path }, params }),
    }),
  } as unknown as ExecutionContext;
}

describe('touchedTripId', () => {
  it('правка любой вкладки — это правка похода', () => {
    const paths = [
      '/trips/:id',
      '/trips/:id/cancel',
      '/trips/:id/participants/me',
      '/trips/:id/participants/:userId/roles',
      '/trips/:id/requests',
      '/trips/:id/meal-plan',
      '/trips/:id/meals/:dayIndex/:kind/lines/:productId',
      '/trips/:id/meal-packages/:packageId',
      '/trips/:id/meal-checks/:productId',
      '/trips/:id/transfer/legs/:legId',
      '/trips/:id/route/sleeping',
      '/trips/:id/route/lodgers/:userId',
      '/trips/:id/finance/expenses/:expenseId',
    ];

    for (const path of paths) {
      expect(touchedTripId(context('PATCH', path)), path).not.toBeNull();
    }
  });

  it('чтение отметку не поднимает', () => {
    expect(touchedTripId(context('GET', '/trips/:id'))).toBeNull();
    expect(touchedTripId(context('GET', '/trips/:id/cache-state'))).toBeNull();
  });

  it('личные ветки не делают общую копию устаревшей', () => {
    // Дневник личный: чужих записей в нём нет.
    expect(touchedTripId(context('POST', '/trips/:id/diary/sync'))).toBeNull();
    // «Моё» питание — тоже личное.
    expect(touchedTripId(context('POST', '/trips/:id/my-meals/:dayIndex/:kind/lines'))).toBeNull();
    expect(touchedTripId(context('PUT', '/trips/:id/my-meal-checks/:productId'))).toBeNull();
    // У чатов свои курсоры.
    expect(touchedTripId(context('POST', '/trips/:id/messages'))).toBeNull();
  });

  it('создание похода — не правка существующего', () => {
    expect(touchedTripId(context('POST', '/trips', {}))).toBeNull();
  });

  it('нечисловой id не трогает ничего', () => {
    expect(touchedTripId(context('PATCH', '/trips/:id', { id: 'types' }))).toBeNull();
  });

  it('не-HTTP контекст пропускается', () => {
    const notHttp = {
      getType: () => 'rpc',
      switchToHttp: () => {
        throw new Error('не должен вызываться');
      },
    } as unknown as ExecutionContext;

    expect(touchedTripId(notHttp)).toBeNull();
  });
});
