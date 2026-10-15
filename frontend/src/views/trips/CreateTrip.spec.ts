import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/errors'
import CreateTrip from '@/views/trips/CreateTrip.vue'

/**
 * Тесты формы создания похода.
 *
 * Проверяем то, что легко сломать незаметно: что без цели поход не уходит,
 * что тело запроса собирается ровно из того, что видит человек, что
 * правила (цена у коммерческого, обе даты у решённого) ловятся до запроса
 * и что текст ошибки бэкенда не подменяется своим.
 */
const mocks = vi.hoisted(() => ({
  listObjects: vi.fn(),
  createTrip: vi.fn(),
}))

vi.mock('@/api/objects', () => ({ listObjects: mocks.listObjects }))
vi.mock('@/api/trips', () => ({ createTrip: mocks.createTrip }))

const VITYAZ = {
  id: '10',
  name: 'Витязь',
  type: 'скальник',
  url: null,
  parentId: '9',
  parentName: 'Олхинское плато',
}

/** Смонтировать форму и дождаться загрузки справочника. */
async function mountForm(): Promise<VueWrapper> {
  const wrapper = mount(CreateTrip)
  await flushPromises()
  return wrapper
}

/** Выбрать первую цель из списка. */
async function chooseGoal(wrapper: VueWrapper): Promise<void> {
  await wrapper.find('[data-test="goal-options"] button').trigger('click')
  await flushPromises()
}

/** Заполнить всё, что нужно для успешного создания. */
async function fillMinimal(wrapper: VueWrapper): Promise<void> {
  await chooseGoal(wrapper)
  await wrapper.find('[data-test="title"]').setValue('Витязь на майские')
}

describe('CreateTrip', () => {
  beforeEach(() => {
    mocks.listObjects.mockReset()
    mocks.createTrip.mockReset()
    mocks.listObjects.mockResolvedValue([VITYAZ])
    mocks.createTrip.mockResolvedValue({
      id: '1',
      title: 'Витязь на майские',
      status: 'planning',
      visibility: 'public',
      goalObject: { id: '10', name: 'Витязь', type: 'скальник', url: null },
    })
  })

  it('без цели поход создать нельзя', async () => {
    const wrapper = await mountForm()

    expect(wrapper.find('[data-test="submit"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-test="hint"]').text()).toContain('Выберите цель')
    // Кнопка неактивна, но и отправка формы ничего не делает.
    await wrapper.find('form').trigger('submit')
    expect(mocks.createTrip).not.toHaveBeenCalled()
  })

  it('справочник показывается с родителем: имена в нём повторяются', async () => {
    const wrapper = await mountForm()

    expect(wrapper.find('[data-test="goal-options"]').text()).toContain('Витязь · Олхинское плато')
  })

  it('выбранная цель и заполненные поля уходят в теле запроса', async () => {
    const wrapper = await mountForm()
    await fillMinimal(wrapper)
    await wrapper.find('[data-test="status"]').setValue('planning')
    await wrapper.find('[data-test="starts-at"]').setValue('2027-05-05T09:00')
    await wrapper.find('[data-test="ends-at"]').setValue('2027-05-09T18:00')
    await wrapper.find('[data-test="route"]').setValue('Подход от станции')

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mocks.createTrip).toHaveBeenCalledTimes(1)
    expect(mocks.createTrip).toHaveBeenCalledWith({
      goalObjectId: 10,
      title: 'Витязь на майские',
      routeText: 'Подход от станции',
      requirementsText: null,
      visibility: 'public',
      status: 'planning',
      startsAt: new Date('2027-05-05T09:00').toISOString(),
      endsAt: new Date('2027-05-09T18:00').toISOString(),
      isCommercial: false,
      priceRub: null,
      priceNote: null,
    })
  })

  it('коммерческий поход без цены не отправляется', async () => {
    const wrapper = await mountForm()
    await fillMinimal(wrapper)

    await wrapper.find('[data-test="commercial"]').setValue(true)

    expect(wrapper.find('[data-test="price"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="hint"]').text()).toContain('цену')

    await wrapper.find('[data-test="price"]').setValue('25000')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mocks.createTrip).toHaveBeenCalledWith(
      expect.objectContaining({ isCommercial: true, priceRub: 25000 }),
    )
  })

  it('решённый поход требует обеих дат', async () => {
    const wrapper = await mountForm()
    await fillMinimal(wrapper)

    await wrapper.find('[data-test="status"]').setValue('decided')

    expect(wrapper.find('[data-test="hint"]').text()).toContain('обе даты')

    await wrapper.find('[data-test="starts-at"]').setValue('2027-05-05T09:00')
    expect(wrapper.find('[data-test="hint"]').text()).toContain('обе даты')

    await wrapper.find('[data-test="ends-at"]').setValue('2027-05-09T18:00')
    expect(wrapper.find('[data-test="hint"]').exists()).toBe(false)
  })

  it('конец раньше начала не отправляется', async () => {
    const wrapper = await mountForm()
    await fillMinimal(wrapper)
    await wrapper.find('[data-test="starts-at"]').setValue('2027-05-09T09:00')
    await wrapper.find('[data-test="ends-at"]').setValue('2027-05-05T18:00')

    expect(wrapper.find('[data-test="hint"]').text()).toContain('раньше начала')
  })

  it('текст ошибки бэкенда показывается как есть', async () => {
    const wrapper = await mountForm()
    await fillMinimal(wrapper)

    mocks.createTrip.mockRejectedValue(
      new ApiError(400, 'В маршруте есть ссылки на несуществующие объекты', null),
    )

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[data-test="error"]').text()).toContain('несуществующие объекты')
  })

  it('после создания показывается результат, а «Создать ещё» возвращает форму', async () => {
    const wrapper = await mountForm()
    await fillMinimal(wrapper)

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[data-test="created"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="created"]').text()).toContain('Витязь на майские')

    await wrapper.find('[data-test="created"] button').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="created"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="title"]').element).toHaveProperty('value', '')
  })
})
