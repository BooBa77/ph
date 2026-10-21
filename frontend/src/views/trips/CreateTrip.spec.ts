import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import { ApiError } from '@/api/errors'
import CreateTrip from '@/views/trips/CreateTrip.vue'

/**
 * Тесты формы создания похода.
 *
 * Проверяем то, что легко сломать незаметно и на что указал заказчик:
 * что без цели поход не уходит, что от готовности зависит **способ ввода
 * дат**, а не только подсказка, что прокликанные месяцы становятся
 * вариантами, что поля собираются в правильное тело запроса, и что текст
 * ошибки бэкенда не подменяется своим.
 *
 * Таймеры поддельные: у поиска объекта задержка, и ждать её по-настоящему
 * значит делать тесты медленными и мигающими.
 */
const mocks = vi.hoisted(() => ({
  listObjects: vi.fn(),
  createTrip: vi.fn(),
  listTripTypes: vi.fn(),
}))

vi.mock('@/api/objects', () => ({ listObjects: mocks.listObjects }))
vi.mock('@/api/trips', () => ({
  createTrip: mocks.createTrip,
  listTripTypes: mocks.listTripTypes,
}))

const TOURISM = [
  { id: 19, code: 'trip_hiking', label: 'Пеший поход', icon: 'hike' },
  { id: 20, code: 'trip_alpinism', label: 'Альпинизм', icon: 'mountain' },
]

const VITYAZ = {
  id: '10',
  name: 'Витязь',
  type: 'скальник',
  url: null,
  parentId: '9',
  parentName: 'Олхинское плато',
}

/** Найти и выбрать цель через поиск. */
async function chooseGoal(wrapper: VueWrapper, name = 'Витязь') {
  await wrapper.find('[data-test="object-search"]').setValue(name)
  await vi.advanceTimersByTimeAsync(400)
  await wrapper.find('[data-test="object-option"]').trigger('click')
  await vi.advanceTimersByTimeAsync(0)
}

/** Отправить форму и дать промисам разрешиться. */
async function submit(wrapper: VueWrapper) {
  await wrapper.find('form').trigger('submit')
  await vi.advanceTimersByTimeAsync(0)
}

/** Тело последнего вызова createTrip. */
function lastPayload(): Record<string, unknown> {
  const calls = mocks.createTrip.mock.calls
  return calls[calls.length - 1]?.[0] as Record<string, unknown>
}

describe('CreateTrip', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.listObjects.mockReset()
    mocks.createTrip.mockReset()
    mocks.listTripTypes.mockReset()
    mocks.listObjects.mockResolvedValue([VITYAZ])
    mocks.listTripTypes.mockResolvedValue({ types: TOURISM, defaultTypeId: 19 })
    mocks.createTrip.mockResolvedValue({
      id: '1',
      announcement: 'Идём на майские',
      status: 'idea',
      visibility: 'public',
      isCommercial: false,
      isOfficial: false,
      goalObject: { id: '10', name: 'Витязь', type: 'скальник', url: null },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('без цели поход создать нельзя', async () => {
    const wrapper = mount(CreateTrip)

    expect(wrapper.find('[data-test="submit"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-test="hint"]').text()).toContain('Выберите цель')

    await submit(wrapper)
    expect(mocks.createTrip).not.toHaveBeenCalled()
  })

  it('порядок полей: флаги, готовность и видимость — до цели', async () => {
    const wrapper = mount(CreateTrip)

    // Заказчик просил поднять флаги наверх, а готовность с видимостью —
    // вперёд выбора цели. Проверяем именно порядок в разметке.
    const html = wrapper.html()
    const commercial = html.indexOf('data-test="commercial"')
    const sport = html.indexOf('data-test="official"')
    const status = html.indexOf('data-test="status"')
    const goal = html.indexOf('data-test="object-search"')

    expect(commercial).toBeGreaterThan(-1)
    expect(commercial).toBeLessThan(status)
    expect(sport).toBeLessThan(status)
    expect(status).toBeLessThan(goal)
  })

  it('у мечты даты вводятся месяцами, а не календарём', async () => {
    const wrapper = mount(CreateTrip)
    await chooseGoal(wrapper)

    expect(wrapper.find('[data-test="variant-row"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="starts-at"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="status-hint"]').text()).toContain('Мечта')
  })

  it('у решённого похода — начало и конец, вариантов нет', async () => {
    const wrapper = mount(CreateTrip)
    await chooseGoal(wrapper)

    await wrapper.find('[data-test="status"]').setValue('decided')

    expect(wrapper.find('[data-test="starts-at"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="ends-at"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="variant-row"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="status-hint"]').text()).toContain('Решено')
  })

  it('прокликанные месяцы уезжают отдельными вариантами вместе с годами', async () => {
    const wrapper = mount(CreateTrip)
    await chooseGoal(wrapper)

    // Берём ряд следующего года: он всегда из двенадцати месяцев,
    // а в текущем году месяцев осталось столько, сколько осталось.
    const nextYear = new Date().getFullYear() + 1

    await wrapper.find(`[data-test="month-${nextYear}-6"]`).trigger('click')
    await wrapper.find(`[data-test="month-${nextYear}-7"]`).trigger('click')
    await wrapper.find('[data-test="duration-days"]').setValue('5')
    await wrapper.find('[data-test="duration-delta"]').setValue('2')

    await submit(wrapper)

    expect(lastPayload().dateVariants).toEqual([
      { year: nextYear, month: 6, durationDays: 5, durationDelta: 2 },
      { year: nextYear, month: 7, durationDays: 5, durationDelta: 2 },
    ])
    expect(lastPayload().startsAt).toBeNull()
  })

  it('месяцы показаны двумя рядами с годами: остаток текущего и следующий', async () => {
    const wrapper = mount(CreateTrip)
    await chooseGoal(wrapper)

    const currentYear = new Date().getFullYear()
    const nextYear = currentYear + 1

    expect(wrapper.find(`[data-test="year-${currentYear}"]`).exists()).toBe(true)
    expect(wrapper.find(`[data-test="year-${nextYear}"]`).exists()).toBe(true)

    // В текущем году прошедшие месяцы не показываем: поход в марте, когда
    // на дворе октябрь, — это не прогноз, а ошибка.
    const passedMonth = new Date().getMonth()
    if (passedMonth >= 1) {
      expect(wrapper.find(`[data-test="month-${currentYear}-${passedMonth}"]`).exists()).toBe(false)
    }
    expect(wrapper.find(`[data-test="month-${nextYear}-1"]`).exists()).toBe(true)
  })

  it('режимы «примерный период» и «точное число» взаимоисключающие', async () => {
    const wrapper = mount(CreateTrip)
    await chooseGoal(wrapper)

    const nextYear = new Date().getFullYear() + 1
    await wrapper.find(`[data-test="month-${nextYear}-6"]`).trigger('click')
    await wrapper.find('[data-test="mode-exact"]').trigger('click')

    // Переключение режима чистит чужое: иначе в запрос уехало бы и число,
    // и месяцы — а это противоречие.
    expect(wrapper.find(`[data-test="month-${nextYear}-6"]`).exists()).toBe(false)

    await wrapper.find('[data-test="exact-day"]').setValue('12')
    await wrapper.find('[data-test="exact-month"]').setValue('8')
    await submit(wrapper)

    expect(lastPayload().dateVariants).toEqual([
      { year: null, month: 8, day: 12, durationDays: null, durationDelta: 0 },
    ])
  })

  it('запас без продолжительности не пропускается', async () => {
    const wrapper = mount(CreateTrip)
    await chooseGoal(wrapper)

    await wrapper.find('[data-test="duration-delta"]').setValue('2')

    expect(wrapper.find('[data-test="hint"]').text()).toContain('без продолжительности')
    expect(wrapper.find('[data-test="submit"]').attributes('disabled')).toBeDefined()
  })

  it('решённый поход без дат не отправляется', async () => {
    const wrapper = mount(CreateTrip)
    await chooseGoal(wrapper)
    await wrapper.find('[data-test="status"]').setValue('decided')

    expect(wrapper.find('[data-test="hint"]').text()).toContain('обе даты')

    await wrapper.find('[data-test="starts-at"]').setValue('2027-05-05T09:00')
    await wrapper.find('[data-test="ends-at"]').setValue('2027-05-09T18:00')
    await submit(wrapper)

    expect(lastPayload().startsAt).toBe(new Date('2027-05-05T09:00').toISOString())
    expect(lastPayload().dateVariants).toEqual([])
  })

  it('флаги «коммерческий» и «официальное мероприятие» уходят в тело', async () => {
    const wrapper = mount(CreateTrip)
    await chooseGoal(wrapper)

    await wrapper.find('[data-test="official"]').setValue(true)
    await wrapper.find('[data-test="commercial"]').setValue(true)
    await wrapper.find('[data-test="price"]').setValue('25000')
    await wrapper.find('[data-test="announcement"]').setValue('Идём на майские')
    await submit(wrapper)

    expect(lastPayload()).toMatchObject({
      goalObjectId: 10,
      announcement: 'Идём на майские',
      isCommercial: true,
      isOfficial: true,
      priceRub: 25000,
    })
  })

  it('коммерческий поход без цены не отправляется', async () => {
    const wrapper = mount(CreateTrip)
    await chooseGoal(wrapper)
    await wrapper.find('[data-test="commercial"]').setValue(true)

    expect(wrapper.find('[data-test="price"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="hint"]').text()).toContain('цену')
  })

  it('объект вставляется в маршрут ссылкой, а виден именем', async () => {
    const wrapper = mount(CreateTrip)
    await chooseGoal(wrapper)

    await wrapper.find('[data-test="md-object"]').trigger('click')
    await wrapper.find('[data-test="object-search"]').setValue('Витязь')
    await vi.advanceTimersByTimeAsync(400)
    await wrapper.find('[data-test="object-option"]').trigger('click')

    // На экране — имя: разметку в маршруте видеть не должны.
    const editor = wrapper.find('[data-test="md-editor"]')
    expect(editor.text()).toContain('Витязь')
    expect(editor.text()).not.toContain('[[object')

    // А на сервер уходит токен: из него бэкенд строит индекс объектов.
    await submit(wrapper)
    expect(lastPayload().routeText).toBe('[[object:10]]')
  })

  it('текст ошибки бэкенда показывается как есть', async () => {
    const wrapper = mount(CreateTrip)
    await chooseGoal(wrapper)

    mocks.createTrip.mockRejectedValue(
      new ApiError(400, 'В маршруте есть ссылки на несуществующие объекты', null),
    )
    await submit(wrapper)

    expect(wrapper.find('[data-test="error"]').text()).toContain('несуществующие объекты')
  })

  it('место сбора и «Будет гитара» уходят в тело запроса', async () => {
    const wrapper = mount(CreateTrip)
    await chooseGoal(wrapper)

    await wrapper.find('[data-test="meeting-place"]').setValue('Иркутск, автовокзал')
    await wrapper.find('[data-test="guitar"]').setValue(true)
    await submit(wrapper)

    expect(lastPayload()).toMatchObject({
      meetingPlace: 'Иркутск, автовокзал',
      hasGuitar: true,
    })
  })

  it('пустой сбор уезжает null-ом, а гитара по умолчанию «не будет»', async () => {
    const wrapper = mount(CreateTrip)
    await chooseGoal(wrapper)
    await submit(wrapper)

    expect(lastPayload()).toMatchObject({
      meetingPlace: null,
      hasGuitar: false,
    })
  })

  /**
   * Тип похода: у неофициального по умолчанию пеший (тип приходит
   * с бэкенда как `defaultTypeId`), у официального выбор обязателен.
   * Правило проверяется формой, а не только бэкендом: человек должен
   * узнать о нём до запроса.
   */
  it('неофициальному походу подставляется пеший тип', async () => {
    const wrapper = mount(CreateTrip)
    await chooseGoal(wrapper)

    expect(wrapper.find('[data-test="trip-type-19"]').attributes('aria-pressed')).toBe('true')

    await submit(wrapper)
    expect(lastPayload().activityTypeIds).toEqual([19])
  })

  it('выбранные типы уходят в тело, повторное нажатие снимает тип', async () => {
    const wrapper = mount(CreateTrip)
    await chooseGoal(wrapper)

    await wrapper.find('[data-test="trip-type-20"]').trigger('click')
    await wrapper.find('[data-test="trip-type-19"]').trigger('click')
    await submit(wrapper)

    expect(lastPayload().activityTypeIds).toEqual([20])
  })

  it('у официального похода без типа форма не отправляется', async () => {
    const wrapper = mount(CreateTrip)
    await chooseGoal(wrapper)

    await wrapper.find('[data-test="official"]').setValue(true)
    // Снимаем подставленный пеший: у официального похода тип выбирают.
    await wrapper.find('[data-test="trip-type-19"]').trigger('click')

    expect(wrapper.find('[data-test="hint"]').text()).toContain('тип')

    await submit(wrapper)
    expect(mocks.createTrip).not.toHaveBeenCalled()
  })

  it('после создания сразу открывается поход', async () => {
    // Роутер здесь настоящий, а не заглушка: проверяем именно переход.
    // Раньше после отправки показывалась карточка «Поход создан» с кнопкой
    // «Создать ещё», и заказчик справедливо назвал её лишней — создание
    // это начало работы с походом, а не отчёт.
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/trips/new', name: 'trips-create', component: CreateTrip },
        { path: '/trips/:id', name: 'trip', component: { template: '<div />' } },
      ],
    })
    await router.push('/trips/new')
    await router.isReady()

    const wrapper = mount(CreateTrip, { global: { plugins: [router] } })
    await chooseGoal(wrapper)
    await submit(wrapper)

    expect(mocks.createTrip).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.name).toBe('trip')
    expect(router.currentRoute.value.params.id).toBe('1')
  })

  it('без роутера (в тестах компонента) отправка не падает', async () => {
    const wrapper = mount(CreateTrip)
    await chooseGoal(wrapper)
    await submit(wrapper)

    expect(mocks.createTrip).toHaveBeenCalledTimes(1)
  })
})
