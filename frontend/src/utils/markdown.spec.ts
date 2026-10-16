import { describe, expect, it } from 'vitest'

import { htmlToMarkdown, markdownToHtml, objectToken, userToken } from '@/utils/markdown'

/**
 * Тесты разметки редактора.
 *
 * Здесь проверяется главное свойство: **текст не портится при правке**.
 * Человек написал маршрут, редактор показал его без разметки, человек
 * сохранил — и в базе должно лежать то же самое. Поэтому кроме прямых
 * превращений проверяется ещё и обратимость: markdown → HTML → markdown
 * обязан вернуть исходное, иначе каждое сохранение потихоньку съедало бы
 * абзацы и звёздочки.
 */
const NAMES = {
  [objectToken('10')]: 'Витязь',
  [userToken('u-1')]: 'Сергей',
}

describe('markdownToHtml', () => {
  it('жирный становится strong', () => {
    expect(markdownToHtml('Идём на **Витязь**')).toContain('<strong>Витязь</strong>')
  })

  it('пустой текст не превращается в пустую строку', () => {
    // Иначе в пустом поле сразу лежал бы `<div><br></div>`, и подсказка
    // «начните печатать» спорила бы с содержимым.
    expect(markdownToHtml('')).toBe('')
  })

  it('строка становится div, пустая — пустым div', () => {
    expect(markdownToHtml('Первая\n\nВторая')).toBe(
      '<div>Первая</div><div><br></div><div>Вторая</div>',
    )
  })

  it('список становится ul, а не дефисами', () => {
    expect(markdownToHtml('- Раз\n- Два')).toBe('<ul><li>Раз</li><li>Два</li></ul>')
  })

  it('объект показывается именем и держит токен внутри', () => {
    const html = markdownToHtml('Старт на [[object:10]]', NAMES)

    expect(html).toContain('>Витязь</span>')
    expect(html).toContain('data-token="[[object:10]]"')
    // Неизменяемый: иначе токен можно стереть по буквам и ссылка исчезнет.
    expect(html).toContain('contenteditable="false"')
  })

  it('объект показывается без родителя', () => {
    const html = markdownToHtml('[[object:10]]', NAMES)

    // В тексте «Витязь» читается, а «Витязь · Олхинское плато» посреди
    // фразы — мусор. Родитель нужен в фильтре, там он и остаётся.
    expect(html).toContain('>Витязь</span>')
    expect(html).not.toContain('Олхинское')
  })

  it('имя неизвестной сущности не выдумывается', () => {
    // Имени нет — показываем понятное «объект 77», а не пустое место
    // и не выдуманное название.
    expect(markdownToHtml('[[object:77]]')).toContain('объект 77')
  })

  it('разметка в тексте пользователя не срабатывает', () => {
    // Он написал «2*3*4» и «<b>», и это должно остаться текстом:
    // экранирование идёт до разметки.
    const html = markdownToHtml('2*3*4 и <b>тег</b>')

    expect(html).toContain('&lt;b&gt;')
    expect(html).not.toContain('<b>')
  })

  it('ссылка становится ссылкой', () => {
    expect(markdownToHtml('[отчёт](https://example.com)')).toContain(
      '<a href="https://example.com">отчёт</a>',
    )
  })
})

describe('htmlToMarkdown', () => {
  it('strong возвращается звёздочками', () => {
    expect(htmlToMarkdown('<div>Идём на <strong>Витязь</strong></div>')).toBe('Идём на **Витязь**')
  })

  it('список возвращается дефисами', () => {
    expect(htmlToMarkdown('<ul><li>Раз</li><li>Два</li></ul>')).toBe('- Раз\n- Два')
  })

  it('ссылка на объект возвращается токеном, а не именем', () => {
    const html = '<div>Старт на <span data-token="[[object:10]]">Витязь</span></div>'

    expect(htmlToMarkdown(html)).toBe('Старт на [[object:10]]')
  })

  it('пустой div — это пустая строка, а не лишний отступ', () => {
    expect(htmlToMarkdown('<div>Первая</div><div><br></div><div>Вторая</div>')).toBe(
      'Первая\n\nВторая',
    )
  })
})

describe('обратимость', () => {
  const samples = [
    'Идём на **Витязь** через перевал',
    '- Раз\n- Два\n- Три',
    'Первый абзац\n\nВторой абзац',
    'Старт на [[object:10]], идёт [[user:u-1]]',
    'Ссылка [отчёт](https://example.com) и **жирный**',
    '',
  ]

  it.each(samples)('текст не портится: %j', (sample) => {
    const html = markdownToHtml(sample, NAMES)
    expect(htmlToMarkdown(html)).toBe(sample)
  })

  it('двойное превращение ничего не добавляет', () => {
    // Каждое сохранение прогоняет текст туда и обратно: если появится
    // хоть один лишний перевод строки, за десять правок текст уползёт
    // вниз на десять строк.
    const once = htmlToMarkdown(markdownToHtml('Раз\n\nДва', NAMES))
    const twice = htmlToMarkdown(markdownToHtml(once, NAMES))

    expect(twice).toBe(once)
  })
})
