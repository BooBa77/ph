import { flushPromises, mount } from '@vue/test-utils'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import { ApiError } from '@/api/errors'
import type { PublicUser } from '@/api/users'
import PersonProfile from '@/views/people/PersonProfile.vue'

/**
 * Тесты публичного профиля.
 *
 * Проверяем две вещи: что показывается только публичное (имя, город,
 * «на сайте с») и что удалённый или несуществующий человек не превращается
 * в пустую страницу — 404 объясняется словами.
 *
 * Плюс «Написать» (23.11.2026): кнопка есть только при общем походе
 * и ведёт в личный диалог, который заводит сервер.
 */
vi.mock('@/api/users', () => ({ getPublicUser: vi.fn() }))
vi.mock('@/api/conversations', () => ({ openDirectConversation: vi.fn() }))

import * as api from '@/api/users'
import * as conversations from '@/api/conversations'

const mocked = vi.mocked(api)
const mockedConversations = vi.mocked(conversations)

function makePerson(overrides: Partial<PublicUser> = {}): PublicUser {
  return {
    id: 'u-1',
    displayName: 'Иван',
    avatarUrl: null,
    location: 'Иркутск',
    createdAt: '2026-03-01T10:00:00.000Z',
    isSelf: false,
    hasSharedTrip: false,
    ...overrides,
  }
}

async function open(): Promise<{ wrapper: ReturnType<typeof mount>; router: Router }> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/people', name: 'people', component: { template: '<div />' } },
      { path: '/people/:id', name: 'person', component: PersonProfile },
      { path: '/profile/personal', name: 'profile-personal', component: { template: '<div />' } },
      { path: '/messages/:id', name: 'messages', component: { template: '<div />' } },
    ],
  })
  await router.push('/people/u-1')
  await router.isReady()

  const wrapper = mount(PersonProfile, { global: { plugins: [router] } })
  await flushPromises()

  return { wrapper, router }
}

describe('PersonProfile', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    vi.clearAllMocks()
    mocked.getPublicUser.mockResolvedValue(makePerson())
    mockedConversations.openDirectConversation.mockResolvedValue({
      id: '42',
      kind: 'direct',
      tripId: null,
      title: 'Иван',
      tripTitle: null,
      peer: { id: 'u-1', displayName: 'Иван', avatarUrl: null },
      lastMessage: null,
      unreadCount: 0,
      muted: false,
      peerLastReadAt: null,
      myLastReadAt: null,
    })
  })

  it('показывает имя, город и «на сайте с»', async () => {
    const { wrapper } = await open()

    expect(wrapper.find('[data-test="person-name"]').text()).toBe('Иван')
    expect(wrapper.find('[data-test="person-location"]').text()).toBe('Иркутск')
    expect(wrapper.find('[data-test="person-since"]').text()).toContain('март')
    expect(wrapper.find('[data-test="person-since"]').text()).toContain('2026')
  })

  it('пустой город не рисует строку', async () => {
    mocked.getPublicUser.mockResolvedValue(makePerson({ location: null }))

    const { wrapper } = await open()

    expect(wrapper.find('[data-test="person-location"]').exists()).toBe(false)
  })

  it('свой профиль предлагает открыть настройки профиля', async () => {
    mocked.getPublicUser.mockResolvedValue(makePerson({ isSelf: true }))

    const { wrapper } = await open()

    expect(wrapper.find('[data-test="person-self-link"]').exists()).toBe(true)
  })

  it('чужой профиль ссылки «это вы» не показывает', async () => {
    const { wrapper } = await open()

    expect(wrapper.find('[data-test="person-self-link"]').exists()).toBe(false)
  })

  it('без общего похода кнопки «Написать» нет', async () => {
    const { wrapper } = await open()

    expect(wrapper.find('[data-test="person-write"]').exists()).toBe(false)
    expect(mockedConversations.openDirectConversation).not.toHaveBeenCalled()
  })

  it('при общем походе «Написать» открывает диалог и ведёт в него', async () => {
    mocked.getPublicUser.mockResolvedValue(makePerson({ hasSharedTrip: true }))

    const { wrapper, router } = await open()

    await wrapper.find('[data-test="person-write"]').trigger('click')
    await flushPromises()

    expect(mockedConversations.openDirectConversation).toHaveBeenCalledWith('u-1')
    expect(router.currentRoute.value.path).toBe('/messages/42')
  })

  it('404 объясняется словами, а не пустой страницей', async () => {
    mocked.getPublicUser.mockRejectedValue(new ApiError(404, 'Пользователь не найден', null))

    const { wrapper } = await open()

    expect(wrapper.find('[data-test="person-error"]').text()).toContain('Человек не найден')
  })
})
