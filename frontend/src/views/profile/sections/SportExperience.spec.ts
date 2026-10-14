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
import { useAuthStore } from '@/stores/auth'
import SportExperience from '@/views/profile/sections/SportExperience.vue'

/**
 * Тесты вкладки «Спорт».
 *
 * Раздел переехал из «Профиля» отдельной страницей, тесты переехали
 * вместе с ним: проверяем словари (что предлагается и чего в них нет),
 * частичное сохранение (одно поле не затирает остальные) и жетон
 * «Спасение в горах».
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

describe('SportExperience', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('показывает девятнадцать списков спортивного опыта', async () => {
    const wrapper = await mountSection()

    // 3 альпинизм + 1 скайраннинг + 1 разряд по туризму
    // + 9 видов туризма + 5 дисциплин группы «дистанция».
    expect(wrapper.findAll('select')).toHaveLength(19)
  })

  it('показывает сохранённый спортивный опыт в списках', async () => {
    const wrapper = await mountSection(
      makeUser({ sportExperience: fullExperience() }),
    )

    expect(selectByLabel(wrapper, 'Разряд или звание').element.value).toBe('КМС')
    expect(
      selectByLabel(wrapper, 'Наивысшая категория в качестве участника').element
        .value,
    ).toBe('4Б')
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
    ).setValue('5А')
    await flushPromises()

    expect(mocked.updateMe).toHaveBeenCalledWith({
      sportExperience: { alpinism: { maxLeadership: '5А' } },
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

  it('ставит «Значок» первым в альпинизме и спортивном туризме', async () => {
    const wrapper = await mountSection()

    // Нулевой вариант в каждом списке — пустой («— нет —»),
    // «Значок» идёт сразу за ним.
    expect(optionsOf(wrapper, 'Разряд или звание', 0)[1]).toBe('Значок')
    expect(optionsOf(wrapper, 'Разряд или звание', 1)[1]).toBe('Значок')
  })

  it('не предлагает «Значок» в скайраннинге', async () => {
    const wrapper = await mountSection()

    // За дистанцию знак не дают: у скайраннинга свой список.
    expect(optionsOf(wrapper, 'Скайраннинг: разряд')).not.toContain('Значок')
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
      wrapper.get<HTMLInputElement>('input[type="checkbox"]').element.checked,
    ).toBe(false)
  })

  it('показывает установленный жетон', async () => {
    const wrapper = await mountSection(
      makeUser({ sportExperience: fullExperience() }),
    )

    expect(
      wrapper.get<HTMLInputElement>('input[type="checkbox"]').element.checked,
    ).toBe(true)
  })

  it('сохраняет жетон отдельным полем', async () => {
    const wrapper = await mountSection()

    await wrapper.get('input[type="checkbox"]').setValue(true)
    await flushPromises()

    expect(mocked.updateMe).toHaveBeenCalledWith({
      sportExperience: { alpinism: { rescueToken: true } },
    })
  })

  it('показывает сообщение бэкенда, если сохранить не удалось', async () => {
    const wrapper = await mountSection()
    mocked.updateMe.mockRejectedValue(
      new ApiError(400, 'rank must be one of the following values'),
    )

    await wrapper.get('input[type="checkbox"]').setValue(true)
    await flushPromises()

    expect(wrapper.text()).toContain('rank must be one of the following values')
  })
})
