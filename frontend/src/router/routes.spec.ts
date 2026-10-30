import { describe, expect, it } from 'vitest'

import router from '@/router'

/**
 * Тесты адресов админки.
 *
 * Проверяется форма маршрутов, а не экраны: раздел `/admin` — это родитель
 * с детьми, и от этого зависит подсветка пункта меню (ссылка ведёт в корень
 * раздела, а RouterLink считает её активной на дочерних адресах). Ошибка
 * в форме маршрутов ничем другим не ловится: `vue-tsc` пути не проверяет,
 * а экраны открываются руками.
 *
 * `resolve` не запускает guard и не грузит ленивые компоненты — тест
 * остаётся быстрым и не зависит от того, авторизован ли смотрящий.
 */
describe('маршруты админки', () => {
  it('оглавление раздела живёт на /admin', () => {
    expect(router.resolve('/admin').name).toBe('admin-home')
  })

  it('экраны — дети /admin, а не отдельные маршруты верхнего уровня', () => {
    // Ровно два записи в цепочке: корень раздела и экран. Если /admin/gear
    // снова станет маршрутом верхнего уровня, пункт меню потеряет подсветку.
    expect(router.resolve('/admin/gear').name).toBe('admin-gear')
    expect(router.resolve('/admin/gear').matched.map((record) => record.path)).toEqual([
      '/admin',
      '/admin/gear',
    ])

    expect(router.resolve('/admin/activities').name).toBe('admin-activities')
    expect(router.resolve('/admin/activities').matched.map((record) => record.path)).toEqual([
      '/admin',
      '/admin/activities',
    ])
  })

  it('авторизацию требует родитель, а не каждый ребёнок', () => {
    const requiresAuth = router
      .resolve('/admin/gear')
      .matched.some((record) => record.meta.requiresAuth === true)

    // Guard смотрит на всю цепочку `matched`, поэтому одного флага
    // на родителе хватает и оглавлению, и обоим экранам.
    expect(requiresAuth).toBe(true)
  })
})
