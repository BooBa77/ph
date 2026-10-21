import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RouterLinkStub } from '@vue/test-utils'

import type { UserSearchResult } from '@/api/users'
import PeopleSearch from '@/views/people/PeopleSearch.vue'

/**
 * Тесты «Контактов» (поиск людей).
 *
 * Проверяем порог поиска и подсказки: до двух символов запрос не уходит
 * вовсе, пустой запрос ничего не показывает (список всех — это простыня,
 * а не выбор), а карточка ведёт в публичный профиль.
 */
vi.mock('@/api/users', () => ({ searchUsers: vi.fn() }))

import * as api from '@/api/users'

const mocked = vi.mocked(api)

function makePerson(overrides: Partial<UserSearchResult> = {}): UserSearchResult {
  return { id: 'u-1', displayName: 'Иван', avatarUrl: null, ...overrides }
}

function mountSection(): VueWrapper {
  return mount(PeopleSearch, { global: { stubs: { RouterLink: RouterLinkStub } } })
}

describe('PeopleSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocked.searchUsers.mockResolvedValue([makePerson()])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('до двух символов запрос не отправляется', async () => {
    const wrapper = mountSection()

    await wrapper.find('[data-test="people-search"]').setValue('И')
    await vi.advanceTimersByTimeAsync(400)

    expect(mocked.searchUsers).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="people-hint"]').exists()).toBe(true)
  })

  it('находит человека и показывает карточку', async () => {
    const wrapper = mountSection()

    await wrapper.find('[data-test="people-search"]').setValue('Иван')
    await vi.advanceTimersByTimeAsync(400)
    await flushPromises()

    expect(mocked.searchUsers).toHaveBeenCalledWith('Иван')
    const option = wrapper.find('[data-test="people-option"]')
    expect(option.exists()).toBe(true)
    expect(option.text()).toContain('Иван')
  })

  it('карточка ведёт в публичный профиль', async () => {
    const wrapper = mountSection()

    await wrapper.find('[data-test="people-search"]').setValue('Иван')
    await vi.advanceTimersByTimeAsync(400)
    await flushPromises()

    expect(wrapper.findComponent(RouterLinkStub).props('to')).toEqual({
      name: 'person',
      params: { id: 'u-1' },
    })
  })

  it('пустой ответ объясняет, что делать', async () => {
    mocked.searchUsers.mockResolvedValue([])
    const wrapper = mountSection()

    await wrapper.find('[data-test="people-search"]').setValue('Иван')
    await vi.advanceTimersByTimeAsync(400)
    await flushPromises()

    expect(wrapper.find('[data-test="people-nothing"]').text()).toContain('Никого')
  })

  it('ошибку поиска показывает, а не молчит', async () => {
    mocked.searchUsers.mockRejectedValue(new Error('сеть'))
    const wrapper = mountSection()

    await wrapper.find('[data-test="people-search"]').setValue('Иван')
    await vi.advanceTimersByTimeAsync(400)
    await flushPromises()

    expect(wrapper.find('[data-test="people-error"]').text()).toContain('Не удалось')
  })
})
