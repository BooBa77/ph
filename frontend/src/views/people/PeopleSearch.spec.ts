import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { RouterLinkStub } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  FamilyList,
  FamilyMember,
  FamilyUnion,
  FamilyUnionPreview,
  UserSearchResult,
  VirtualUser,
} from '@/api/users'
import PeopleSearch from '@/views/people/PeopleSearch.vue'

/**
 * Тесты «Контактов» — родные и люди без аккаунта (10.11.2026).
 *
 * С 11.11.2026 заявка — на объединение **двух семей целиком**, поэтому
 * проверяем то, что видно только на экране: состав обеих семей до
 * подтверждения, предупреждение «снаряжение станет общим», ответ на
 * входящую заявку, отмену только своей, удаление в два нажатия и запрет
 * удалять того, кто уже сходил в поход. Правила сервера — в e2e
 * (`backend/test/family.e2e-spec.ts`).
 */
vi.mock('@/api/users', () => ({
  getMyFamily: vi.fn(),
  listMyVirtual: vi.fn(),
  searchUsers: vi.fn(),
  getFamilyUnionPreview: vi.fn(),
  addFamilyMember: vi.fn(),
  acceptFamilyUnion: vi.fn(),
  declineFamilyUnion: vi.fn(),
  cancelFamilyUnion: vi.fn(),
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

function makeUnion(overrides: Partial<FamilyUnion> = {}): FamilyUnion {
  return {
    id: 'union-1',
    status: 'pending',
    initiatorUserId: 'u-2',
    initiatorName: 'Иван',
    createdAt: '2026-11-11T00:00:00.000Z',
    myConsent: 'pending',
    isInitiator: false,
    members: [
      {
        userId: 'u-1',
        displayName: 'Анна',
        avatarUrl: null,
        isVirtual: false,
        consent: 'accepted',
        isInitiator: false,
        mine: true,
      },
      {
        userId: 'u-2',
        displayName: 'Иван',
        avatarUrl: null,
        isVirtual: false,
        consent: 'pending',
        isInitiator: true,
        mine: false,
      },
    ],
    ...overrides,
  }
}

function makePreview(overrides: Partial<FamilyUnionPreview> = {}): FamilyUnionPreview {
  return {
    targetUserId: 'u-2',
    targetName: 'Иван',
    pending: false,
    members: [
      {
        userId: 'u-1',
        displayName: 'Анна',
        avatarUrl: null,
        isVirtual: false,
        mine: true,
      },
      {
        userId: 'u-2',
        displayName: 'Иван',
        avatarUrl: null,
        isVirtual: false,
        mine: false,
      },
    ],
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
    mocked.getFamilyUnionPreview.mockResolvedValue(makePreview())
    mocked.addFamilyMember.mockResolvedValue({ unionId: 'union-1', status: 'pending' })
    mocked.acceptFamilyUnion.mockResolvedValue({ unionId: 'union-1', status: 'pending' })
    mocked.declineFamilyUnion.mockResolvedValue(undefined)
    mocked.cancelFamilyUnion.mockResolvedValue(undefined)
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

  it('поиск человека уходит в сервер от двух символов', async () => {
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
    expect(wrapper.find('[data-test="family-add-option"]').exists()).toBe(true)
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

  it('перед заявкой показывает состав обеих семей и предупреждение', async () => {
    mocked.searchUsers.mockResolvedValue([
      { id: 'u-2', displayName: 'Иван', avatarUrl: null } as UserSearchResult,
    ])

    const wrapper = mountSection()
    await flushPromises()

    await wrapper.find('[data-test="family-add-toggle"]').trigger('click')
    await wrapper.find('[data-test="family-add-search"]').setValue('Иван')
    await vi.advanceTimersByTimeAsync(400)
    await flushPromises()

    await wrapper.find('[data-test="family-add-option"]').trigger('click')
    await flushPromises()

    expect(mocked.getFamilyUnionPreview).toHaveBeenCalledWith('u-2')

    const preview = wrapper.find('[data-test="family-union-preview"]')
    expect(preview.exists()).toBe(true)
    expect(preview.text()).toContain('Иван')
    expect(preview.text()).toContain('Анна')
    // «Снаряжение станет общим» — не формальность, а смысл объединения.
    expect(preview.text()).toContain('Снаряжение станет общим')

    // Заявка до подтверждения не создаётся.
    expect(mocked.addFamilyMember).not.toHaveBeenCalled()
  })

  it('подтверждение в предпросмотре создаёт заявку', async () => {
    mocked.searchUsers.mockResolvedValue([
      { id: 'u-2', displayName: 'Иван', avatarUrl: null } as UserSearchResult,
    ])

    const wrapper = mountSection()
    await flushPromises()

    await wrapper.find('[data-test="family-add-toggle"]').trigger('click')
    await wrapper.find('[data-test="family-add-search"]').setValue('Иван')
    await vi.advanceTimersByTimeAsync(400)
    await flushPromises()

    await wrapper.find('[data-test="family-add-option"]').trigger('click')
    await flushPromises()

    await wrapper.find('[data-test="family-union-confirm"]').trigger('click')
    await flushPromises()

    expect(mocked.addFamilyMember).toHaveBeenCalledWith('u-2')
    // Список перечитан: заявка — состояние сервера, а не память экрана.
    expect(mocked.getMyFamily).toHaveBeenCalledTimes(2)
  })

  it('отмена в предпросмотре заявку не создаёт', async () => {
    mocked.searchUsers.mockResolvedValue([
      { id: 'u-2', displayName: 'Иван', avatarUrl: null } as UserSearchResult,
    ])

    const wrapper = mountSection()
    await flushPromises()

    await wrapper.find('[data-test="family-add-toggle"]').trigger('click')
    await wrapper.find('[data-test="family-add-search"]').setValue('Иван')
    await vi.advanceTimersByTimeAsync(400)
    await flushPromises()

    await wrapper.find('[data-test="family-add-option"]').trigger('click')
    await flushPromises()

    await wrapper.find('[data-test="family-union-cancel"]').trigger('click')

    expect(mocked.addFamilyMember).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="family-union-preview"]').exists()).toBe(false)
  })

  it('своего человека без аккаунта можно добавить из поиска сразу', async () => {
    const wrapper = mountSection()
    await flushPromises()

    await wrapper.find('[data-test="family-add-toggle"]').trigger('click')

    const option = wrapper.find('[data-test="family-add-virtual-option"]')
    expect(option.exists()).toBe(true)
    await option.trigger('click')
    await flushPromises()

    // Виртуальному подтверждать нечем — предпросмотра нет.
    expect(mocked.getFamilyUnionPreview).not.toHaveBeenCalled()
    expect(mocked.addFamilyMember).toHaveBeenCalledWith('v-1')
  })

  it('входящая заявка показывает обе семьи и принимается', async () => {
    mocked.getMyFamily.mockResolvedValue(makeFamily({ incoming: [makeUnion()] }))

    const wrapper = mountSection()
    await flushPromises()

    const block = wrapper.find('[data-test="family-incoming"]')
    expect(block.exists()).toBe(true)
    expect(block.text()).toContain('Иван')
    expect(block.text()).toContain('Твоя семья: Анна')
    expect(block.text()).toContain('Другая семья: Иван')

    await wrapper.find('[data-test="family-accept"]').trigger('click')
    await flushPromises()

    expect(mocked.acceptFamilyUnion).toHaveBeenCalledWith('union-1')
  })

  it('после согласия всех сообщает, что семьи объединены', async () => {
    mocked.getMyFamily.mockResolvedValue(makeFamily({ incoming: [makeUnion()] }))
    mocked.acceptFamilyUnion.mockResolvedValue({ unionId: 'union-1', status: 'accepted' })

    const wrapper = mountSection()
    await flushPromises()

    await wrapper.find('[data-test="family-accept"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="contacts-notice"]').text()).toContain('объединены')
  })

  it('входящую заявку можно отклонить', async () => {
    mocked.getMyFamily.mockResolvedValue(makeFamily({ incoming: [makeUnion()] }))

    const wrapper = mountSection()
    await flushPromises()

    await wrapper.find('[data-test="family-decline"]').trigger('click')
    await flushPromises()

    expect(mocked.declineFamilyUnion).toHaveBeenCalledWith('union-1')
  })

  it('свою заявку видно и можно отменить', async () => {
    mocked.getMyFamily.mockResolvedValue(
      makeFamily({
        outgoing: [
          makeUnion({ isInitiator: true, myConsent: 'accepted' }),
        ],
      }),
    )

    const wrapper = mountSection()
    await flushPromises()

    expect(wrapper.find('[data-test="family-outgoing-item"]').text()).toContain('Иван')
    await wrapper.find('[data-test="family-cancel"]').trigger('click')
    await flushPromises()

    expect(mocked.cancelFamilyUnion).toHaveBeenCalledWith('union-1')
  })

  it('у чужой заявки, где я только согласился, отмены нет', async () => {
    mocked.getMyFamily.mockResolvedValue(
      makeFamily({
        outgoing: [makeUnion({ isInitiator: false, myConsent: 'accepted' })],
      }),
    )

    const wrapper = mountSection()
    await flushPromises()

    expect(wrapper.find('[data-test="family-outgoing-item"]').exists()).toBe(true)
    // Отменить заявку может только тот, кто её создал.
    expect(wrapper.find('[data-test="family-cancel"]').exists()).toBe(false)
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
