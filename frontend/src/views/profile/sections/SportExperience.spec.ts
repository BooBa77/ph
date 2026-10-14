import { createPinia, setActivePinia } from 'pinia'
import {
  enableAutoUnmount,
  flushPromises,
  mount,
  type VueWrapper,
} from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/errors'
import type { User } from '@/api/types'
import EditableField from '@/components/ui/EditableField.vue'
import { useAuthStore } from '@/stores/auth'
import SportExperience from '@/views/profile/sections/SportExperience.vue'

/**
 * Тесты вкладки «Спорт».
 *
 * Проверяем словари (что предлагается, в каком порядке и чего в них нет),
 * частичное сохранение (одно поле не затирает остальные) и инструкторские
 * галочки с ссылкой на лицензию.
 */
vi.mock('@/api/users', () => ({
  getMe: vi.fn(),
  updateMe: vi.fn(),
  uploadAvatar: vi.fn(),
  deleteAvatar: vi.fn(),
}))

import * as api from '@/api/users'

const mocked = vi.mocked(api)

/** Полный профиль: поля, которых нет в конкретном тесте, не мешают. */
function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u1',
    displayName: 'Тест',
    location: null,
    avatarUrl: null,
    isVegetarian: false,
    allergies: null,
    sportExperience: null,
    ...overrides,
  }
}

/** Опыт со всеми ключами: так его отдаёт бэкенд, когда строка есть. */
function fullExperience() {
  return {
    alpinism: {
      rank: 'КМС' as const,
      maxParticipation: '4Б' as const,
      maxLeadership: '2А' as const,
      rescueToken: true,
      instructorMethodist: '2 категория' as const,
      instructorGuide: '3 категория' as const,
      instructorGuideLicense:
        'https://knd.gov.ru/license?id=6683a3cad2b513840f64a890' as string | null,
      youthTourismOrganizer: true,
      youthTourismInstructor: false,
    },
    skyrunning: { rank: 'I' as const },
    sportTourism: {
      rank: 'МС' as const,
      maxCategories: {
        hiking: '3' as const,
        mountain: '2' as const,
        ski: null,
        water: '5' as const,
        caving: null,
        bicycle: null,
        horse: null,
        sailing: null,
        autoMoto: null,
      },
      disciplines: {
        nordicWalking: 'II разряд' as const,
        distanceHiking: null,
        distanceSki: null,
        distanceWater: null,
        distanceCaving: null,
      },
    },
  }
}

async function mountSection(user: User = makeUser()) {
  const auth = useAuthStore()
  auth.setUser(user)

  mocked.updateMe.mockResolvedValue(makeUser())

  const wrapper = mount(SportExperience)
  await flushPromises()
  return wrapper
}

/**
 * Список по подписи слева.
 *
 * Ищем через `<label for>` и `id`, а не через props компонента:
 * `SelectField` объявлен generic, и типы props при поиске по компонентам
 * не выводятся.
 *
 * `index` нужен потому, что подпись «Разряд или звание» есть и у альпинизма,
 * и у спортивного туризма — списки разные, подписи одинаковые.
 */
function selectByLabel(wrapper: VueWrapper, label: string, index = 0) {
  const matches = wrapper.findAll('select').filter((select) => {
    const id = select.attributes('id')
    const labelEl = wrapper
      .findAll('label')
      .find((item) => item.attributes('for') === id)
    return labelEl?.text() === label
  })

  const target = matches[index]
  if (!target) throw new Error(`Нет выпадающего списка «${label}» №${index + 1}`)
  return target
}

/** Подписи вариантов списка, включая пустой первый вариант. */
function optionsOf(wrapper: VueWrapper, label: string, index = 0): string[] {
  return selectByLabel(wrapper, label, index)
    .findAll('option')
    .map((option) => option.text())
}

/**
 * Галочка по её подписи.
 *
 * Галочек в разделе несколько (жетон и детско-юношеский туризм), и
 * порядок в разметке — не то, на что стоит опираться в тесте.
 */
function checkboxByText(wrapper: VueWrapper, text: string) {
  const label = wrapper
    .findAll('label')
    .find((item) => item.text().includes(text))

  if (!label) throw new Error(`Нет галочки «${text}»`)
  return label.find<HTMLInputElement>('input[type="checkbox"]')
}

/** Поле ввода по подписи слева. */
function editableFieldByLabel(wrapper: VueWrapper, label: string) {
  const field = wrapper
    .findAllComponents(EditableField)
    .find((item) => item.props('label') === label)

  if (!field) throw new Error(`Нет поля «${label}»`)
  return field
}

describe('SportExperience', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('показывает двадцать один список спортивного опыта', async () => {
    const wrapper = await mountSection()

    // Альпинизм: разряд, две категории, инструктор-методист,
    // инструктор-проводник — 5; скайраннинг — 1; спортивный туризм:
    // разряд, девять видов, пять дисциплин — 15.
    expect(wrapper.findAll('select')).toHaveLength(21)
  })

  it('показывает сохранённый спортивный опыт', async () => {
    const wrapper = await mountSection(
      makeUser({ sportExperience: fullExperience() }),
    )

    expect(selectByLabel(wrapper, 'Разряд или звание').element.value).toBe('КМС')
    expect(
      selectByLabel(wrapper, 'Наивысшая категория в качестве участника').element
        .value,
    ).toBe('4Б')
    expect(
      selectByLabel(wrapper, 'Инструктор-методист по альпинизму (ФАР)').element
        .value,
    ).toBe('2 категория')
    expect(
      selectByLabel(wrapper, 'Инструктор-проводник').element.value,
    ).toBe('3 категория')
    expect(selectByLabel(wrapper, 'Скайраннинг: разряд').element.value).toBe('I')
    expect(selectByLabel(wrapper, 'Водный').element.value).toBe('5')
    expect(selectByLabel(wrapper, 'Северная ходьба').element.value).toBe(
      'II разряд',
    )
  })

  it('сохраняет только выбранное поле, не трогая остальной опыт', async () => {
    const wrapper = await mountSection()

    await selectByLabel(
      wrapper,
      'Наивысшая категория в качестве руководителя',
    ).setValue('1Б')
    await flushPromises()

    expect(mocked.updateMe).toHaveBeenCalledWith({
      sportExperience: { alpinism: { maxLeadership: '1Б' } },
    })
  })

  it('сохраняет категорию по виду туризма в своём ключе', async () => {
    const wrapper = await mountSection()

    await selectByLabel(wrapper, 'Велосипедный').setValue('4')
    await flushPromises()

    expect(mocked.updateMe).toHaveBeenCalledWith({
      sportExperience: { sportTourism: { maxCategories: { bicycle: '4' } } },
    })
  })

  it('сохраняет норматив дисциплины в своём ключе', async () => {
    const wrapper = await mountSection()

    await selectByLabel(wrapper, 'Дистанция водная').setValue('юношеский')
    await flushPromises()

    expect(mocked.updateMe).toHaveBeenCalledWith({
      sportExperience: {
        sportTourism: { disciplines: { distanceWater: 'юношеский' } },
      },
    })
  })

  it('пустой вариант списка отправляет null, а не пустую строку', async () => {
    const wrapper = await mountSection(
      makeUser({ sportExperience: fullExperience() }),
    )

    await selectByLabel(wrapper, 'Разряд или звание').setValue('')
    await flushPromises()

    expect(mocked.updateMe).toHaveBeenCalledWith({
      sportExperience: { alpinism: { rank: null } },
    })
  })

  it('идёт от «Значка» к МСМК, а не наоборот', async () => {
    const wrapper = await mountSection()

    // Нулевой вариант — пустой («— нет —»), дальше разряды по возрастанию:
    // свой разряд ищут снизу вверх, а не через весь список чужих.
    const ranks = optionsOf(wrapper, 'Разряд или звание', 0)
    expect(ranks[1]).toBe('Значок')
    expect(ranks[ranks.length - 1]).toBe('МСМК')

    const tourism = optionsOf(wrapper, 'Разряд или звание', 1)
    expect(tourism[1]).toBe('Значок')
    expect(tourism[tourism.length - 1]).toBe('МС')
  })

  it('не предлагает «Значок» в скайраннинге', async () => {
    const wrapper = await mountSection()

    // За дистанцию знак не дают: у скайраннинга свой список.
    expect(optionsOf(wrapper, 'Скайраннинг: разряд')).not.toContain('Значок')
  })

  it('разворачивает категории и нормативы по возрастанию', async () => {
    const wrapper = await mountSection()

    // Категории маршрутов: 1Б → 6Б.
    const mountain = optionsOf(
      wrapper,
      'Наивысшая категория в качестве участника',
    )
    expect(mountain[1]).toBe('1Б')
    expect(mountain[mountain.length - 1]).toBe('6Б')

    // Категории походов: 1 → 6.
    const tourism = optionsOf(wrapper, 'Пешеходный')
    expect(tourism[1]).toBe('1')
    expect(tourism[tourism.length - 1]).toBe('6')

    // Нормативы в дисциплинах: юношеский → I разряд.
    const norms = optionsOf(wrapper, 'Северная ходьба')
    expect(norms[1]).toBe('юношеский')
    expect(norms[norms.length - 1]).toBe('I разряд')
  })

  it('не дублирует пустую строку вариантами «отсутствует» и «нет данных»', async () => {
    const wrapper = await mountSection()

    expect(optionsOf(wrapper, 'Разряд или звание', 0)).not.toContain(
      'отсутствует',
    )
    expect(optionsOf(wrapper, 'Пешеходный')).not.toContain('нет данных')
    expect(optionsOf(wrapper, 'Северная ходьба')).not.toContain('не выполнялся')
  })

  it('жетон «Спасение в горах» по умолчанию снят', async () => {
    const wrapper = await mountSection()

    expect(
      checkboxByText(wrapper, 'Жетон «Спасение в горах»').element.checked,
    ).toBe(false)
  })

  it('подписывает галочку жетона, не дублируя текст слева', async () => {
    const wrapper = await mountSection()

    expect(wrapper.text()).toContain('Жетон «Спасение в горах»')
    expect(wrapper.text()).not.toContain('Участвовал в спасательных работах')
  })

  it('показывает установленный жетон', async () => {
    const wrapper = await mountSection(
      makeUser({ sportExperience: fullExperience() }),
    )

    expect(
      checkboxByText(wrapper, 'Жетон «Спасение в горах»').element.checked,
    ).toBe(true)
  })

  it('сохраняет жетон отдельным полем', async () => {
    const wrapper = await mountSection()

    await checkboxByText(wrapper, 'Жетон «Спасение в горах»').setValue(true)
    await flushPromises()

    expect(mocked.updateMe).toHaveBeenCalledWith({
      sportExperience: { alpinism: { rescueToken: true } },
    })
  })

  it('сохраняет инструктора-методиста', async () => {
    const wrapper = await mountSection()

    await selectByLabel(wrapper, 'Инструктор-методист по альпинизму (ФАР)').setValue(
      'ИНП',
    )
    await flushPromises()

    expect(mocked.updateMe).toHaveBeenCalledWith({
      sportExperience: { alpinism: { instructorMethodist: 'ИНП' } },
    })
  })

  it('сохраняет инструктора-проводника', async () => {
    const wrapper = await mountSection()

    await selectByLabel(wrapper, 'Инструктор-проводник').setValue(
      'Международного класса',
    )
    await flushPromises()

    expect(mocked.updateMe).toHaveBeenCalledWith({
      sportExperience: { alpinism: { instructorGuide: 'Международного класса' } },
    })
  })

  it('показывает ссылку на лицензию только при выбранной категории', async () => {
    const without = await mountSection()
    expect(
      without
        .findAllComponents(EditableField)
        .some((item) => item.props('label') === 'Лицензия госаттестации'),
    ).toBe(false)

    const withGuide = await mountSection(
      makeUser({ sportExperience: fullExperience() }),
    )
    expect(
      editableFieldByLabel(withGuide, 'Лицензия госаттестации').props('modelValue'),
    ).toBe('https://knd.gov.ru/license?id=6683a3cad2b513840f64a890')
  })

  it('сохраняет ссылку на лицензию', async () => {
    const wrapper = await mountSection(
      makeUser({ sportExperience: fullExperience() }),
    )
    const field = editableFieldByLabel(wrapper, 'Лицензия госаттестации')

    await field.get('button').trigger('click')
    await field
      .get('input')
      .setValue('https://knd.gov.ru/license?id=abc&registryType=ATT')
    await field.get('input').trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(mocked.updateMe).toHaveBeenCalledWith({
      sportExperience: {
        alpinism: {
          instructorGuideLicense:
            'https://knd.gov.ru/license?id=abc&registryType=ATT',
        },
      },
    })
  })

  it('сохраняет галочки детско-юношеского туризма', async () => {
    const wrapper = await mountSection()

    await checkboxByText(wrapper, 'Организатор детско-юношеского туризма').setValue(
      true,
    )
    await flushPromises()

    expect(mocked.updateMe).toHaveBeenCalledWith({
      sportExperience: { alpinism: { youthTourismOrganizer: true } },
    })

    await checkboxByText(wrapper, 'Инструктор детско-юношеского туризма').setValue(
      true,
    )
    await flushPromises()

    expect(mocked.updateMe).toHaveBeenCalledWith({
      sportExperience: { alpinism: { youthTourismInstructor: true } },
    })
  })

  it('показывает сообщение бэкенда, если сохранить не удалось', async () => {
    const wrapper = await mountSection()
    mocked.updateMe.mockRejectedValue(
      new ApiError(400, 'Ссылка на лицензию должна начинаться с http://'),
    )

    await checkboxByText(wrapper, 'Жетон «Спасение в горах»').setValue(true)
    await flushPromises()

    expect(wrapper.text()).toContain('Ссылка на лицензию должна начинаться')
  })
})
