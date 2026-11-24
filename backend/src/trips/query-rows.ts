/**
 * Строки из результата `dataSource.query()` для запроса с `RETURNING`.
 *
 * Грабля TypeORM 0.3.20 (`topics/messages.md` §12): для `UPDATE`/`DELETE`
 * драйвер отдаёт **пару `[rows, rowCount]`**, а для `INSERT`/`SELECT` —
 * сразу массив строк. Проверка вида `(result as unknown[]).length === 0`
 * для пары всегда ложна: длина 2 даже когда не обновлено ни строки. Именно
 * поэтому удаление строки альманаха не снимало пометку «в альманах»
 * и отвечало 200 на несуществующий id (бэклог §54).
 *
 * Хелпер сводит оба вида к одному: массив строк. Первый элемент пары —
 * массив, массив строк — нет; этого достаточно и не требует знать команду,
 * породившую результат.
 */
export function returningRows<T>(result: unknown): T[] {
  if (!Array.isArray(result)) return [];

  const [first] = result;
  return Array.isArray(first) ? (first as T[]) : (result as T[]);
}
