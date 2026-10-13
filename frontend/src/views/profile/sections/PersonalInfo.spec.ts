import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/errors'
import type { User } from '@/api/types'
import EditableField from '@/components/ui/EditableField.vue'
import { useAuthStore } from '@/stores/auth'
import PersonalInfo from '@/views/profile/sections/PersonalInfo.vue'

/**
 * Тесты раздела «Профиль».
 *
 * Проверяем то, что легко сломать незаметно: подпись поля имени, подсказки
 * городов (теперь они прячутся, как только город заполнен), галочку
 * вегетарианства и списки спортивного опыта.
 *
 * API подменён: раздел общается с бэком одним PATCH, и проверять надо
 * не сеть, а тело запроса — что именно уходит и что остаётся нетронутым.
 */
vi.mock('@/api/users', () => ({
  getMe: vi.fn(),
  updateMe: vi.fn(),
  uploadAvatar: vi.fn(),
  deleteAvatar: vi.fn(),
}))

import * as api from '@/api/users'

const mocked = vi.mocked(api)

/** Полный профиль: поля, которых нет в конкретном тесте, не должны влиять. */
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

/** Смонтировать раздел с заданным пользователем в сторе. */
async function mountSection(user: User = makeUser()) {
  const auth = useAuthStore()
  auth.setUser(user)

  mocked.updateMe.mockResolvedValue(makeUser())

  const wrapper = mount(PersonalInfo)
  await flushPromises()
  return wrapper
}

/**
 * Список по подписи слева.
 *
 * Ищем через `<label for>` и `id`, а не через props компонента:
 * `SelectField` объявлен generic (варианты типизированы), и типы props
 * у него при поиске по компонентам не выводятся.
 */
function selectByLabel(wrapper: VueWrapper, label: string) {
  const target = wrapper.findAll('select').find((select) => {
    const id = select.attributes('id')
    const labelEl = wrapper
      .findAll('label')
      .find((item) => item.attributes('for') === id)
    return labelEl?.text() === label
  })

  if (!target) throw new Error(`Нет выпадающего списка «${label}»`)
  return target
}

/** Поле ввода по подписи, как его видит пользователь. */
function editableFieldByLabel(wrapper: VueWrapper, label: string) {
  const field = wrapper
    .findAllComponents(EditableField)
    .find((item) => item.props('label') === label)

  if (!field) throw new Error(`Нет поля «${label}»`)
  return field
}

describe('PersonalInfo', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('называет поле «Отображаемое имя», а не «Имя пользователя»', async () => {
    const wrapper = await mountSection()

    expect(wrapper.text()).toContain('Отображаемое имя')
    expect(wrapper.text()).not.toContain('Имя пользователя')
  })

  it('сохраняет отображаемое имя через PATCH', async () => {
    const wrapper = await mountSection()
    const field = editableFieldByLabel(wrapper, 'Отображаемое имя')

    await field.get('button').trigger('click')
    await field.get('input').setValue('Байкальский волк')
    await field.get('input').trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(mocked.updateMe).toHaveBeenCalledWith({
      displayName: 'Байкальский волк',
    })
  })

  it('подсказывает города, пока город не заполнен', async () => {
    const wrapper = await mountSection()

    const texts = wrapper.findAll('button').map((item) => item.text())
    expect(texts).toContain('Иркутск')
    expect(texts).toContain('Ангарск')
    expect(texts).toContain('Усолье-Сибирское')
  })

  it('убирает подсказки городов у заполненного города', async () => {
    const wrapper = await mountSection(makeUser({ location: 'Иркутск' }))

    const texts = wrapper.findAll('button').map((item) => item.text())
    expect(texts).not.toContain('Ангарск')
    expect(texts).not.toContain('Усолье-Сибирское')
  })

  it('оставляет возможность поменять город вручную', async () => {
    const wrapper = await mountSection(makeUser({ location: 'Иркутск' }))
    const field = editableFieldByLabel(wrapper, 'Город')

    await field.get('button').trigger('click')
    await field.get('input').setValue('Ангарск')
    await field.get('input').trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(mocked.updateMe).toHaveBeenCalledWith({ location: 'Ангарск' })
  })

  it('показывает галочку вегетарианства снятой, если её не ставили', async () => {
    const wrapper = await mountSection()

    expect(
      wrapper.get<HTMLInputElement>('input[type="checkbox"]').element.checked,
    ).toBe(false)
  })

  it('ставит галочку вегетарианства и сохраняет её', async () => {
    const wrapper = await mountSection()

    await wrapper.get('input[type="checkbox"]').setValue(true)
    await flushPromises()

    expect(mocked.updateMe).toHaveBeenCalledWith({ isVegetarian: true })
  })

  it('сохраняет аллергии свободным текстом', async () => {
    const wrapper = await mountSection(makeUser({ allergies: 'Орехи' }))
    const field = editableFieldByLabel(wrapper, 'Мои аллергии')

    await field.get('button').trigger('click')
    await field.get('input').setValue('Орехи, мёд')
    await field.get('input').trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(mocked.updateMe).toHaveBeenCalledWith({ allergies: 'Орехи, мёд' })
  })

  it('убирает аллергии — на бэк уходит null', async () => {
    const wrapper = await mountSection(makeUser({ allergies: 'Орехи' }))

    const removeButton = wrapper
      .findAll('button')
      .find((item) => item.text() === 'Убрать')
    if (!removeButton) throw new Error('Нет кнопки «Убрать» у аллергий')

    await removeButton.trigger('click')
    await flushPromises()

    expect(mocked.updateMe).toHaveBeenCalledWith({ allergies: null })
  })

  it('показывает девятнадцать списков спортивного опыта', async () => {
    const wrapper = await mountSection()

    // 3 альпинизм + 1 скайраннинг + 1 разряд по туризму
    // + 9 видов туризма + 5 дисциплин группы «дистанция».
    expect(wrapper.findAll('select')).toHaveLength(19)
  })

  it('показывает сохранённый спортивный опыт в списках', async () => {
    const wrapper = await mountSection(
      makeUser({
        sportExperience: {
          alpinism: { rank: 'КМС', maxParticipation: '4Б', maxLeadership: '2А' },
          skyrunning: { rank: 'I' },
          sportTourism: {
            rank: 'МС',
            maxCategories: {
              hiking: '3',
              mountain: '2',
              ski: null,
              water: '5',
              caving: null,
              bicycle: null,
              horse: null,
              sailing: null,
              autoMoto: null,
            },
            disciplines: {
              nordicWalking: 'II разряд',
              distanceHiking: null,
              distanceSki: null,
              distanceWater: null,
              distanceCaving: null,
            },
          },
        },
      }),
    )

    expect(selectByLabel(wrapper, 'Разряд или звание').element.value).toBe('КМС')
    expect(selectByLabel(wrapper, 'Категория: участник').element.value).toBe('4Б')
    expect(selectByLabel(wrapper, 'Скайраннинг: норматив').element.value).toBe('I')
    expect(selectByLabel(wrapper, 'Водный').element.value).toBe('5')
    expect(selectByLabel(wrapper, 'Северная ходьба').element.value).toBe('II разряд')
  })

  it('сохраняет только выбранное поле, не трогая остальной опыт', async () => {
    const wrapper = await mountSection()

    await selectByLabel(wrapper, 'Категория: руководитель').setValue('5А')
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
      makeUser({
        sportExperience: {
          alpinism: { rank: 'КМС', maxParticipation: null, maxLeadership: null },
          skyrunning: { rank: null },
          sportTourism: {
            rank: null,
            maxCategories: {
              hiking: null,
              mountain: null,
              ski: null,
              water: null,
              caving: null,
              bicycle: null,
              horse: null,
              sailing: null,
              autoMoto: null,
            },
            disciplines: {
              nordicWalking: null,
              distanceHiking: null,
              distanceSki: null,
              distanceWater: null,
              distanceCaving: null,
            },
          },
        },
      }),
    )

    await selectByLabel(wrapper, 'Разряд или звание').setValue('')
    await flushPromises()

    expect(mocked.updateMe).toHaveBeenCalledWith({
      sportExperience: { alpinism: { rank: null } },
    })
  })

  it('показывает сообщение бэкенда, если сохранить не удалось', async () => {
    const wrapper = await mountSection()
    mocked.updateMe.mockRejectedValue(
      new ApiError(400, 'Имя: 2–50 символов, допустимы буквы, цифры, пробел'),
    )

    await wrapper.get('input[type="checkbox"]').setValue(true)
    await flushPromises()

    expect(wrapper.text()).toContain('Имя: 2–50 символов')
  })
})
