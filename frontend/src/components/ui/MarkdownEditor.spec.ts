import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import MarkdownEditor from '@/components/ui/MarkdownEditor.vue'

/**
 * Тесты редактора markdown.
 *
 * Редактор универсальный: он не знает ни про походы, ни про маршруты,
 * и проверять его надо на этом же уровне — что инструменты оформления
 * работают с выделением, что вставка идёт в место курсора, и что
 * отключаемые куски действительно отключаются.
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

/** Текущее содержимое поля. */
function value(wrapper: VueWrapper): string {
  return (wrapper.find('[data-test="md-textarea"]').element as HTMLTextAreaElement).value
}

/** Выделить диапазон и нажать кнопку панели. */
async function clickWithSelection(wrapper: VueWrapper, start: number, end: number, test: string) {
  const field = wrapper.find('[data-test="md-textarea"]').element as HTMLTextAreaElement
  field.setSelectionRange(start, end)
  await wrapper.find(`[data-test="${test}"]`).trigger('click')
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

  it('выделение оборачивается маркерами жирного и курсива', async () => {
    // Каждую проверку — на своём экземпляре: подмена modelValue у уже
    // смонтированного редактора проверяла бы не редактор, а то, как тест
    // обошёлся с его состоянием.
    const bold = mount(MarkdownEditor, { props: { modelValue: 'Витязь' } })
    await clickWithSelection(bold, 0, 6, 'md-bold')
    expect(value(bold)).toBe('**Витязь**')

    const italic = mount(MarkdownEditor, { props: { modelValue: 'Витязь' } })
    await clickWithSelection(italic, 0, 6, 'md-italic')
    expect(value(italic)).toBe('*Витязь*')

    const code = mount(MarkdownEditor, { props: { modelValue: 'Витязь' } })
    await clickWithSelection(code, 0, 6, 'md-code')
    expect(value(code)).toBe('`Витязь`')
  })

  it('список и цитата ставятся префиксом к строкам', async () => {
    const wrapper = mount(MarkdownEditor, {
      props: { modelValue: 'Первая\nВторая' },
    })

    await clickWithSelection(wrapper, 0, 13, 'md-list')
    expect(value(wrapper)).toBe('- Первая\n- Вторая')

    // Повторное нажатие снимает префикс: иначе кнопка умеет только
    // включать, и выключить список можно лишь руками.
    await clickWithSelection(wrapper, 0, value(wrapper).length, 'md-list')
    expect(value(wrapper)).toBe('Первая\nВторая')

    await clickWithSelection(wrapper, 0, 6, 'md-quote')
    expect(value(wrapper)).toBe('> Первая\nВторая')
  })

  it('смайликов нет, если их не разрешили', () => {
    const wrapper = mount(MarkdownEditor, { props: { modelValue: '' } })

    // В описании маршрута смайлик не несёт ничего, поэтому по умолчанию
    // кнопки нет вовсе, а не «есть, но неактивна».
    expect(wrapper.find('[data-test="md-emoji"]').exists()).toBe(false)
  })

  it('смайлик вставляется, когда разрешён', async () => {
    const wrapper = mount(MarkdownEditor, {
      props: { modelValue: '', emoji: true },
    })

    expect(wrapper.find('[data-test="md-emoji"]').exists()).toBe(true)

    await wrapper.find('[data-test="md-emoji"]').trigger('click')
    await wrapper.find('[data-test="emoji-option"]').trigger('click')

    expect(value(wrapper)).toContain('⛰️')
  })

  it('участники есть только там, где их передали', async () => {
    const without = mount(MarkdownEditor, { props: { modelValue: '' } })
    expect(without.find('[data-test="md-participant"]').exists()).toBe(false)

    const with_ = mount(MarkdownEditor, {
      props: {
        modelValue: '',
        participants: [{ id: 'u-1', name: 'Сергей' }],
      },
    })

    await with_.find('[data-test="md-participant"]').trigger('click')
    await with_.find('[data-test="participant-option"]').trigger('click')

    expect(value(with_)).toBe('[[user:u-1]]')
  })

  it('объект вставляется ссылкой в место курсора', async () => {
    const wrapper = mount(MarkdownEditor, {
      props: { modelValue: 'Старт: конец' },
    })

    // Курсор в середине: ссылка должна встать туда, а не в хвост —
    // маршрут пишут по частям, и дописывание в конец ломало бы порядок.
    const field = wrapper.find('[data-test="md-textarea"]').element as HTMLTextAreaElement
    field.setSelectionRange(7, 7)

    await wrapper.find('[data-test="md-object"]').trigger('click')
    await wrapper.find('[data-test="object-search"]').setValue('Витязь')
    await vi.advanceTimersByTimeAsync(400)
    await wrapper.find('[data-test="object-option"]').trigger('click')

    expect(value(wrapper)).toBe('Старт: [[object:10]]конец')
  })

  it('имя объекта в редакторе показывается без родителя', async () => {
    const wrapper = mount(MarkdownEditor, { props: { modelValue: '' } })

    await wrapper.find('[data-test="md-object"]').trigger('click')
    await wrapper.find('[data-test="object-search"]').setValue('Витязь')
    await vi.advanceTimersByTimeAsync(400)

    const options = wrapper.find('[data-test="object-options"]').text()
    expect(options).toContain('Витязь')
    // В тексте ссылка подписывается именем, и хвост «· Олхинское плато»
    // в середине фразы читался бы как мусор.
    expect(options).not.toContain('Олхинское плато')
  })
})
