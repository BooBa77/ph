<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'

import AppHeader from '@/components/layout/AppHeader.vue'
import MobileMenu from '@/components/layout/MobileMenu.vue'
import SeasonDecor from '@/components/layout/SeasonDecor.vue'
import SiteSidebar from '@/components/layout/SiteSidebar.vue'
import OfflineBanner from '@/components/offline/OfflineBanner.vue'
import InstallHintDialog from '@/components/ui/InstallHintDialog.vue'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { useOfflineStore } from '@/stores/offline'
import { flushDiaryOutboxes } from '@/offline/diaryOutbox'
import { flushPresenceOutboxes } from '@/offline/presenceOutbox'
import { useSwUpdate } from '@/composables/useSwUpdate'
import { useTheme } from '@/composables/useTheme'
import { useAuthRedirect } from '@/composables/useAuthRedirect'
import { registerPwaInstall } from '@/composables/usePwaInstall'

const route = useRoute()
const appStore = useAppStore()
const auth = useAuthStore()
const offline = useOfflineStore()
const { updatePending, applyUpdate } = useSwUpdate()

/**
 * Первый заход после входа: узнать у сервера, какие походы идут сейчас.
 *
 * Стор уже прочитал сохранённый список из IndexedDB, так что офлайн-переход
 * работает и без этого запроса. Запрос нужен, чтобы список не отставал:
 * поход, начавшийся вчера, должен стать доступен и на устройстве.
 */
onMounted(async () => {
  void offline.refreshCurrentTrips()

  // Очередь дневника отправляем только с живой сессией: на старте токена
  // ещё нет (его берёт bootstrap в guard), и первый заход получил бы 401.
  // `resumeSession` не делает лишнего, если токен уже есть.
  try {
    await auth.resumeSession()
  } catch {
    // Нет связи — очередь подождёт следующего `online`.
  }

  void flushDiaryOutboxes()
  void flushPresenceOutboxes()
})

/**
 * Дневник, написанный без связи, уходит при её возврате.
 *
 * Очередь живёт на уровне приложения, а не вкладки: человек мог написать
 * в поле и закрыть приложение — запись должна уехать, когда телефон
 * поймает сеть, независимо от того, открыт ли дневник. Ошибки глотает
 * сама очередь: отказ сервера означает «попробуем в следующий раз»,
 * а не потерянную запись.
 */
let retryTimer: number | null = null

function onOnline(): void {
  void flushDiaryOutboxes()
  void flushPresenceOutboxes()

  // Вторая попытка через несколько секунд: вместе со связью приложение
  // поднимает сессию (`resumeSession`), и первый заход мог прийтись
  // на ещё пустой токен. Успешная отправка второй раз ничего не меняет —
  // очередь уже пуста.
  if (retryTimer !== null) window.clearTimeout(retryTimer)
  retryTimer = window.setTimeout(() => {
    retryTimer = null
    void flushDiaryOutboxes()
    void flushPresenceOutboxes()
  }, 5000)
}

window.addEventListener('online', onOnline)

onUnmounted(() => {
  window.removeEventListener('online', onOnline)
  if (retryTimer !== null) window.clearTimeout(retryTimer)
})

// Инициализация темы. Вызывается ОДИН РАЗ за жизнь приложения.
// Ставит data-theme на <html> и следит за изменениями.
useTheme()

/**
 * Уход на страницу входа, как только пользователь перестал быть
 * авторизованным. Вызывается здесь один раз: следить надо за всем
 * приложением, а не за одной страницей.
 */
useAuthRedirect()

/**
 * Подписка на события установки PWA.
 *
 * Вызывается здесь, а не в компоненте: браузер присылает
 * beforeinstallprompt один раз при загрузке страницы, задолго до того,
 * как пользователь откроет меню или личный кабинет. Подпишись мы внутри
 * компонента — событие к тому моменту уже улетело, и кнопка установки
 * не появилась бы никогда.
 */
registerPwaInstall()

/**
 * Шапку не показываем на страницах с meta.hideHeader = true.
 * Сейчас это только /auth (страница логина).
 */
const showHeader = computed(() => route.meta.hideHeader !== true)

/**
 * Как только обновление готово И пользователь не занят — применяем.
 * Если busy станет false позже — watcher сработает.
 */
watch(
  [updatePending, () => appStore.isUserBusy],
  ([pending, busy]) => {
    if (pending && !busy) {
      applyUpdate()
    }
  },
  { immediate: true },
)
</script>

<template>
  <!--
    Сезонный декор. Позиция fixed и `z-index: 0`, а содержимое страницы
    лежит выше за счёт `#app { position: relative; z-index: 1 }`
    в main.css. Именно так, а не отрицательным z-index: с `-10` слой
    уходил ПОД непрозрачный фон body, и листья были не видны, хотя
    в DOM жили и координаты у них были правильные.
  -->
  <SeasonDecor />

  <AppHeader v-if="showHeader" />

  <!--
    Полоса офлайна — сразу под шапкой и на всех страницах: без связи человек
    должен видеть, почему исчезли разделы и почему изменения не сохраняются.
  -->
  <OfflineBanner v-if="showHeader" />

  <!--
    Мобильное меню — на уровне приложения, а не внутри шапки: это оверлей
    на весь экран, и жить он должен рядом с шапкой, а не в её разметке.
    Открывается кнопкой из шапки через стор, содержимое (разделы сайта или
    вкладки похода) кладёт страница.
  -->
  <MobileMenu v-if="showHeader" />

  <!--
    Общий каркас страниц: меню слева (на мобиле меню живёт в гамбургере
    шапки, а эта колонка скрыта) и содержимое. Меню одно на всё приложение:
    раньше разделы жили только внутри личного кабинета, и на главной меню
    не было вовсе, а второе меню рядом с первым путало бы.

    Классы каркаса включаются только вместе с шапкой: на странице входа
    (`hideHeader`) остаётся голая обёртка, а сама форма центрируется своими
    стилями. RouterView один: два экземпляра в разных ветках — лишний риск
    разъехаться.
  -->
  <div
    :class="
      showHeader
        ? 'mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6 md:flex-row md:items-start md:gap-8 md:py-8'
        : ''
    "
  >
    <SiteSidebar v-if="showHeader" class="md:w-56 md:shrink-0" />

    <div class="min-w-0 flex-1">
      <RouterView />
    </div>
  </div>

  <!--
    Подсказка, как вынести ярлык, — на уровне приложения: кнопка живёт
    в футере главной, а подсказка понадобится и из других мест, когда
    предложение переедет в «Сессии».
  -->
  <InstallHintDialog />
</template>
