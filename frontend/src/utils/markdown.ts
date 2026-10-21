/**
 * Разметка редактора: markdown ↔ HTML.
 *
 * Вынесено из компонента в чистые функции нарочно. Это единственное место
 * в редакторе, где легко ошибиться незаметно: лишняя звёздочка, потерянный
 * перевод строки, съеденная ссылка на объект. Проверять такое в браузере
 * глазами — значит однажды не заметить, а тестами на чистых функциях —
 * дёшево и надёжно. Компонент остаётся тонким: он только даёт браузеру
 * редактировать и зовёт эти две функции.
 *
 * Поддерживается **только то, что умеет панель редактора**: жирный, список,
 * ссылки и ссылки на сущности. Полный markdown не нужен: в походном тексте
 * из оформления бывает жирный и список, остальное — украшательство, а чем
 * меньше разметки, тем меньше способов её сломать.
 *
 * Ссылки на сущности (`[[object:10]]`, `[[user:UUID]]`) в редактируемом
 * виде показываются **именем, а не токеном**: возрастной походник, увидев
 * квадратные скобки, решит, что сломалось. Токен живёт внутри HTML —
 * в неизменяемом `span[data-token]`, поэтому его нельзя случайно стереть
 * по буквам.
 */

/** Что известно про сущность, на которую ссылаются: токен → имя. */
export type MentionNames = Record<string, string>

/**
 * Куда ведёт ссылка на сущность: токен → адрес внешней страницы.
 *
 * Отдельная карта, а не поле в `MentionNames`: имя нужно **всегда** (иначе
 * в тексте останется «объект 10»), а ссылка — только в режиме чтения.
 * В редакторе ссылку делать нельзя: `contenteditable` с якорем внутри
 * разваливает правку — по объекту начинают ходить переходом вместо
 * выделения.
 *
 * Участникам страницы пока нет, поэтому пустая карта — норма: текст
 * покажется без ссылки, но с именем.
 */
export type MentionLinks = Record<string, string>

/** Токены ссылок на объекты, найденные в тексте. */
export function extractObjectIds(markdown: string): string[] {
  const found = new Set<string>()
  for (const match of markdown.matchAll(/\[\[object:(\d+)\]\]/g)) {
    found.add(match[1] as string)
  }
  return [...found]
}

/** Токен ссылки на объект. */
export function objectToken(id: string | number): string {
  return `[[object:${id}]]`
}

/** Токен ссылки на участника. */
export function userToken(id: string): string {
  return `[[user:${id}]]`
}

/** Экранировать текст, чтобы он не стал разметкой. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Как подписать сущность, имени которой мы не знаем. */
function fallbackName(kind: string, id: string): string {
  return kind === 'object' ? `объект ${id}` : `участник ${id}`
}

/**
 * Подпись ссылки на сущность.
 *
 * Имя **без родителя**: в тексте «Витязь» читается, а «Витязь · Олхинское
 * плато» посреди фразы — мусор. Родитель нужен в фильтре, где имена
 * повторяются, и там он остаётся.
 */
function mentionLabel(kind: string, id: string, names: MentionNames): string {
  const token = kind === 'object' ? objectToken(id) : userToken(id)
  return names[token] ?? fallbackName(kind, id)
}

/**
 * Строчная разметка: жирный, ссылки, ссылки на сущности.
 *
 * Порядок важен. Сначала экранирование, потом сущности, потом markdown:
 * если поменять местами, пользовательский текст со звёздочками превратится
 * в разметку, а вставленный объект — в кашу.
 *
 * Экспортируется отдельно от `markdownToHtml`, потому что **вставка
 * в середину строки не имеет права быть блочной**. `markdownToHtml` для
 * каждой строки делает `<div>`, и вставленный посреди фразы объект разрывал
 * абзац надвое: «Старт [[object:10]]\n конец» вместо «Старт [[object:10]]
 * конец». Для вставки нужен именно строчный фрагмент.
 *
 * **`links` — только для чтения, не для редактора.** Если объекту известна
 * внешняя страница, имя становится ссылкой на неё (`objects.url`,
 * «Природа Байкала»); в редакторе карта пустая, и на месте имени остаётся
 * неизменяемый `span` с токеном — иначе по тексту нельзя было бы щёлкнуть
 * и встать в него курсором.
 */
export function inlineMarkdownToHtml(
  text: string,
  names: MentionNames = {},
  links: MentionLinks = {},
): string {
  let html = escapeHtml(text)

  html = html.replace(/\[\[(object|user):([^\]]+)\]\]/g, (_match, kind: string, id: string) => {
    const token = kind === 'object' ? objectToken(id) : userToken(id)
    const label = mentionLabel(kind, id, names)
    // `data-object-id` отдельно от токена: у объектов будут свои
    // страницы с историей посещений, и рендеру понадобится id,
    // а не разбирать ради него токен заново.
    const objectId = kind === 'object' ? ` data-object-id="${escapeHtml(id)}"` : ''

    /**
     * Адрес приходит из справочника, но проверяем схему всё равно: однажды
     * справочник пополнят руками, и `javascript:` в `href` стал бы
     * исполняемым кодом на нашей странице.
     */
    const url = kind === 'object' ? links[token] : undefined
    if (url && /^https?:/i.test(url)) {
      return (
        `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"` +
        ` data-token="${escapeHtml(token)}"${objectId}` +
        ` class="rounded bg-field px-1 text-primary underline">${escapeHtml(label)}</a>`
      )
    }

    return (
      `<span data-token="${escapeHtml(token)}"${objectId}` +
      ` contenteditable="false"` +
      ` class="rounded bg-field px-1 text-primary">${escapeHtml(label)}</span>`
    )
  })

  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, text: string, url: string) => {
    // Только безопасные схемы. `javascript:` в href — это исполняемый код
    // на нашей странице, а адрес приходит от пользователя.
    if (!/^(https?:|mailto:)/i.test(url)) {
      return escapeHtml(`[${text}](${url})`)
    }

    return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${text}</a>`
  })

  return html
}

/**
 * Markdown → HTML для редактирования.
 *
 * Каждая строка — отдельный `<div>`: так браузер понимает перевод строки
 * и не склеивает абзацы. Пустая строка — `<div><br></div>`, иначе браузер
 * выбросит её при первой же правке.
 *
 * `links` прокидывается в строчную разметку и нужен только режиму чтения:
 * в редакторе он пустой, и объекты остаются неизменяемыми вставками.
 */
export function markdownToHtml(
  markdown: string,
  names: MentionNames = {},
  links: MentionLinks = {},
): string {
  // Пустой текст — пустое поле. Иначе в нём сразу лежал бы `<div><br></div>`,
  // то есть «одна пустая строка», и подсказка о пустом поле спорила бы
  // с содержимым.
  if (markdown === '') return ''

  const lines = markdown.split('\n')
  const html: string[] = []
  let inList = false

  for (const line of lines) {
    const isItem = line.startsWith('- ')

    if (isItem && !inList) {
      html.push('<ul>')
      inList = true
    } else if (!isItem && inList) {
      html.push('</ul>')
      inList = false
    }

    if (isItem) {
      html.push(`<li>${inlineMarkdownToHtml(line.slice(2), names, links)}</li>`)
    } else if (line.trim() === '') {
      html.push('<div><br></div>')
    } else {
      html.push(`<div>${inlineMarkdownToHtml(line, names, links)}</div>`)
    }
  }

  if (inList) html.push('</ul>')

  return html.join('')
}

/** Собрать текст из детей узла. */
function serializeChildren(node: Node): string {
  let out = ''
  node.childNodes.forEach((child) => {
    out += serializeNode(child)
  })
  return out
}

function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  if (node.nodeType !== Node.ELEMENT_NODE) return ''

  const element = node as HTMLElement
  const tag = element.tagName.toLowerCase()

  // Ссылка на сущность узнаётся по токену, а не по виду: подпись могла
  // смениться, а токен остаётся.
  const token = element.getAttribute('data-token')
  if (token) return token

  const inner = serializeChildren(element)

  switch (tag) {
    case 'br':
      return '\n'
    case 'strong':
    case 'b':
      return inner.trim() ? `**${inner}**` : inner
    case 'a':
      return `[${inner}](${element.getAttribute('href') ?? ''})`
    case 'li':
      return `- ${inner}\n`
    case 'ul':
    case 'ol':
      return inner
    case 'div':
    case 'p':
      // `<div><br></div>` — это пустая строка, а не «строка с переводом»:
      // иначе между абзацами набирался бы лишний отступ с каждым
      // сохранением.
      return inner === '\n' ? '\n' : `${inner}\n`
    default:
      return inner
  }
}

/** HTML из редактора → markdown. */
export function htmlToMarkdown(html: string): string {
  const root = document.createElement('div')
  root.innerHTML = html

  return serializeChildren(root)
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+$/gm, '')
    .trim()
}
