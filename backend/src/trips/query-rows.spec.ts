import { describe, expect, it } from 'vitest';

import { returningRows } from './query-rows';

/**
 * Разбор `dataSource.query()` с `RETURNING` (бэклог §54).
 *
 * TypeORM 0.3.20 для `UPDATE`/`DELETE` отдаёт пару `[rows, rowCount]`,
 * а для `INSERT`/`SELECT` — массив строк. Если этот разбор ошибиться,
 * «ничего не нашли» не срабатывает никогда: 404 превращается в 200,
 * а пометка «в альманах» остаётся.
 */
describe('returningRows', () => {
  it('UPDATE/DELETE с найденной строкой отдаёт строки, а не пару', () => {
    expect(returningRows<{ id: string }>([[{ id: 'a' }], 1])).toEqual([
      { id: 'a' },
    ]);
  });

  it('UPDATE/DELETE без строк даёт пустой массив, хотя пара непустая', () => {
    // Это и был дефект: длина пары 2, а строк ноль.
    expect(returningRows<{ id: string }>([[], 0])).toEqual([]);
  });

  it('INSERT … RETURNING отдаёт массив строк как есть', () => {
    expect(returningRows<{ id: string }>([{ id: 'b' }])).toEqual([{ id: 'b' }]);
  });

  it('INSERT без вставки (ON CONFLICT DO NOTHING) даёт пустой массив', () => {
    expect(returningRows<{ id: string }>([])).toEqual([]);
  });

  it('неожиданный результат не роняет разбор', () => {
    expect(returningRows<{ id: string }>(undefined)).toEqual([]);
    expect(returningRows<{ id: string }>(null)).toEqual([]);
    expect(returningRows<{ id: string }>({ rows: [] })).toEqual([]);
  });
});
