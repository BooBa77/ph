import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CalendarDay, YearState } from '@/api/calendar'
import { capitalize, fromIsoDate, toIsoDate } from '@/utils/calendar'
import UserCalendar from '@/views/profile/sections/UserCalendar.vue'

/**
 * Тесты страницы «Календарь».
 *
 * Страница берёт дни из стора, поэтому API подменён: сетка собирается по
 * тому же правилу 5/2, что и на бэкенде, — так проверяются цвета, хвосты
 * и модалки, а сетевые запросы остаются за кадром.
 *
 * Дата зафиксирована: иначе тест выглядел бы зелёным только в октябре
 * 2026 года. Из таймеров подменяем только Date — иначе `flushPromises`
 * не дождётся микрозадач.
 */
vi.mock('@/api/calendar', () => ({
  fetchYearState: vi.fn(),
  fetchDays: vi.fn(),
  createYear: vi.fn(),
  patchDay: vi.fn(),
  updateDays: vi.fn(),
  fetchActivityDictionary: vi.fn(),
  addActivity: vi.fn(),
  removeActivity: vi.fn(),
  saveNotes: vi.fn(),
  createActivityRequest: vi.fn(),
}))

import * as api from '@/api/calendar'

const mocked = vi.mocked(api)

const WEEKDAY = new Intl.DateTimeFormat('ru-RU', { weekday: 'long' })

/** Дни диапазона по правилу 5/2 — как их заполнил бы бэкенд. */
function daysInRange(from: string, to: string): CalendarDay[] {
  const result: CalendarDay[] = []

  for (
    const cursor = fromIsoDate(from);
    toIsoDate(cursor) <= to;
    cursor.setDate(cursor.getDate() + 1)
  ) {
    const weekend = cursor.getDay() === 0 || cursor.getDay() === 6
    result.push({
      date: toIsoDate(cursor),
      dayType: weekend ? 'weekend' : 'workday',
      label: capitalize(WEEKDAY.format(cursor)),
    })
  }

  return result
}

function yearState(year: number, overrides: Partial<YearState> = {}): YearState {
  return {
    year,
    filled: true,
    mode: 'cycle',
    filledDays: 365,
    stateAvailable: true,
    educationAvailable: true,
    ...overrides,
  }
}

describe('UserCalendar', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    // 7 октября 2026, полдень: месяц, в котором 1-е — четверг, а сетка
    // получается на пять недель с хвостами сентября и ноября.
    vi.setSystemTime(new Date(2026, 9, 7, 12, 0, 0))

    mocked.fetchDays.mockImplementation(async (from, to) => ({
      days: daysInRange(from, to),
      activities: {},
    }))
    mocked.fetchYearState.mockImplementation(async (year) => yearState(year))
    mocked.fetchActivityDictionary.mockResolvedValue({
      groups: [],
      favorites: [],
      requests: [],
      isAdmin: false,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /** Смонтировать страницу и дождаться загрузки года и сетки. */
  async function mountPage() {
    const wrapper = mount(UserCalendar)
    await flushPromises()
    return wrapper
  }

  /** Все клетки дней. */
  function dayCells(wrapper: VueWrapper) {
    return wrapper.findAll('button.aspect-square')
  }

  function cell(wrapper: VueWrapper, number: string) {
    // Сравнение точное: у «3» в сетке есть сосед «30» (хвост сентября),
    // и поиск по началу строки возвращал бы не ту клетку.
    const found = dayCells(wrapper).find((item) => item.text() === number)
    if (!found) throw new Error(`В сетке нет клетки с числом ${number}`)
    return found
  }

  function hasButton(wrapper: VueWrapper, text: string) {
    return wrapper.findAll('button').some((item) => item.text() === text)
  }

  function button(wrapper: VueWrapper, text: string) {
    const found = wrapper.findAll('button').find((item) => item.text() === text)
    if (!found) throw new Error(`Нет кнопки «${text}»`)
    return found
  }

  function nav(wrapper: VueWrapper, label: string) {
    return wrapper.get(`[aria-label="${label}"]`)
  }

  it('подписывает месяц и сегодняшнюю дату', async () => {
    const wrapper = await mountPage()

    expect(wrapper.get('h3').text()).toBe('Октябрь 2026')
    expect(wrapper.text()).toContain('Сегодня — 7 октября 2026')
  })

  it('колонки идут с понедельника', async () => {
    const wrapper = await mountPage()

    expect(wrapper.findAll('div.text-center').map((item) => item.text())).toEqual([
      'Пн',
      'Вт',
      'Ср',
      'Чт',
      'Пт',
      'Сб',
      'Вс',
    ])
  })

  it('показывает 35 клеток: пять недель по семь дней', async () => {
    const wrapper = await mountPage()

    expect(dayCells(wrapper)).toHaveLength(35)
  })

  it('просит у бэкенда сетку вместе с хвостами соседних месяцев', async () => {
    await mountPage()

    expect(mocked.fetchDays).toHaveBeenCalledWith('2026-09-28', '2026-11-01')
  })

  it('рассказывает, что впереди, вместо легенды о цветах', async () => {
    const wrapper = await mountPage()

    // 7 октября 2026 — среда, ближайший выходной — суббота 10-го.
    expect(wrapper.text()).toContain('Сегодня — 7 октября 2026.')
    expect(wrapper.text()).toContain('В субботу, 10 октября, выходной')
    // Легенды про цвета больше нет: смысл цветов объяснять не нужно.
    expect(wrapper.text()).not.toContain('Красным отмечены выходные')
  })

  it('называет праздник, если он впереди', async () => {
    mocked.fetchDays.mockImplementation(async (from, to) => ({
      days: daysInRange(from, to).map((item) =>
        item.date === '2026-10-08'
          ? { ...item, dayType: 'weekend' as const, label: 'День народного единства' }
          : item,
      ),
      activities: {},
    }))

    const wrapper = await mountPage()

    expect(wrapper.text()).toContain(
      'Завтра День народного единства — выходной, ты уже всё спланировал?',
    )
  })

  it('красит выходные красным, рабочие — серым', async () => {
    const wrapper = await mountPage()

    // 3-е и 4-е — суббота и воскресенье, 10-е — суббота, 5-е — понедельник.
    for (const number of ['3', '4', '10', '31']) {
      expect(cell(wrapper, number).classes()).toContain('text-calendar-weekend')
    }
    for (const number of ['5', '9']) {
      const classes = cell(wrapper, number).classes()
      expect(classes).toContain('text-calendar-workday')
      expect(classes).not.toContain('text-calendar-weekend')
    }
  })

  it('берёт для дней цвета календаря, а не сезонные', async () => {
    const wrapper = await mountPage()

    for (const number of ['5', '3']) {
      expect(cell(wrapper, number).classes()).not.toContain('text-muted')
    }
  })

  it('сегодняшний день перекрывает цвет дня', async () => {
    const wrapper = await mountPage()
    const today = cell(wrapper, '7')

    expect(today.classes()).toContain('ring-2')
    expect(today.classes()).toContain('text-primary')
  })

  it('хвосты соседних месяцев приглушены, но нажимаются', async () => {
    const wrapper = await mountPage()
    const tails = dayCells(wrapper).filter((item) => item.classes().includes('opacity-40'))

    // Три дня сентября сверху и 1 ноября снизу.
    expect(tails.map((item) => item.text())).toEqual(['28', '29', '30', '1'])
    expect(tails.every((item) => item.attributes('disabled') === undefined)).toBe(true)
    // 1 ноября — воскресенье, 28 сентября — понедельник.
    expect(tails[3]?.classes()).toContain('text-calendar-weekend')
    expect(tails[0]?.classes()).toContain('text-calendar-workday')
  })

  it('подпись клетки для скринридера — дата, статус и метка дня', async () => {
    const wrapper = await mountPage()

    expect(cell(wrapper, '7').attributes('aria-label')).toBe(
      '7 октября 2026, сегодня, Среда',
    )
    expect(cell(wrapper, '3').attributes('aria-label')).toBe(
      '3 октября 2026, выходной, Суббота',
    )
  })

  describe('модалка дня', () => {
    it('открывается по клику и показывает день, статус и метку', async () => {
      const wrapper = await mountPage()
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false)

      await cell(wrapper, '15').trigger('click')

      const dialog = wrapper.get('[role="dialog"]')
      expect(dialog.text()).toContain('Четверг, 15 октября 2026')
      // Переключатель статуса, а не слово «Рабочий»: РАБ/ВЫХ.
      expect(dialog.text()).toContain('РАБ')
      expect(dialog.text()).not.toContain('Это сегодня')
    })

    it('помечает сегодняшний день', async () => {
      const wrapper = await mountPage()
      await cell(wrapper, '7').trigger('click')

      expect(wrapper.get('[role="dialog"]').text()).toContain('Это сегодня')
    })

    it('закрывается по Escape и открывается снова на другом дне', async () => {
      const wrapper = await mountPage()
      await cell(wrapper, '15').trigger('click')

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await wrapper.vm.$nextTick()
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false)

      await cell(wrapper, '20').trigger('click')
      expect(wrapper.get('[role="dialog"]').text()).toContain('Вторник, 20 октября 2026')
    })

    it('меняет статус дня одним кликом', async () => {
      mocked.patchDay.mockResolvedValue({
        date: '2026-10-15',
        dayType: 'weekend',
        label: 'Четверг',
      })

      const wrapper = await mountPage()
      await cell(wrapper, '15').trigger('click')
      // Переключатель РАБ/ВЫХ виден сразу: никаких промежуточных шагов.
      await button(wrapper, 'ВЫХ').trigger('click')
      await flushPromises()

      expect(mocked.patchDay).toHaveBeenCalledWith({
        date: '2026-10-15',
        dayType: 'weekend',
      })
    })

    it('правит метку дня кликом по заголовку', async () => {
      mocked.patchDay.mockResolvedValue({
        date: '2026-10-15',
        dayType: 'workday',
        label: 'ДР Любы',
      })

      const wrapper = await mountPage()
      await cell(wrapper, '15').trigger('click')

      await wrapper.get('#day-modal-title').trigger('click')
      await wrapper.get('[aria-label="Метка дня"]').setValue('ДР Любы')
      await button(wrapper, 'Сохранить').trigger('click')
      await flushPromises()

      expect(mocked.patchDay).toHaveBeenCalledWith({
        date: '2026-10-15',
        label: 'ДР Любы',
      })
    })
  })

  describe('навигация', () => {
    it('листает месяцы и годы, спрашивая состояние года', async () => {
      const wrapper = await mountPage()

      await nav(wrapper, 'Следующий месяц').trigger('click')
      await flushPromises()
      // В ноябре 2026 шесть недель: 30-е — понедельник.
      expect(wrapper.get('h3').text()).toBe('Ноябрь 2026')
      expect(dayCells(wrapper)).toHaveLength(42)

      await nav(wrapper, 'Предыдущий год').trigger('click')
      await flushPromises()
      // Год листается, месяц сохраняется: ноябрь 2026 → ноябрь 2025.
      expect(wrapper.get('h3').text()).toBe('Ноябрь 2025')
      expect(mocked.fetchYearState).toHaveBeenCalledWith(2025)
    })

    it('кнопка «Сегодня» возвращает в текущий месяц', async () => {
      const wrapper = await mountPage()

      await nav(wrapper, 'Следующий месяц').trigger('click')
      await flushPromises()
      await button(wrapper, 'Сегодня').trigger('click')
      await flushPromises()

      expect(wrapper.get('h3').text()).toBe('Октябрь 2026')
      expect(hasButton(wrapper, 'Сегодня')).toBe(false)
    })
  })

  describe('производственный календарь', () => {
    it('спрашивает про незаполненный год и создаёт его', async () => {
      mocked.fetchYearState.mockImplementation(async (year) =>
        yearState(year, { filled: year !== 2027, mode: year !== 2027 ? 'cycle' : null }),
      )
      mocked.createYear.mockResolvedValue(yearState(2027, { mode: 'cycle' }))

      const wrapper = await mountPage()
      await nav(wrapper, 'Следующий год').trigger('click')
      await flushPromises()

      const dialog = wrapper.get('[role="dialog"]')
      expect(dialog.text()).toContain('Производственный календарь на 2027 год не заполнен')
      // Режим 2026 года уже известен, поэтому вопрос не «планируешь ли
      // работать», а по делу — про тот же график.
      expect(dialog.text()).toContain('Работать в 2027 планируешь так же — 5/2?')

      await button(wrapper, 'Да').trigger('click')
      await flushPromises()

      expect(mocked.createYear).toHaveBeenCalledWith(2027, 'cycle')
      expect(wrapper.get('[role="dialog"]').text()).toContain('Календарь заполнен')
    })

    it('закрытый диалог не всплывает второй раз в этой же сессии', async () => {
      mocked.fetchYearState.mockImplementation(async (year) =>
        yearState(year, { filled: year !== 2027 }),
      )
      mocked.createYear.mockResolvedValue(yearState(2027, { mode: 'free' }))

      const wrapper = await mountPage()
      await nav(wrapper, 'Следующий год').trigger('click')
      await flushPromises()

      await button(wrapper, 'Нет').trigger('click')
      await button(wrapper, 'Свободный график').trigger('click')
      await flushPromises()
      await button(wrapper, 'Понятно').trigger('click')
      await wrapper.vm.$nextTick()
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false)

      // Уходим и возвращаемся: про тот же год больше не спрашиваем.
      await nav(wrapper, 'Предыдущий год').trigger('click')
      await flushPromises()
      await nav(wrapper, 'Следующий год').trigger('click')
      await flushPromises()

      expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    })

    it('сохраняет накопленные диапазоны разом', async () => {
      mocked.updateDays.mockResolvedValue({ updated: 3 })

      const wrapper = await mountPage()
      await button(wrapper, 'Производственный календарь').trigger('click')

      const dates = wrapper.findAll('input[type="date"]')
      await dates[0]?.setValue('2026-06-01')
      await dates[1]?.setValue('2026-06-03')
      await wrapper.get('input[placeholder="отпуск, каникулы, межвахта"]').setValue('отпуск')
      await button(wrapper, 'Добавить').trigger('click')

      expect(wrapper.text()).toContain('01.06 — 03.06')

      await button(wrapper, 'Сохранить').trigger('click')
      await flushPromises()

      expect(mocked.updateDays).toHaveBeenCalledWith([
        { date: '2026-06-01', dayType: 'weekend', label: 'отпуск' },
        { date: '2026-06-02', dayType: 'weekend', label: 'отпуск' },
        { date: '2026-06-03', dayType: 'weekend', label: 'отпуск' },
      ])
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    })

    it('для диапазона рабочих дней причину не спрашивает', async () => {
      mocked.updateDays.mockResolvedValue({ updated: 2 })

      const wrapper = await mountPage()
      await button(wrapper, 'Производственный календарь').trigger('click')

      await button(wrapper, 'Рабочие дни').trigger('click')
      const dates = wrapper.findAll('input[type="date"]')
      await dates[0]?.setValue('2026-06-06')
      await dates[1]?.setValue('2026-06-07')
      // Поле причины для рабочих дней не нужно — и его нет.
      expect(wrapper.find('input[placeholder="отпуск, каникулы, межвахта"]').exists()).toBe(
        false,
      )

      await button(wrapper, 'Добавить').trigger('click')
      await button(wrapper, 'Сохранить').trigger('click')
      await flushPromises()

      expect(mocked.updateDays).toHaveBeenCalledWith([
        { date: '2026-06-06', dayType: 'workday', label: 'работа' },
        { date: '2026-06-07', dayType: 'workday', label: 'работа' },
      ])
    })

    it('держит «Добавить» сразу за датами, а причину — после кнопки', async () => {
      const wrapper = await mountPage()
      await button(wrapper, 'Производственный календарь').trigger('click')

      const reasonInput = wrapper.get('input[placeholder="отпуск, каникулы, межвахта"]')
      const addButton = button(wrapper, 'Добавить')

      // Причина идёт ПОСЛЕ кнопки: иначе она уезжает вправо при
      // переключении инструмента, и «Добавить» прыгает по строке.
      const position = addButton.element.compareDocumentPosition(reasonInput.element)

      expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('бракует диапазон вне показанного года', async () => {
      const wrapper = await mountPage()
      await button(wrapper, 'Производственный календарь').trigger('click')

      const dates = wrapper.findAll('input[type="date"]')
      await dates[0]?.setValue('2027-01-01')
      await dates[1]?.setValue('2027-01-05')
      await button(wrapper, 'Добавить').trigger('click')

      expect(wrapper.text()).toContain('Диапазон должен быть внутри 2026 года')
      expect(mocked.updateDays).not.toHaveBeenCalled()
    })
  })
})
