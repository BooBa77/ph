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
 */
function inlineToHtml(text: string, names: MentionNames): string {
  let html = escapeHtml(text)

  html = html.replace(/\[\[(object|user):([^\]]+)\]\]/g, (_match, kind: string, id: string) => {
    const token = kind === 'object' ? objectToken(id) : userToken(id)
    const label = mentionLabel(kind, id, names)
    // `data-object-id` отдельно от токена: у объектов будут свои
    // страницы с историей посещений, и рендеру понадобится id,
    // а не разбирать ради него токен заново.
    const objectId = kind === 'object' ? ` data-object-id="${escapeHtml(id)}"` : ''

    return (
      `<span data-token="${escapeHtml(token)}"${objectId}` +
      ` contenteditable="false"` +
      ` class="rounded bg-field px-1 text-primary">${escapeHtml(label)}</span>`
    )
  })

  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')

  return html
}

/**
 * Markdown → HTML для редактирования.
 *
 * Каждая строка — отдельный `<div>`: так браузер понимает перевод строки
 * и не склеивает абзацы. Пустая строка — `<div><br></div>`, иначе браузер
 * выбросит её при первой же правке.
 */
export function markdownToHtml(markdown: string, names: MentionNames = {}): string {
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
      html.push(`<li>${inlineToHtml(line.slice(2), names)}</li>`)
    } else if (line.trim() === '') {
      html.push('<div><br></div>')
    } else {
      html.push(`<div>${inlineToHtml(line, names)}</div>`)
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
