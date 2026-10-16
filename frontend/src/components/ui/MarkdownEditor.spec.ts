import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import MarkdownEditor from '@/components/ui/MarkdownEditor.vue'
import { objectToken, userToken } from '@/utils/markdown'

/**
 * Тесты редактора текста.
 *
 * Главное, что здесь проверяется, — **разметки не видно**. Человек должен
 * видеть жирное слово, а не `**звёздочки**`, и «Витязь», а не
 * `[[object:10]]`. Это не украшение, а требование заказчика: он прямо
 * сказал, что возрастные походники от звёздочек придут в ужас.
 *
 * Второе — обратимость: то, что редактор отдаёт наружу, должно быть тем
 * markdown-ом, из которого он это показал. Проверяется через
 * `update:modelValue`: именно это значение уедет на сервер.
 *
 * Таймеры поддельные: у поиска объекта задержка.
 */
const mocks = vi.hoisted(() => ({ listObjects: vi.fn() }))

vi.mock('@/api/objects', () => ({ listObjects: mocks.listObjects }))

const VITYAZ = {
  id: '10',
  name: 'Витязь',
  type: 'скала',
  url: null,
  parentId: '9',
  parentName: 'Олхинское плато',
}

/** Разметка внутри поля. */
function html(wrapper: VueWrapper): string {
  return wrapper.find('[data-test="md-editor"]').element.innerHTML
}

/** Последнее, что редактор отдал наружу. */
function emitted(wrapper: VueWrapper): string {
  const events = wrapper.emitted('update:modelValue')
  return (events?.[events.length - 1]?.[0] as string) ?? ''
}

/** Найти и вставить объект через панель. */
async function insertObject(wrapper: VueWrapper) {
  await wrapper.find('[data-test="md-object"]').trigger('click')
  await wrapper.find('[data-test="object-search"]').setValue('Витязь')
  await vi.advanceTimersByTimeAsync(400)
  await wrapper.find('[data-test="object-option"]').trigger('click')
}

describe('MarkdownEditor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.listObjects.mockReset()
    mocks.listObjects.mockResolvedValue([VITYAZ])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('показывает текст оформленным, без звёздочек', () => {
    const wrapper = mount(MarkdownEditor, {
      props: { modelValue: 'Идём на **Витязь**' },
    })

    expect(html(wrapper)).toContain('<strong>Витязь</strong>')
    expect(html(wrapper)).not.toContain('**')
  })

  it('показывает список списком, без дефисов', () => {
    const wrapper = mount(MarkdownEditor, {
      props: { modelValue: '- Раз\n- Два' },
    })

    expect(html(wrapper)).toContain('<ul>')
    expect(html(wrapper)).toContain('<li>Раз</li>')
    expect(html(wrapper)).not.toContain('- Раз')
  })

  it('показывает объект именем, а не токеном', () => {
    const wrapper = mount(MarkdownEditor, {
      props: {
        modelValue: 'Старт на [[object:10]]',
        mentions: { [objectToken('10')]: 'Витязь' },
      },
    })

    expect(html(wrapper)).toContain('Витязь')
    // Видимый текст токена не показывает — в этом весь смысл.
    expect(wrapper.find('[data-test="md-editor"]').text()).not.toContain('[[object')
    // А внутри токен есть, чтобы ссылка не потерялась при сохранении.
    expect(html(wrapper)).toContain('data-token="[[object:10]]"')
    // И id отдельно: у объектов будут свои страницы с историей посещений.
    expect(html(wrapper)).toContain('data-object-id="10"')
  })

  it('правка отдаёт наружу markdown', async () => {
    const wrapper = mount(MarkdownEditor, { props: { modelValue: '' } })

    wrapper.find('[data-test="md-editor"]').element.innerHTML =
      '<div>Привет, <strong>мир</strong></div>'
    await wrapper.find('[data-test="md-editor"]').trigger('input')

    expect(emitted(wrapper)).toBe('Привет, **мир**')
  })

  it('вставленный объект уходит токеном, а виден именем', async () => {
    const wrapper = mount(MarkdownEditor, { props: { modelValue: '' } })

    await insertObject(wrapper)

    expect(html(wrapper)).toContain('Витязь')
    expect(emitted(wrapper)).toBe('[[object:10]]')
  })

  it('фильтр объекта показывает родителя, а текст — нет', async () => {
    const wrapper = mount(MarkdownEditor, { props: { modelValue: '' } })

    await wrapper.find('[data-test="md-object"]').trigger('click')
    await wrapper.find('[data-test="object-search"]').setValue('Витязь')
    await vi.advanceTimersByTimeAsync(400)

    // В фильтре родитель обязателен: «Осиновка» без района — выбор наугад.
    const options = wrapper.find('[data-test="object-options"]').text()
    expect(options).toContain('Витязь · Олхинское плато')

    await wrapper.find('[data-test="object-option"]').trigger('click')

    // А в тексте — только имя: хвост с районом посреди фразы читается
    // как мусор.
    expect(html(wrapper)).toContain('>Витязь</span>')
    expect(html(wrapper)).not.toContain('Олхинское')
  })

  it('календарь вставляет дату словами', async () => {
    const wrapper = mount(MarkdownEditor, { props: { modelValue: '' } })

    await wrapper.find('[data-test="md-date"]').trigger('click')
    await wrapper.find('[data-test="date-input"]').setValue('2027-05-12')
    await wrapper.find('[data-test="date-insert"]').trigger('click')

    expect(emitted(wrapper)).toBe('12 мая 2027')
  })

  it('ссылка вставляется адресом', async () => {
    const wrapper = mount(MarkdownEditor, { props: { modelValue: '' } })

    await wrapper.find('[data-test="md-link"]').trigger('click')
    await wrapper.find('[data-test="link-input"]').setValue('https://example.com')
    await wrapper.find('[data-test="link-insert"]').trigger('click')

    expect(emitted(wrapper)).toBe('[https://example.com](https://example.com)')
    expect(html(wrapper)).toContain('<a href="https://example.com">')
  })

  it('участники вставляются, когда переданы', async () => {
    const wrapper = mount(MarkdownEditor, {
      props: {
        modelValue: '',
        participants: [{ id: 'u-1', name: 'Сергей' }],
      },
    })

    await wrapper.find('[data-test="md-participant"]').trigger('click')
    await wrapper.find('[data-test="participant-option"]').trigger('click')

    expect(emitted(wrapper)).toBe(userToken('u-1'))
  })

  it('смайликов нет, пока их не разрешили', () => {
    const without = mount(MarkdownEditor, { props: { modelValue: '' } })
    expect(without.find('[data-test="md-emoji"]').exists()).toBe(false)

    const with_ = mount(MarkdownEditor, {
      props: { modelValue: '', emoji: true },
    })
    expect(with_.find('[data-test="md-emoji"]').exists()).toBe(true)
  })

  it('подсказка видна в пустом поле и уходит при вводе', async () => {
    const wrapper = mount(MarkdownEditor, {
      props: { modelValue: '', placeholder: 'Как идём' },
    })

    expect(wrapper.text()).toContain('Как идём')

    wrapper.find('[data-test="md-editor"]').element.innerHTML = '<div>Текст</div>'
    await wrapper.find('[data-test="md-editor"]').trigger('input')

    expect(wrapper.text()).not.toContain('Как идём')
  })
})
