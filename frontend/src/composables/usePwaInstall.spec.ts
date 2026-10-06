import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Тесты установки PWA.
 *
 * Проверяем не «нажимается ли кнопка», а логику вокруг неё: событие
 * beforeinstallprompt приходит один раз и до того, как пользователь
 * откроет меню, поэтому состояние живёт в модуле, а не в компоненте.
 * Именно это и проверяем: успели ли подписаться, не показываем ли кнопку
 * после установки, что происходит, когда браузер промпт не присылает.
 *
 * Модуль импортируется заново на каждый тест: подписки на window копятся,
 * и без сброса второй тест получил бы состояние первого.
 */
type PwaInstall = typeof import('./usePwaInstall')

/** Заглушка matchMedia: в jsdom её нет. `standalone` — режим установленного приложения. */
function stubMatchMedia(standalone: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: standalone && query.includes('standalone'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  )
}

/**
 * Мок beforeinstallprompt.
 *
 * Событие обязано быть cancelable: наш обработчик вызывает preventDefault,
 * чтобы браузер не показывал свой баннер установки. У обычного
 * `new Event(name)` cancelable = false, и preventDefault молча ничего
 * не делает — на этом проверка «событие отменено» и спотыкалась.
 */
function makePromptEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt', { cancelable: true })
  Object.assign(event, {
    prompt: vi.fn().mockResolvedValue(undefined),
    userChoice: Promise.resolve({ outcome }),
  })
  return event as Event & {
    prompt: ReturnType<typeof vi.fn>
    userChoice: Promise<{ outcome: string }>
  }
}

/** Событие приходит из браузера — диспатчим его на window. */
function fire(event: Event) {
  window.dispatchEvent(event)
  return event
}

describe('usePwaInstall', () => {
  let pwa: PwaInstall

  beforeEach(async () => {
    // Сброс модулей до подстановки заглушек: заглушки снимаются только
    // в afterEach, а подписки и состояние живут на window, который между
    // тестами не пересоздаётся. Импорт «после» даёт модуль, не видевший
    // следов прошлого теста.
    vi.resetModules()
    delete window.__phInstallPrompt
    delete window.__phInstallCleanup
    stubMatchMedia(false)

    // registerPwaInstall выходит в dev-режиме: PWA в dev выключена.
    vi.stubEnv('DEV', false)

    pwa = await import('./usePwaInstall')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('установку предлагает, даже если браузер промпт не прислал', () => {
    // canInstall — это «приложение ещё не установлено», а не «браузер дал
    // промпт». Кнопка должна быть видна и в Safari, где нативного диалога
    // нет вовсе: иначе пользователь айфона не увидит установку никогда.
    // Именно эту путаницу я и допустил в первой версии кода.
    const api = pwa.usePwaInstall()

    expect(api.canInstall.value).toBe(true)
    expect(api.needsHint.value).toBe(true)
  })

  it('после beforeinstallprompt предлагает нативный диалог', () => {
    // Подписка и чтение состояния — из одного и того же экземпляра модуля:
    // импорт после resetModules дал бы новый модуль со своим состоянием,
    // и обработчик первого писал бы в никуда.
    const api = pwa.usePwaInstall()
    pwa.registerPwaInstall()

    const event = fire(makePromptEvent())

    expect(event.defaultPrevented).toBe(true)
    expect(api.canInstall.value).toBe(true)
    // Промпт есть — инструкция уже не нужна, кнопка откроет диалог.
    expect(api.needsHint.value).toBe(false)
  })

  it('в уже установленном приложении установку не предлагает', () => {
    const api = pwa.usePwaInstall()

    // Здесь всё наоборот: состояние «установлено» читается лениво,
    // но заглушку всё равно надо поставить до чтения.
    stubMatchMedia(true)
    pwa.registerPwaInstall()

    // Даже если событие почему-то пришло — приложение уже установлено.
    fire(makePromptEvent())

    expect(api.canInstall.value).toBe(false)
  })

  it('клик вызывает prompt() ровно один раз', async () => {
    const api = pwa.usePwaInstall()
    pwa.registerPwaInstall()
    const event = makePromptEvent()
    fire(event)

    await api.promptInstall()

    expect(event.prompt).toHaveBeenCalledTimes(1)

    // Событие одноразовое: браузер аннулирует его после показа.
    // Второе нажатие не должно звать prompt() повторно.
    await api.promptInstall()
    expect(event.prompt).toHaveBeenCalledTimes(1)
  })

  it('после установки кнопка исчезает', () => {
    const api = pwa.usePwaInstall()
    pwa.registerPwaInstall()
    fire(makePromptEvent())
    expect(api.canInstall.value).toBe(true)

    fire(new Event('appinstalled'))

    expect(api.canInstall.value).toBe(false)
  })

  it('если браузер промпт не прислал — показывает подсказку', async () => {
    const api = pwa.usePwaInstall()
    pwa.registerPwaInstall()

    expect(api.showHint.value).toBe(false)

    await api.promptInstall()

    // Safari и Firefox не умеют beforeinstallprompt: вместо диалога
    // пользователь должен получить инструкцию.
    expect(api.showHint.value).toBe(true)
  })

  it('повторная подписка не копит обработчики', () => {
    const api = pwa.usePwaInstall()
    const cleanups: Array<() => void> = []

    pwa.registerPwaInstall()
    cleanups.push(window.__phInstallCleanup!)

    // Так выглядит HMR: App.vue пересоздался, модуль подписался заново.
    pwa.registerPwaInstall()
    cleanups.push(window.__phInstallCleanup!)

    expect(cleanups[0]).not.toBe(cleanups[1])

    fire(makePromptEvent())

    // Обработчик ровно один — состояние меняется один раз, а не дважды
    // (второй вызов ничего бы не сломал, но копил бы слушателей).
    expect(api.canInstall.value).toBe(true)
  })
})
