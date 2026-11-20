import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Checklist, ChecklistItem } from '@/types/checklists'
import type { TripFirstAid } from '@/types/firstAid'
import type { Trip } from '@/types/trips'
import TripFirstAidView from '@/views/trips/TripFirstAid.vue'

/**
 * Вкладка «Аптечка» (09.11.2026).
 *
 * Проверяем то, что заказчик назвал словами: две секции, чек-лист прямо
 * в секции, поле веса в конце, общественная секция только при докторе
 * и личная аптечка — своя у каждого.
 */
const mocks = vi.hoisted(() => ({
  getTripFirstAid: vi.fn(),
  setFirstAidWeight: vi.fn(),
}))

vi.mock('@/api/firstAid', () => ({
  getTripFirstAid: mocks.getTripFirstAid,
  setFirstAidWeight: mocks.setFirstAidWeight,
}))

const ME = 'demo-me'

function makeTrip(): Trip {
  return {
    id: '1',
    organizerUserId: ME,
    goalObjectId: '10',
    goalObject: { id: '10', name: 'Витязь', type: 'скальник', url: null },
    announcement: null,
    routeText: '',
    requirementsText: null,
    hasGuitar: false,
    visibility: 'public',
    isRecruitmentClosed: false,
    activityTypeIds: [],
    status: 'decided',
    startsAt: '2026-10-29T00:00:00.000Z',
    endsAt: '2026-10-31T00:00:00.000Z',
    dateVariants: [],
    isCommercial: false,
    isOfficial: false,
    openParticipation: true,
    priceRub: null,
    priceNote: null,
    cancelledAt: null,
    createdAt: '2026-10-14T10:00:00.000Z',
    updatedAt: '2026-10-14T10:00:00.000Z',
  }
}

function item(id: string, title: string, isDone = false): ChecklistItem {
  return {
    id,
    title,
    isDone,
    doneByUserId: null,
    doneAt: null,
    createdByUserId: null,
    gear: null,
    createdAt: '2026-11-12T10:00:00.000Z',
  }
}

function checklist(id: string, scope: 'trip' | 'personal', items: ChecklistItem[] = []): Checklist {
  return {
    id,
    scope,
    area: 'first_aid',
    title: '',
    weightGrams: null,
    tripId: '1',
    ownerUserId: scope === 'personal' ? ME : null,
    items,
    createdAt: '2026-11-12T10:00:00.000Z',
    updatedAt: '2026-11-12T10:00:00.000Z',
  }
}

function state(overrides: Partial<TripFirstAid> = {}): TripFirstAid {
  return {
    doctorUserId: 'doc-1',
    doctorName: 'Анна',
    canEdit: true,
    shared: {
      checklist: checklist('c-public', 'trip', [item('i1', 'Бинт'), item('i2', 'Пластырь')]),
      weightGrams: 900,
      canEdit: true,
    },
    personal: {
      checklist: checklist('c-personal', 'personal'),
      weightGrams: null,
      canEdit: true,
    },
    chatKind: 'trip_first_aid',
    ...overrides,
  }
}

async function mounted() {
  const wrapper = mount(TripFirstAidView, {
    props: { trip: makeTrip() },
    global: {
      stubs: {
        TripGearChecklist: {
          props: ['checklist', 'scope', 'area', 'canManage'],
          template:
            '<div data-test="checklist-stub" :data-scope="scope" :data-area="area">{{ checklist?.items?.length ?? 0 }}</div>',
        },
        TripChat: {
          props: ['tripId', 'kind'],
          template: '<div data-test="chat-stub">чат {{ kind }}</div>',
        },
      },
    },
  })
  await flushPromises()

  return wrapper
}

describe('вкладка «Аптечка»', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    window.localStorage.clear()
    mocks.getTripFirstAid.mockResolvedValue(state())
  })

  it('две секции, чек-лист прямо в них и чат аптечки', async () => {
    const wrapper = await mounted()

    expect(wrapper.find('[data-test="first-aid-public-section"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="first-aid-personal-section"]').exists()).toBe(true)
    expect(wrapper.get('[data-test="first-aid-public-section"] summary').text()).toContain(
      'Общественная аптечка',
    )
    expect(wrapper.get('[data-test="first-aid-personal-section"] summary').text()).toContain(
      'Личная аптечка',
    )
    expect(wrapper.get('[data-test="first-aid-doctor"]').text()).toContain('Анна')

    // Список не завёрнут в ещё одну секцию: он лежит прямо в основной.
    const publicSection = wrapper.get('[data-test="first-aid-public-section"]')
    expect(publicSection.find('[data-test="checklist-stub"]').exists()).toBe(true)
    expect(publicSection.findAll('details').length).toBe(0)

    expect(wrapper.get('[data-test="chat-stub"]').text()).toContain('trip_first_aid')
  })

  it('без доктора общественной секции нет, личная остаётся', async () => {
    mocks.getTripFirstAid.mockResolvedValue(
      state({ doctorUserId: null, doctorName: null, shared: null }),
    )

    const wrapper = await mounted()

    expect(wrapper.find('[data-test="first-aid-public-section"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="first-aid-no-doctor"]').text()).toContain('доктора')
    expect(wrapper.find('[data-test="first-aid-personal-section"]').exists()).toBe(true)
  })

  it('вес секции сохраняется по уходу из поля', async () => {
    const saved = state()
    saved.shared = {
      ...saved.shared!,
      weightGrams: 1200,
    }
    mocks.setFirstAidWeight.mockResolvedValue(saved)

    const wrapper = await mounted()

    const input = wrapper.get('[data-test="first-aid-shared-weight"]')
    expect((input.element as HTMLInputElement).value).toBe('900')

    await input.setValue('1200')
    await input.trigger('blur')
    await flushPromises()

    expect(mocks.setFirstAidWeight).toHaveBeenCalledWith('1', 'shared', 1200)
    expect(
      (wrapper.get('[data-test="first-aid-shared-weight"]').element as HTMLInputElement).value,
    ).toBe('1200')
  })

  it('пустое поле веса — «не взвешена», а не ноль', async () => {
    const saved = state()
    saved.shared = { ...saved.shared!, weightGrams: null }
    mocks.setFirstAidWeight.mockResolvedValue(saved)

    const wrapper = await mounted()

    await wrapper.get('[data-test="first-aid-shared-weight"]').setValue('')
    await wrapper.get('[data-test="first-aid-shared-weight"]').trigger('blur')
    await flushPromises()

    expect(mocks.setFirstAidWeight).toHaveBeenCalledWith('1', 'shared', null)
  })

  it('личный вес уходит своей правкой и не требует права вкладки', async () => {
    const saved = state()
    saved.personal = { ...saved.personal, weightGrams: 300 }
    mocks.setFirstAidWeight.mockResolvedValue(saved)

    const wrapper = await mounted()

    await wrapper.get('[data-test="first-aid-personal-weight"]').setValue('300')
    await wrapper.get('[data-test="first-aid-personal-weight"]').trigger('blur')
    await flushPromises()

    expect(mocks.setFirstAidWeight).toHaveBeenCalledWith('1', 'personal', 300)
  })

  it('без права вкладки общественный вес только читается, личный — правится', async () => {
    mocks.getTripFirstAid.mockResolvedValue(
      state({
        canEdit: false,
        shared: { ...state().shared!, canEdit: false },
      }),
    )

    const wrapper = await mounted()

    expect(
      (wrapper.get('[data-test="first-aid-shared-weight"]').element as HTMLInputElement)
        .disabled,
    ).toBe(true)
    expect(
      (wrapper.get('[data-test="first-aid-personal-weight"]').element as HTMLInputElement)
        .disabled,
    ).toBe(false)
  })
})
