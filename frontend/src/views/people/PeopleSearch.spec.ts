import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { RouterLinkStub } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  FamilyList,
  FamilyMember,
  FamilyRequest,
  UserSearchResult,
  VirtualUser,
} from '@/api/users'
import PeopleSearch from '@/views/people/PeopleSearch.vue'

/**
 * Тесты «Контактов» — родные и люди без аккаунта (10.11.2026).
 *
 * Проверяем то, что видно только на экране: две секции, поиск по своим,
 * запрос с подтверждением, удаление в два нажатия и запрет удалять того,
 * кто уже сходил в поход. Правила сервера — в e2e
 * (`backend/test/family.e2e-spec.ts`).
 */
vi.mock('@/api/users', () => ({
  getMyFamily: vi.fn(),
  listMyVirtual: vi.fn(),
  searchUsers: vi.fn(),
  addFamilyMember: vi.fn(),
  acceptFamilyMember: vi.fn(),
  declineFamilyMember: vi.fn(),
  removeFamilyMember: vi.fn(),
  leaveFamily: vi.fn(),
  createVirtual: vi.fn(),
  removeVirtual: vi.fn(),
}))

import * as api from '@/api/users'

const mocked = vi.mocked(api)

function makeMember(overrides: Partial<FamilyMember> = {}): FamilyMember {
  return {
    userId: 'u-1',
    displayName: 'Анна',
    avatarUrl: null,
    isVirtual: false,
    since: '2026-11-10T00:00:00.000Z',
    ...overrides,
  }
}

function makeRequest(overrides: Partial<FamilyRequest> = {}): FamilyRequest {
  return {
    userId: 'u-2',
    displayName: 'Иван',
    avatarUrl: null,
    direction: 'incoming',
    requestedAt: '2026-11-10T00:00:00.000Z',
    ...overrides,
  }
}

function makeVirtual(overrides: Partial<VirtualUser> = {}): VirtualUser {
  return {
    id: 'v-1',
    displayName: 'Дядя Витя',
    gender: 'm',
    createdAt: '2026-11-10T00:00:00.000Z',
    tripsCount: 0,
    canDelete: true,
    blockedByTrip: null,
    ...overrides,
  }
}

function makeFamily(overrides: Partial<FamilyList> = {}): FamilyList {
  return { family: [makeMember()], incoming: [], outgoing: [], ...overrides }
}

function mountSection(): VueWrapper {
  return mount(PeopleSearch, {
    global: { stubs: { RouterLink: RouterLinkStub } },
  })
}

describe('PeopleSearch (Контакты)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    window.localStorage.clear()

    mocked.getMyFamily.mockResolvedValue(makeFamily())
    mocked.listMyVirtual.mockResolvedValue([makeVirtual()])
    mocked.searchUsers.mockResolvedValue([])
    mocked.addFamilyMember.mockResolvedValue({ userId: 'u-2', status: 'pending' })
    mocked.acceptFamilyMember.mockResolvedValue({ userId: 'u-2', status: 'accepted' })
    mocked.declineFamilyMember.mockResolvedValue(undefined)
    mocked.removeFamilyMember.mockResolvedValue(undefined)
    mocked.createVirtual.mockResolvedValue(makeVirtual())
    mocked.removeVirtual.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    window.localStorage.clear()
  })

  it('показывает две секции и список родных', async () => {
    const wrapper = mountSection()
    await flushPromises()

    expect(wrapper.find('[data-test="contacts-family"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="contacts-virtual"]').exists()).toBe(true)

    const member = wrapper.find('[data-test="family-member"]')
    expect(member.exists()).toBe(true)
    expect(member.text()).toContain('Анна')
  })

  it('секция «Родные» открыта по умолчанию и помнит сворачивание', async () => {
    window.localStorage.setItem('ph.contacts.open', JSON.stringify({ family: false }))

    const wrapper = mountSection()
    await flushPromises()

    const family = wrapper.find('[data-test="contacts-family"]').element as HTMLDetailsElement
    const virtual = wrapper.find('[data-test="contacts-virtual"]').element as HTMLDetailsElement

    expect(family.open).toBe(false)
    expect(virtual.open).toBe(true)
  })

  it('фильтр по родным оставляет только совпадения', async () => {
    mocked.getMyFamily.mockResolvedValue(
      makeFamily({
        family: [makeMember(), makeMember({ userId: 'u-3', displayName: 'Пётр' })],
      }),
    )
    const wrapper = mountSection()
    await flushPromises()

    await wrapper.find('[data-test="family-filter"]').setValue('Пётр')

    const members = wrapper.findAll('[data-test="family-member"]')
    expect(members).toHaveLength(1)
    expect(members[0]?.text()).toContain('Пётр')
  })

  it('пустой фильтр объясняет, что никого нет', async () => {
    const wrapper = mountSection()
    await flushPromises()

    await wrapper.find('[data-test="family-filter"]').setValue('Никого')

    expect(wrapper.find('[data-test="family-filter-empty"]').exists()).toBe(true)
  })

  it('поиск человека уходит в сервер от двух символов и добавляет его', async () => {
    mocked.searchUsers.mockResolvedValue([
      { id: 'u-2', displayName: 'Иван', avatarUrl: null } as UserSearchResult,
    ])

    const wrapper = mountSection()
    await flushPromises()

    await wrapper.find('[data-test="family-add-toggle"]').trigger('click')
    await wrapper.find('[data-test="family-add-search"]').setValue('Иван')
    await vi.advanceTimersByTimeAsync(400)
    await flushPromises()

    expect(mocked.searchUsers).toHaveBeenCalledWith('Иван')

    const option = wrapper.find('[data-test="family-add-option"]')
    expect(option.exists()).toBe(true)
    await option.trigger('click')
    await flushPromises()

    expect(mocked.addFamilyMember).toHaveBeenCalledWith('u-2')
    // Список перечитан: «ждём подтверждения» — это состояние сервера.
    expect(mocked.getMyFamily).toHaveBeenCalledTimes(2)
  })

  it('до двух символов запрос не уходит', async () => {
    const wrapper = mountSection()
    await flushPromises()

    await wrapper.find('[data-test="family-add-toggle"]').trigger('click')
    await wrapper.find('[data-test="family-add-search"]').setValue('И')
    await vi.advanceTimersByTimeAsync(400)

    expect(mocked.searchUsers).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="family-add-hint"]').exists()).toBe(true)
  })

  it('своего человека без аккаунта можно добавить в родные из поиска', async () => {
    const wrapper = mountSection()
    await flushPromises()

    await wrapper.find('[data-test="family-add-toggle"]').trigger('click')

    const option = wrapper.find('[data-test="family-add-virtual-option"]')
    expect(option.exists()).toBe(true)
    await option.trigger('click')
    await flushPromises()

    expect(mocked.addFamilyMember).toHaveBeenCalledWith('v-1')
  })

  it('входящий запрос можно принять', async () => {
    mocked.getMyFamily.mockResolvedValue(makeFamily({ incoming: [makeRequest()] }))

    const wrapper = mountSection()
    await flushPromises()

    expect(wrapper.find('[data-test="family-incoming"]').exists()).toBe(true)
    await wrapper.find('[data-test="family-accept"]').trigger('click')
    await flushPromises()

    expect(mocked.acceptFamilyMember).toHaveBeenCalledWith('u-2')
  })

  it('входящий запрос можно отклонить', async () => {
    mocked.getMyFamily.mockResolvedValue(makeFamily({ incoming: [makeRequest()] }))

    const wrapper = mountSection()
    await flushPromises()

    await wrapper.find('[data-test="family-decline"]').trigger('click')
    await flushPromises()

    expect(mocked.declineFamilyMember).toHaveBeenCalledWith('u-2')
  })

  it('свой запрос виден и отменяется', async () => {
    mocked.getMyFamily.mockResolvedValue(
      makeFamily({ outgoing: [makeRequest({ direction: 'outgoing' })] }),
    )

    const wrapper = mountSection()
    await flushPromises()

    expect(wrapper.find('[data-test="family-outgoing-item"]').text()).toContain('Иван')
    await wrapper.find('[data-test="family-cancel"]').trigger('click')
    await flushPromises()

    expect(mocked.removeFamilyMember).toHaveBeenCalledWith('u-2')
  })

  it('из семьи выходят одной кнопкой, спросив подтверждение', async () => {
    const wrapper = mountSection()
    await flushPromises()

    // Крестика у отдельного родного больше нет: разорвать одну связь нельзя.
    expect(wrapper.find('[data-test="family-remove"]').exists()).toBe(false)

    await wrapper.find('[data-test="family-leave"]').trigger('click')
    expect(mocked.leaveFamily).not.toHaveBeenCalled()

    await wrapper.find('[data-test="family-leave-cancel"]').trigger('click')
    expect(wrapper.find('[data-test="family-leave"]').exists()).toBe(true)

    await wrapper.find('[data-test="family-leave"]').trigger('click')
    await wrapper.find('[data-test="family-leave-confirm"]').trigger('click')
    await flushPromises()

    expect(mocked.leaveFamily).toHaveBeenCalledTimes(1)
  })

  it('виртуального заводят из формы', async () => {
    const wrapper = mountSection()
    await flushPromises()

    await wrapper.find('[data-test="virtual-name"]').setValue('Петя')
    await wrapper.find('[data-test="virtual-form"]').trigger('submit')
    await flushPromises()

    expect(mocked.createVirtual).toHaveBeenCalledWith({
      displayName: 'Петя',
      gender: 'm',
    })
    expect(mocked.listMyVirtual).toHaveBeenCalledTimes(2)
  })

  it('короткое имя завести не даёт', async () => {
    const wrapper = mountSection()
    await flushPromises()

    await wrapper.find('[data-test="virtual-name"]').setValue('П')
    await wrapper.find('[data-test="virtual-form"]').trigger('submit')

    expect(mocked.createVirtual).not.toHaveBeenCalled()
  })

  it('удаление виртуального — в два нажатия', async () => {
    const wrapper = mountSection()
    await flushPromises()

    const remove = wrapper.find('[data-test="virtual-remove"]')
    await remove.trigger('click')

    expect(mocked.removeVirtual).not.toHaveBeenCalled()
    expect(remove.text()).toContain('Точно?')

    await remove.trigger('click')
    await flushPromises()

    expect(mocked.removeVirtual).toHaveBeenCalledWith('v-1')
  })

  it('того, кто уже сходил в поход, удалить нельзя', async () => {
    mocked.listMyVirtual.mockResolvedValue([
      makeVirtual({
        tripsCount: 2,
        canDelete: false,
        blockedByTrip: {
          id: '679',
          title: 'Витязь',
          startedAt: '2026-11-01T00:00:00.000Z',
        },
      }),
    ])

    const wrapper = mountSection()
    await flushPromises()

    expect(wrapper.find('[data-test="virtual-remove"]').exists()).toBe(false)

    // Подпись говорит правило, а не «был»: запрет считается по датам похода.
    const blocked = wrapper.find('[data-test="virtual-delete-blocked"]')
    expect(blocked.text()).toContain('поход уже начался')
    expect(blocked.attributes('title')).toContain('«Витязь»')

    // Счётчик походов в строке не дублирует причину: подписи хватает.
    expect(wrapper.find('[data-test="virtual-trips"]').exists()).toBe(false)
  })

  it('в заголовках секций нет количества записей', async () => {
    // Заказчик 10.11.2026: «не нужны количества записей в секциях».
    const wrapper = mountSection()
    await flushPromises()

    expect(wrapper.find('[data-test="family-count"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="virtual-count"]').exists()).toBe(false)
  })

  it('ошибку загрузки показывает, а не молчит', async () => {
    mocked.getMyFamily.mockRejectedValue(new Error('сеть'))

    const wrapper = mountSection()
    await flushPromises()

    expect(wrapper.find('[data-test="contacts-error"]').text()).toContain(
      'Не удалось загрузить',
    )
  })

  it('ошибку удаления объясняет словами сервера', async () => {
    mocked.removeVirtual.mockRejectedValue(new Error('сеть'))

    const wrapper = mountSection()
    await flushPromises()

    await wrapper.find('[data-test="virtual-remove"]').trigger('click')
    await wrapper.find('[data-test="virtual-remove"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="virtual-error"]').exists()).toBe(true)
  })
})
