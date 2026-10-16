import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/errors'
import type { SessionInfo } from '@/api/sessions'
import { useAppStore } from '@/stores/app'
import Settings from '@/views/profile/sections/UserSettings.vue'

/**
 * Тесты вкладки «Настройки».
 *
 * Здесь две вещи: список устройств (сессии) и переключатель сезонной
 * анимации. API сессий подменён — проверяем, что раздел показывает
 * устройства, помечает текущее и отзывает выбранное.
 */
vi.mock('@/api/sessions', () => ({
  fetchSessions: vi.fn(),
  revokeSession: vi.fn(),
}))

import * as api from '@/api/sessions'

const mocked = vi.mocked(api)

/** Сессия в том виде, в каком её отдаёт бэкенд. */
function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 's1',
    deviceLabel: 'Chrome on Windows',
    createdAt: '2026-10-01T10:00:00.000Z',
    expiresAt: '2027-04-01T10:00:00.000Z',
    isCurrent: true,
    ...overrides,
  }
}

async function mountSection(sessions: SessionInfo[] = [makeSession()]) {
  mocked.fetchSessions.mockResolvedValue(sessions)
  mocked.revokeSession.mockResolvedValue(undefined)

  const wrapper = mount(Settings)
  await flushPromises()
  return wrapper
}

describe('UserSettings', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('показывает устройства, где выполнен вход', async () => {
    const wrapper = await mountSection([
      makeSession({ id: 's1', deviceLabel: 'Chrome on Windows' }),
      makeSession({
        id: 's2',
        deviceLabel: 'Safari on iOS',
        isCurrent: false,
      }),
    ])

    expect(wrapper.text()).toContain('Chrome on Windows')
    expect(wrapper.text()).toContain('Safari on iOS')
    expect(wrapper.text()).toContain('1 октября 2026')
  })

  it('помечает текущее устройство и не предлагает его отозвать', async () => {
    const wrapper = await mountSection()

    expect(wrapper.text()).toContain('это устройство')
    // Для своего устройства выход живёт в меню кабинета, а не здесь.
    expect(wrapper.findAll('button').some((item) => item.text() === 'Выйти на устройстве')).toBe(
      false,
    )
  })

  it('отзывает чужую сессию и перечитывает список', async () => {
    const wrapper = await mountSection([
      makeSession({ id: 's1' }),
      makeSession({ id: 's2', deviceLabel: 'Safari on iOS', isCurrent: false }),
    ])

    const revokeButton = wrapper
      .findAll('button')
      .find((item) => item.text() === 'Выйти на устройстве')
    if (!revokeButton) throw new Error('Нет кнопки отзыва сессии')

    await revokeButton.trigger('click')
    await flushPromises()

    expect(mocked.revokeSession).toHaveBeenCalledWith('s2')
    // Список перечитывается: если бэк отказал, пользователь увидит правду.
    expect(mocked.fetchSessions).toHaveBeenCalledTimes(2)
  })

  it('показывает ошибку, если список не загрузился', async () => {
    mocked.fetchSessions.mockRejectedValue(new ApiError(500, 'Сервер упал'))

    const wrapper = mount(Settings)
    await flushPromises()

    expect(wrapper.text()).toContain('Сервер упал')
  })

  it('показывает ошибку, если отозвать сессию не удалось', async () => {
    mocked.fetchSessions.mockResolvedValue([
      makeSession({ id: 's1' }),
      makeSession({ id: 's2', isCurrent: false }),
    ])
    mocked.revokeSession.mockRejectedValue(new ApiError(404, 'Сессия не найдена'))

    const wrapper = mount(Settings)
    await flushPromises()

    const revokeButton = wrapper
      .findAll('button')
      .find((item) => item.text() === 'Выйти на устройстве')
    if (!revokeButton) throw new Error('Нет кнопки отзыва сессии')

    await revokeButton.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Сессия не найдена')
  })

  it('выключает сезонную анимацию', async () => {
    const wrapper = await mountSection()
    const appStore = useAppStore()

    expect(wrapper.get<HTMLInputElement>('input[type="checkbox"]').element.checked).toBe(true)

    await wrapper.get('input[type="checkbox"]').setValue(false)

    expect(appStore.isSeasonAnimationEnabled).toBe(false)
    expect(localStorage.getItem('ph.seasonAnimation')).toBe('off')
  })

  it('показывает выключенную анимацию снятой галочкой', async () => {
    useAppStore().setSeasonAnimation(false)

    const wrapper = await mountSection()

    expect(wrapper.get<HTMLInputElement>('input[type="checkbox"]').element.checked).toBe(false)
  })
})
