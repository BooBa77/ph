import { describe, expect, it } from 'vitest'

import { offlineRedirect } from '@/offline/navigation'

/**
 * Куда пускать в офлайне.
 *
 * Правило заказчика: без связи доступен только текущий по датам поход,
 * остальное либо не видно, либо не активно. Функция чистая, поэтому
 * проверяется без роутера, сети и IndexedDB.
 */
describe('offlineRedirect', () => {
  it('пускает на текущий поход', () => {
    expect(offlineRedirect('trip', '679', ['679'])).toBeNull()
  })

  it('не пускает на прошедший или чужой поход', () => {
    // Один текущий — разворачиваем именно на него, а не просто «нельзя».
    expect(offlineRedirect('trip', '700', ['679'])).toEqual({
      name: 'trip',
      params: { id: '679' },
    })
  })

  it('оставляет «Мои походы» и экран «нет связи»', () => {
    expect(offlineRedirect('trips-mine', '', ['679'])).toBeNull()
    expect(offlineRedirect('offline', '', [])).toBeNull()
  })

  it('остальные адреса разворачивает на единственный текущий поход', () => {
    expect(offlineRedirect('home', '', ['679'])).toEqual({ name: 'trip', params: { id: '679' } })
    expect(offlineRedirect('profile-personal', '', ['679'])).toEqual({
      name: 'trip',
      params: { id: '679' },
    })
    expect(offlineRedirect('trip-edit', '679', ['679'])).toEqual({
      name: 'trip',
      params: { id: '679' },
    })
  })

  it('несколько текущих — ведёт в «Мои походы»: там видно только их', () => {
    expect(offlineRedirect('home', '', ['679', '680'])).toEqual({ name: 'trips-mine' })
  })

  it('ни одного текущего — ведёт на объяснение', () => {
    expect(offlineRedirect('home', '', [])).toEqual({ name: 'offline' })
    expect(offlineRedirect('trip', '679', [])).toEqual({ name: 'offline' })
  })
})
