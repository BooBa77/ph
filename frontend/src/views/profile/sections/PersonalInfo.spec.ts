import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/errors'
import type { User } from '@/api/types'
import EditableField from '@/components/ui/EditableField.vue'
import { useAuthStore } from '@/stores/auth'
import PersonalInfo from '@/views/profile/sections/PersonalInfo.vue'

/**
 * Тесты вкладки «Профиль».
 *
 * Проверяем то, что легко сломать незаметно: подпись поля имени, подсказки
 * городов (появляются у пустого города, прячутся у заполненного и
 * возвращаются после очистки) и пищевые ограничения.
 *
 * Спортивный опыт отсюда уехал в свою вкладку — его тесты лежат рядом,
 * в `SportExperience.spec.ts`.
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
    gender: 'm',
    isVegetarian: false,
    allergies: null,
    sportExperience: null,
    isAdmin: false,
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

/** Поле ввода по подписи, как его видит пользователь. */
function editableFieldByLabel(wrapper: VueWrapper, label: string) {
  const field = wrapper
    .findAllComponents(EditableField)
    .find((item) => item.props('label') === label)

  if (!field) throw new Error(`Нет поля «${label}»`)
  return field
}

/** Кнопка по её тексту — их в разделе несколько. */
function buttonByText(wrapper: VueWrapper, text: string) {
  const button = wrapper.findAll('button').find((item) => item.text() === text)
  if (!button) throw new Error(`Нет кнопки «${text}»`)
  return button
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

  it('возвращает подсказки городов после очистки города', async () => {
    // Раньше город нельзя было стереть вообще: EditableField не отправлял
    // пустое значение, и подсказки не возвращались. Кнопки «Убрать» у города
    // нет — чистим прямо в поле.
    mocked.updateMe.mockResolvedValue(makeUser({ location: null }))
    const wrapper = await mountSection(makeUser({ location: 'Иркутск' }))
    const field = editableFieldByLabel(wrapper, 'Город')

    await field.get('button').trigger('click')
    await field.get('input').setValue('')
    await field.get('input').trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(mocked.updateMe).toHaveBeenCalledWith({ location: null })

    const texts = wrapper.findAll('button').map((item) => item.text())
    expect(texts).toContain('Иркутск')
    expect(texts).toContain('Ангарск')
  })

  it('очищает город и стиранием текста в поле', async () => {
    mocked.updateMe.mockResolvedValue(makeUser({ location: null }))
    const wrapper = await mountSection(makeUser({ location: 'Иркутск' }))
    const field = editableFieldByLabel(wrapper, 'Город')

    await field.get('button').trigger('click')
    await field.get('input').setValue('')
    await field.get('input').trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(mocked.updateMe).toHaveBeenCalledWith({ location: null })
  })

  it('по умолчанию пол мужской', async () => {
    const wrapper = await mountSection()

    expect(wrapper.findAll('input[type="radio"]')).toHaveLength(2)
    expect(
      wrapper.get<HTMLInputElement>('input[type="radio"][value="m"]').element.checked,
    ).toBe(true)
    expect(
      wrapper.get<HTMLInputElement>('input[type="radio"][value="f"]').element.checked,
    ).toBe(false)
  })

  it('переключает пол на женский и сохраняет его', async () => {
    const wrapper = await mountSection()

    await wrapper.get('input[type="radio"][value="f"]').setValue(true)
    await flushPromises()

    expect(mocked.updateMe).toHaveBeenCalledWith({ gender: 'f' })
  })

  it('показывает сохранённый пол', async () => {
    const wrapper = await mountSection(makeUser({ gender: 'f' }))

    expect(
      wrapper.get<HTMLInputElement>('input[type="radio"][value="f"]').element.checked,
    ).toBe(true)
  })

  it('показывает галочку вегетарианства снятой, если её не ставили', async () => {
    const wrapper = await mountSection()

    expect(wrapper.get<HTMLInputElement>('input[type="checkbox"]').element.checked).toBe(false)
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

    await buttonByText(wrapper, 'Убрать').trigger('click')
    await flushPromises()

    expect(mocked.updateMe).toHaveBeenCalledWith({ allergies: null })
  })

  it('пустые аллергии показывает словами, а не прочерком', async () => {
    const wrapper = await mountSection()

    expect(editableFieldByLabel(wrapper, 'Мои аллергии').text()).toContain('— нет —')
  })

  it('рисует поля ввода фоном полей, а не фоном страницы', async () => {
    const wrapper = await mountSection()
    const field = editableFieldByLabel(wrapper, 'Город')

    // Фон полей — отдельный токен темы: на осенней теме поле сливалось
    // со страницей, и было не понять, что сюда можно писать.
    expect(field.get('button').classes()).toContain('bg-field')

    await field.get('button').trigger('click')

    // В режиме правки поле тоже не темнеет: тот же фон полей.
    expect(field.get('input').classes()).toContain('bg-field')
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
