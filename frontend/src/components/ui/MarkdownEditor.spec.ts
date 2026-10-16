import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import MarkdownEditor from '@/components/ui/MarkdownEditor.vue'
import { objectToken, userToken } from '@/utils/markdown'

/**
 * Тесты редактора текста.
 *
 * Первая версия редактора провалилась на живом человеке: объект падал
 * в начало текста, список не работал вовсе, кнопка не показывала нажатие.
 * Поэтому здесь проверяется не «рендерится ли», а именно то, что человек
 * нашёл руками:
 *
 * - **вставка идёт туда, где стоял курсор**, даже если фокус успел уйти
 *   в поиск объекта — на этом всё и ломалось;
 * - **список ставит и снимает маркеры** — своя реализация, а не команда
 *   браузера, поэтому её можно проверить;
 * - **объекты и даты отделяются пробелами** и не прилипают к словам;
 * - **дата вставляется сразу** после выбора в календаре.
 *
 * ## Выделение поддельное, и это не жульничество
 *
 * jsdom **не хранит диапазоны в `window.getSelection()`**: после `addRange`
 * количество диапазонов остаётся нулевым, а `anchorNode` — пустым. То есть
 * в этой среде выделения не существует как факта, и всё, что с ним связано,
 * проверялось бы «на слово» — что и случилось: первые тесты проходили,
 * а у заказчика объект уезжал в начало текста.
 *
 * Поэтому в тестах подставляется своя реализация выделения — ровно тот
 * набор методов, которым пользуется редактор. Компонент от этого не
 * меняется: он работает с `Selection` через `addRange`, `removeAllRanges`,
 * `getRangeAt` и `anchorNode`, а кто именно это реализует, ему всё равно.
 *
 * Непроверенным остаётся одно допущение, и его надо держать в голове:
 * в настоящем браузере `blur` приходит, пока выделение ещё живо, — на этом
 * и держится запоминание места курсора.
 *
 * Таймеры тоже поддельные: у поиска объекта задержка.
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

/** Выделение, которое в самом деле помнит диапазоны. */
class FakeSelection {
  private ranges: Range[] = []

  get rangeCount(): number {
    return this.ranges.length
  }

  get anchorNode(): Node | null {
    return this.ranges[0]?.startContainer ?? null
  }

  get anchorOffset(): number {
    return this.ranges[0]?.startOffset ?? 0
  }

  addRange(range: Range): void {
    this.ranges = [range]
  }

  removeAllRanges(): void {
    this.ranges = []
  }

  getRangeAt(index: number): Range {
    const range = this.ranges[index]
    if (!range) throw new Error('Диапазона нет')
    return range
  }
}

let selection: FakeSelection

function editor(wrapper: VueWrapper): HTMLElement {
  return wrapper.find('[data-test="md-editor"]').element as HTMLElement
}

/** Разметка внутри поля. */
function html(wrapper: VueWrapper): string {
  return editor(wrapper).innerHTML
}

/** Последнее, что редактор отдал наружу. */
function emitted(wrapper: VueWrapper): string {
  const events = wrapper.emitted('update:modelValue')
  return (events?.[events.length - 1]?.[0] as string) ?? ''
}

/** Первый текстовый узел внутри поля. */
function firstText(wrapper: VueWrapper): Node {
  const block = editor(wrapper).querySelector('div')
  return block?.firstChild ?? editor(wrapper)
}

/** Поставить курсор на нужное место — как это делает человек мышкой. */
function placeCaret(wrapper: VueWrapper, offset: number) {
  const node = firstText(wrapper)
  const range = document.createRange()
  range.setStart(node, Math.min(offset, (node.textContent ?? '').length))
  range.collapse(true)

  selection.removeAllRanges()
  selection.addRange(range)
}

/** Курсор ушёл из редактора в поиск — момент, когда место надо запомнить. */
async function leaveEditor(wrapper: VueWrapper) {
  await wrapper.find('[data-test="md-editor"]').trigger('blur')
  // Настоящий ввод в поле поиска убивает выделение в редакторе.
  selection.removeAllRanges()
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
    selection = new FakeSelection()
    vi.spyOn(window, 'getSelection').mockReturnValue(selection as unknown as Selection)
    mocks.listObjects.mockReset()
    mocks.listObjects.mockResolvedValue([VITYAZ])
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
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

    editor(wrapper).innerHTML = '<div>Привет, <strong>мир</strong></div>'
    await wrapper.find('[data-test="md-editor"]').trigger('input')

    expect(emitted(wrapper)).toBe('Привет, **мир**')
  })

  it('вставленный объект уходит токеном, а виден именем', async () => {
    const wrapper = mount(MarkdownEditor, { props: { modelValue: '' } })

    await insertObject(wrapper)

    expect(html(wrapper)).toContain('Витязь')
    expect(emitted(wrapper)).toBe('[[object:10]]')
  })

  it('объект встаёт туда, где стоял курсор, даже если фокус ушёл в поиск', async () => {
    const wrapper = mount(MarkdownEditor, {
      props: { modelValue: 'Пересекаем ручей, обедаем и к часу дня выходим к' },
    })

    placeCaret(wrapper, 48)
    await leaveEditor(wrapper)

    await insertObject(wrapper)

    // Именно эта строка сломалась у заказчика: объект уезжал в начало.
    expect(emitted(wrapper)).toBe('Пересекаем ручей, обедаем и к часу дня выходим к [[object:10]]')
  })

  it('вокруг объекта ровно один пробел, а не два', async () => {
    const wrapper = mount(MarkdownEditor, {
      props: { modelValue: 'Старт конец' },
    })

    placeCaret(wrapper, 5)
    await leaveEditor(wrapper)

    await insertObject(wrapper)

    // Заказчик сказал «обрамляется двумя пробелами, переборщили»: пробел
    // справа принадлежит следующему слову, и свой добавлять не надо.
    expect(emitted(wrapper)).toBe('Старт [[object:10]] конец')
  })

  it('без пробела рядом объект не прилипает к слову', async () => {
    const wrapper = mount(MarkdownEditor, {
      props: { modelValue: 'выходим к' },
    })

    placeCaret(wrapper, 9)
    await leaveEditor(wrapper)

    await insertObject(wrapper)

    expect(emitted(wrapper)).toBe('выходим к [[object:10]]')
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

  it('дата выбирается в календаре-модалке и вставляется сразу', async () => {
    const wrapper = mount(MarkdownEditor, {
      props: { modelValue: 'Ночёвка,' },
    })
    placeCaret(wrapper, 8)

    await wrapper.find('[data-test="md-date"]').trigger('click')

    // Календарь — модалка по центру, а не панель с полем ввода под панелью:
    // заказчик просил именно так.
    expect(wrapper.find('[data-test="date-modal"]').exists()).toBe(true)

    await wrapper.find('[data-test="date-day-15"]').trigger('click')

    const now = new Date()
    const months = [
      'января',
      'февраля',
      'марта',
      'апреля',
      'мая',
      'июня',
      'июля',
      'августа',
      'сентября',
      'октября',
      'ноября',
      'декабря',
    ]

    expect(emitted(wrapper)).toBe(`Ночёвка, 15 ${months[now.getMonth()]} ${now.getFullYear()}`)
    // Модалка закрылась — вставлять второй раз нечего.
    expect(wrapper.find('[data-test="date-modal"]').exists()).toBe(false)
  })

  it('дату можно не вставлять: «Отмена» закрывает календарь', async () => {
    const wrapper = mount(MarkdownEditor, { props: { modelValue: '' } })

    await wrapper.find('[data-test="md-date"]').trigger('click')
    await wrapper.find('[data-test="date-cancel"]').trigger('click')

    expect(wrapper.find('[data-test="date-modal"]').exists()).toBe(false)
    expect(emitted(wrapper)).toBe('')
  })

  it('ссылка вставляется адресом', async () => {
    const wrapper = mount(MarkdownEditor, { props: { modelValue: '' } })

    await wrapper.find('[data-test="md-link"]').trigger('click')
    await wrapper.find('[data-test="link-input"]').setValue('https://example.com')
    await wrapper.find('[data-test="link-insert"]').trigger('click')

    expect(emitted(wrapper)).toBe('[https://example.com](https://example.com)')
    expect(html(wrapper)).toContain('<a href="https://example.com"')
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

    editor(wrapper).innerHTML = '<div>Текст</div>'
    await wrapper.find('[data-test="md-editor"]').trigger('input')

    expect(wrapper.text()).not.toContain('Как идём')
  })
})
