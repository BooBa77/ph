/**
 * Событие beforeinstallprompt есть только в браузерах на Chromium,
 * и в стандартной библиотеке DOM его нет. Объявляем сами.
 *
 * Своё имя (`InstallPromptEvent`), а не `BeforeInstallPromptEvent`:
 * у разных версий @types и vite-plugin-pwa тип с таким именем то есть,
 * то нет, а зависеть от его наличия в чужих типах не хочется.
 * Нам нужны ровно два члена — prompt() и userChoice.
 */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

interface Window {
  /** Событие установки PWA, отложенное нами до нажатия кнопки. */
  __phInstallPrompt?: InstallPromptEvent

  /**
   * Снятие обработчиков установки, навешанных прошлым вызовом
   * registerPwaInstall. Лежит на window, а не в модуле: при HMR модуль
   * пересоздаётся, а слушатели на window остаются — и накапливаются.
   */
  __phInstallCleanup?: () => void
}
