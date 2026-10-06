import { computed, ref } from 'vue'

/**
 * Логика установки PWA: «Установить приложение» в меню и в личном кабинете.
 *
 * Зачем composable, а не код в компоненте: событие `beforeinstallprompt`
 * браузер присылает ОДИН раз при загрузке страницы, задолго до того, как
 * пользователь откроет меню или личный кабинет. Если слушать его внутри
 * компонента, к моменту подписки событие уже улетело и кнопка не появится
 * никогда. Поэтому подписка живёт в модуле, а состояние — общее: его видят
 * и шапка, и личный кабинет.
 *
 * Подписку включает `registerPwaInstall()` — вызывается один раз из App.vue,
 * там же, где `useSwUpdate`.
 */

/**
 * Отложенное событие установки.
 *
 * Лежит на window, а не в переменной модуля, по двум причинам:
 *   - переживает перезагрузку модулей в HMR, как и `__DSH_*`-подобные
 *     вещи в других проектах;
 *   - его видно в DevTools, что упрощает отладку «почему нет кнопки».
 */
function readPrompt(): InstallPromptEvent | null {
  return window.__phInstallPrompt ?? null
}

/**
 * Приложение установлено: null — ещё не проверяли, true — точно установлено.
 *
 * Не `ref(isStandalone())` на этапе импорта, хотя так короче. Проверка
 * standalone — это обращение к `matchMedia`, а он не гарантирован
 * (старые WebView, jsdom в тестах) и его результат зависит от того,
 * насколько окружение готово в момент загрузки модуля. В jsdom, например,
 * медиазапрос `display-mode: standalone` ведёт себя не как в браузере.
 * Проверяем лениво, в момент чтения состояния: к этому моменту страница
 * точно загружена, а ошибка в проверке не роняет импорт всего модуля.
 */
const installed = ref<boolean | null>(null)

/** Приложение запущено как установленное. */
const isInstalled = computed(() => installed.value ?? isStandalone())

/** Есть отложенный промпт — можно показать кнопку, которая сразу откроет диалог. */
const canPrompt = ref(readPrompt() !== null)

/** Нужна инструкция по установке: Safari и Firefox своего диалога не показывают. */
const showHint = ref(false)

/**
 * Приложение уже установлено?
 *
 * Три случая: запущено в режиме standalone (Android, десктопный Chrome),
 * открыто из иконки на iOS (navigator.standalone) или событие appinstalled
 * уже приходило в этой сессии — последний случай отслеживает вызывающий
 * код через отдельный ref.
 *
 * Проверка `matchMedia` на существование обязательна: `matchMedia` нет
 * в старых WebView и в jsdom. Исключение отсюда уронило бы всю проверку
 * состояния, а через неё — и кнопку установки, и блок в личном кабинете.
 */
function isStandalone(): boolean {
  if (typeof window === 'undefined') return false

  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean })
    .standalone
  if (iosStandalone === true) return true

  if (typeof window.matchMedia !== 'function') return false

  return window.matchMedia('(display-mode: standalone)').matches
}

/** Можно ли предложить установку. */
const canInstall = computed(() => !isInstalled.value)

/** Кнопка должна открыть инструкцию, а не диалог браузера. */
const needsHint = computed(() => !isInstalled.value && !canPrompt.value)

/**
 * Открыть диалог установки или показать инструкцию.
 *
 * `prompt()` можно вызвать только один раз для каждого события — после
 * показа браузер аннулирует его. Поэтому ссылку сразу затираем: повторное
 * нажатие покажет инструкцию, а не упадёт с ошибкой.
 */
async function promptInstall(): Promise<void> {
  const deferred = readPrompt()
  if (!deferred) {
    showHint.value = true
    return
  }

  window.__phInstallPrompt = undefined
  canPrompt.value = false

  try {
    await deferred.prompt()
    await deferred.userChoice
  } catch {
    // Браузер может отказать, если вызвать prompt() не из жеста
    // пользователя. Падать не нужно — просто показали инструкцию.
    showHint.value = true
  }
}

/**
 * Включить отслеживание установки. Вызывать один раз за жизнь приложения.
 *
 * Возвращает состояние — тем же вызовом пользуются компоненты.
 */
export function usePwaInstall() {
  return { canInstall, needsHint, showHint, promptInstall }
}

/**
 * Подписаться на события установки. Отдельная функция, а не тело
 * composable: подписка не должна дублироваться при каждом вызове
 * `usePwaInstall()` из компонента.
 *
 * Повторный вызов безопасен: прошлые обработчики снимаются. Это не
 * теоретическая осторожность — в dev App.vue пересоздаётся при HMR,
 * модуль при этом новый, а `window` тот же, и без снятия мы бы копили
 * слушателей, каждый из которых писал бы в своё (уже мёртвое) состояние.
 * Именно на этом споткнулись тесты.
 */
export function registerPwaInstall(): void {
  // В dev PWA выключена (см. devOptions в vite.config.ts) — событий не будет.
  if (import.meta.env.DEV) return
  if (typeof window === 'undefined') return

  window.__phInstallCleanup?.()

  const onBeforeInstall = (event: Event) => {
    // Браузер готов показать свой мини-баннер установки. Отменяем его:
    // показывать установку в углу экрана без спроса — плохая идея,
    // решение об установке принимает пользователь.
    event.preventDefault()
    window.__phInstallPrompt = event as InstallPromptEvent
    canPrompt.value = true
  }

  const onInstalled = () => {
    installed.value = true
    canPrompt.value = false
    window.__phInstallPrompt = undefined
  }

  window.addEventListener('beforeinstallprompt', onBeforeInstall)
  window.addEventListener('appinstalled', onInstalled)

  window.__phInstallCleanup = () => {
    window.removeEventListener('beforeinstallprompt', onBeforeInstall)
    window.removeEventListener('appinstalled', onInstalled)
    window.__phInstallCleanup = undefined
  }
}
