<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import { sendConversationMessage } from '@/api/conversations'
import { ApiError } from '@/api/errors'
import { confirmTripCompensation } from '@/api/finance'
import { closeNotification } from '@/api/notifications'
import { useNotificationsStore } from '@/stores/notifications'
import type { AppNotification } from '@/types/notifications'
import { conversationTime } from '@/utils/conversations'
import {
  chatUnreadOf,
  isChatNotification,
  notificationPreview,
  openAlmanacSection,
  plainText,
  previewLine,
  shoppingRoute,
  tripTabLabel,
  tripTabOf,
} from '@/utils/notifications'

/**
 * Карточка уведомления — одна на колонку и мобильную панель (24.11.2026).
 *
 * Карточка раскрывается в текст и кнопки **своего вида** (§14.2): деньги
 * подтверждают, просьба о платеже ведёт в «Бухгалтерию», альманах
 * предлагает «ОК» и переход в гостевую, чаты дают последние сообщения
 * и быстрый ответ. Общая на две поверхности намеренно: правила одной
 * карточки в двух копиях разошлись бы при первой правке — ровно так
 * колонка и мобильная панель однажды уже считали непрочитанное по-разному.
 *
 * **Раскрыта всегда одна карточка.** Это решает родитель (`expandedId`),
 * карточка лишь сообщает о клике: иначе выбор второй карточки оставлял бы
 * первую открытой, а панель 352 px на две раскрытые не рассчитана.
 *
 * **Чего карточка не делает.** Не архивирует деньги: «ОК» для них сервер
 * отвергнет (`400`), а состояние перевода меняет только подтверждение или
 * оплата. Клиента архива здесь нет — экрана архива в этом шаге нет
 * (§10 п.8).
 */
const props = defineProps<{
  notification: AppNotification
  expanded: boolean
  /** Префикс `data-test`: у колонки `rail`, у мобильной панели `mobile-messages`. */
  testPrefix: string
}>()

const emit = defineEmits<{ toggle: [] }>()

const router = useRouter()
const store = useNotificationsStore()

/** Ответ в поле: и «Сообщение отправителю», и быстрый ответ в чат. */
const draft = ref('')
const error = ref<string | null>(null)
const isBusy = ref(false)

const item = computed(() => props.notification)
const isChat = computed(() => isChatNotification(item.value))
const isTransfer = computed(() => item.value.kind === 'money_transfer')
const isPaymentRequest = computed(() => item.value.kind === 'payment_request')
/**
 * Залог — `trip_deposit` (миграция 103 перевела прежний `trip_finance`).
 * Карточка ведёт в «Бухгалтерию» и закрывается «ОК» без архива.
 */
const isTripFinance = computed(() => item.value.kind === 'trip_deposit')
/**
 * Альманах — оба вида (26.11.2026): `almanac_created` появился в части 3,
 * но ведёт себя так же, как `almanac_changed` — «Перейти» в гостевую
 * с раскрытой секцией. Иначе первая же запись альманаха приходила бы
 * карточкой без действий.
 */
const isAlmanac = computed(
  () =>
    item.value.kind === 'almanac_changed' ||
    item.value.kind === 'almanac_created',
)
const isDirectChat = computed(() => item.value.kind === 'direct_chat')
const unread = computed(() => chatUnreadOf(item.value))

/**
 * «Текущий список общих продуктов» — только у закупки (§3.14).
 *
 * Карточка закупки ведёт двумя путями: сразу в модалку закупки и просто
 * в «Питание». Первый — основное действие, поэтому стоит первым.
 */
const isMealsPurchase = computed(() => item.value.kind === 'meals_purchase')

/**
 * Вкладка для остальных видов похода — одна таблица `tripTabOf` (§8).
 *
 * Деньги к действию (`money_transfer`), просьба о платеже, залог, альманах
 * и чаты рисуют свои кнопки выше: у них не просто «перейти на вкладку».
 * Остальные виды (трансфер, палатка, раскладка, участники, роли, расход)
 * получают кнопку с названием вкладки — «Трансфер», «Ночёвки», «Питание»,
 * «Участники», «Бухгалтерия».
 */
const genericTab = computed(() => {
  const kind = item.value.kind

  if (
    kind === 'money_transfer' ||
    kind === 'payment_request' ||
    kind === 'trip_deposit' ||
    kind === 'almanac_created' ||
    kind === 'almanac_changed' ||
    kind === 'direct_chat' ||
    kind === 'trip_chat'
  ) {
    return null
  }

  return tripTabOf(kind)
})

/** Подпись кнопки перехода: «Трансфер», «Ночёвки», «Питание»… */
const genericTabLabel = computed(() =>
  genericTab.value === null ? '' : tripTabLabel(genericTab.value),
)

/**
 * «ОК» есть у всего, что сервер закрывает.
 *
 * Исключения прежние: перевод закрывается только подтверждением (`400`),
 * а у просьбы о платеже действие — «Перейти», кнопка «ОК» там не нужна.
 * Остальные виды, включая все новые, закрываются удалением карточки.
 */
const canMarkOk = computed(
  () => !isTransfer.value && !isPaymentRequest.value,
)

/**
 * Перевод человеку, который уже вышел из похода (25.11.2026).
 *
 * «Бухгалтерия» ушедшему закрыта, но деньги адресованы ему, и только он
 * может сказать «получил». Сервер это разрешает, а карточка объясняет
 * словами, почему кнопка здесь, и что будет без ответа.
 */
const isWithdrawnTransfer = computed(
  () => isTransfer.value && item.value.viewerDeclined === true,
)

/**
 * Анонс под заголовком — только в свёрнутом виде (25.11.2026; отдельное
 * поле `announce` — 26.11.2026, §1.4).
 *
 * Заказчик: превью «дублируется при раскрытии». Поэтому у свёрнутой
 * карточки — `announce`, обрезанный до 75 символов, у раскрытой строки-анонса
 * нет вовсе: у нечата виден полный `body`, у чата — последние 1–3 сообщения.
 * Анонс и содержимое — разные тексты, поэтому обрезка `body` больше
 * не используется.
 */
const announceText = computed(() =>
  props.expanded ? '' : notificationPreview(item.value),
)

/**
 * Текст одного сообщения в раскрытии чата.
 *
 * У чата похода — до 75 символов (§3.20: заказчик уменьшил с 300),
 * у личного диалога остаётся полный текст: §3.21 менять не просил.
 */
function messageText(body: string): string {
  return isDirectChat.value ? plainText(body) : previewLine(body)
}

/**
 * Поле ответа рисуется, только когда есть куда ответить.
 *
 * У «Сообщения отправителю» это диалог перевода. У перевода владельцу
 * виртуального диалога нет вовсе (25.11.2026): писать некому — человека
 * без аккаунта в приложении нет, поэтому и поля нет.
 */
const canReply = computed(
  () =>
    item.value.conversationId !== null &&
    (isChat.value || isTransfer.value),
)

/** Подтверждение возможно, только если сервер дал и поход, и перевод. */
const canConfirm = computed(
  () =>
    isTransfer.value &&
    item.value.tripId !== null &&
    item.value.compensationId !== null,
)

/** Простой текст: пробелы и переводы строк схлопнуты в один. */
function plain(text: string): string {
  return plainText(text)
}

function describe(problem: unknown, fallback: string): string {
  return problem instanceof ApiError ? problem.message : fallback
}

/**
 * «Подтвердить» — та же ручка, что у «Бухгалтерии».
 *
 * Она архивирует карточку с причиной `confirmed` на сервере, поэтому
 * отдельного id действия искать не нужно: ответ на перевод один, и его
 * состояние живёт в компенсации, а не в карточке. После ответа секции
 * перечитываются: карточка исчезает, счётчик уменьшается.
 */
async function confirm(): Promise<void> {
  const { tripId, compensationId } = item.value

  if (!canConfirm.value || tripId === null || compensationId === null) return
  if (isBusy.value) return

  isBusy.value = true
  error.value = null

  try {
    await confirmTripCompensation(tripId, compensationId)
    await store.refresh()
  } catch (problem) {
    error.value = describe(problem, 'Не удалось подтвердить перевод')
  } finally {
    isBusy.value = false
  }
}

/**
 * «OK» — убрать карточку без архива.
 *
 * Так закрываются чаты и альманах: следующее новое сообщение или редакция
 * заведёт карточку заново. Деньгам кнопка не рисуется вовсе.
 */
async function markOk(): Promise<void> {
  if (isBusy.value) return

  isBusy.value = true
  error.value = null

  try {
    await closeNotification(item.value.id)
    await store.refresh()
  } catch (problem) {
    error.value = describe(problem, 'Не удалось закрыть уведомление')
  } finally {
    isBusy.value = false
  }
}

/**
 * Поле ответа — обычное личное сообщение.
 *
 * У денег это «Сообщение отправителю»: уходит в диалог через обычную ручку
 * сообщений и **таймер автосогласия не трогает** — через 72 часа перевод
 * засчитается сам, а реплика «деньги ещё не пришли» останется в переписке.
 * У чатов — быстрый ответ, чтобы не открывать экран.
 */
async function send(): Promise<void> {
  const body = draft.value.trim()
  const conversationId = item.value.conversationId

  if (!body || conversationId === null || isBusy.value) return

  isBusy.value = true
  error.value = null

  try {
    await sendConversationMessage(conversationId, body)
    draft.value = ''
    // Предпросмотр карточки собирает сервер из сообщений: своё сообщение
    // появится в нём только после перечитывания.
    await store.refresh()
  } catch (problem) {
    error.value = describe(problem, 'Не удалось отправить сообщение')
  } finally {
    isBusy.value = false
  }
}

/** «Перейти» у просьбы о платеже — «Бухгалтерия» похода. */
function goFinance(): void {
  if (item.value.tripId === null) return

  void router.push({ path: `/trips/${item.value.tripId}`, query: { tab: 'finance' } })
}

/**
 * Переход на вкладку похода для нового вида (§8).
 *
 * Вкладку выбирает `tripTabOf`, подпись — `tripTabLabel`. Так «Трансфер»,
 * «Ночёвки» и «Питание» не требуют по ветке условий на вид в карточке.
 */
function goTab(): void {
  const tab = genericTab.value
  if (item.value.tripId === null || tab === null) return

  void router.push({ path: `/trips/${item.value.tripId}`, query: { tab } })
}

/** «Текущий список общих продуктов» — «Питание» с открытой модалкой закупки. */
function goShopping(): void {
  if (item.value.tripId === null) return

  void router.push(shoppingRoute(item.value.tripId))
}

/**
 * «Перейти» у альманаха — гостевая похода с раскрытой секцией.
 *
 * Секция «Альманах» сворачиваемая и помнит состояние в `localStorage`
 * (`GuestTripView.vue`); без записи перехода человек попал бы на свёрнутую
 * секцию и не увидел, о чём уведомление.
 */
function goAlmanac(): void {
  if (item.value.tripId === null) return

  openAlmanacSection(item.value.tripId)
  void router.push({ path: `/trips/${item.value.tripId}`, query: { tab: 'guest' } })
}

/** «Открыть чат» у личного сообщения — экран переписки. */
function openDirectChat(): void {
  if (item.value.conversationId === null) return

  void router.push(`/messages/${item.value.conversationId}`)
}
</script>

<template>
  <article
    class="rounded-xl border border-border bg-bg"
    :data-test="`${testPrefix}-card-${item.id}`"
  >
    <button
      type="button"
      class="flex w-full cursor-pointer items-start gap-2 px-2 py-2 text-left"
      :aria-expanded="expanded"
      @click="emit('toggle')"
    >
      <span class="min-w-0 flex-1">
        <span class="flex items-baseline gap-2">
          <!--
            Заголовок карточки всегда жирный (25.11.2026, замечание
            заказчика: «заголовки у всех уведомлений должны быть жирные;
            про залог и требование компенсации не bold»). Прежнее правило
            «жирный только у непрочитанного» работало для чатов, но у денег
            и альманаха непрочитанного не бывает — они выглядели бледно.
            Непрочитанное по-прежнему показывает счётчик, а не вес шрифта.
          -->
          <span
            class="truncate text-sm font-semibold text-text"
            :data-test="`${testPrefix}-title-${item.id}`"
          >
            {{ item.title }}
          </span>
          <span class="ml-auto shrink-0 text-xs text-muted">
            {{ conversationTime(item.updatedAt) }}
          </span>
        </span>

        <!--
          Анонс — только у свёрнутой карточки и только из `announce`.
          У чата это «автор: последнее сообщение», обрезанное до 75
          символов, у денег и альманаха — свой анонс. В раскрытии строки
          нет: там полный текст или сообщения, и дубль был бы именно тем,
          на что жаловался заказчик.
        -->
        <span
          v-if="announceText"
          class="mt-0.5 block text-xs text-muted"
          :data-test="`${testPrefix}-announce-${item.id}`"
        >
          {{ announceText }}
        </span>
      </span>

      <span
        v-if="unread > 0"
        class="shrink-0 rounded-full bg-primary px-1.5 text-xs font-medium text-white"
        :data-test="`${testPrefix}-unread-${item.id}`"
      >
        {{ unread }}
      </span>
    </button>

    <div v-if="expanded" class="flex flex-col gap-2 px-2 pb-2">
      <p
        v-if="error"
        class="text-xs text-red-600"
        :data-test="`${testPrefix}-error`"
      >
        {{ error }}
      </p>

      <!--
        Текст карточки целиком — только у нечатов. У чата вместо текста
        последние сообщения: заголовок уже показывает последнее, повторять
        его абзацем незачем.
      -->
      <p v-if="!isChat" class="text-xs leading-relaxed text-text">
        {{ plain(item.body) }}
      </p>

      <!--
        Перевод ушедшему: «Бухгалтерия» закрыта, подтвердить можно только
        здесь. Вторая половина фразы — про срок автосогласия, чтобы человек
        понимал, что будет, если не ответить.
      -->
      <p
        v-if="isWithdrawnTransfer"
        class="text-xs leading-relaxed text-muted"
        :data-test="`${testPrefix}-declined-hint`"
      >
        Ты не идёшь в этом походе — «Бухгалтерия» тебе закрыта. Подтвердить
        получение можно здесь; без ответа перевод засчитается сам через
        72 часа.
      </p>

      <ol
        v-if="isChat && item.preview.length > 0"
        class="flex flex-col gap-1"
        :data-test="`${testPrefix}-messages-${item.id}`"
      >
        <li
          v-for="message in item.preview"
          :key="message.id"
          class="rounded-lg bg-field px-2 py-1"
        >
          <span class="block text-xs font-medium text-text">
            {{ message.senderName ?? 'Кто-то' }}
          </span>
          <span class="block text-xs leading-relaxed text-text">
            {{ messageText(message.body) }}
          </span>
        </li>
      </ol>

      <!-- Поле ответа: «Сообщение отправителю» у денег, быстрый ответ у чатов. -->
      <div v-if="canReply" class="flex gap-1">
        <input
          v-model="draft"
          type="text"
          class="min-w-0 flex-1 rounded-lg border border-border bg-field px-2 py-1 text-xs text-text outline-none focus:border-primary"
          :placeholder="isTransfer ? 'Сообщение отправителю:' : 'Ответить…'"
          :aria-label="isTransfer ? 'Сообщение отправителю' : 'Быстрый ответ'"
          :data-test="`${testPrefix}-reply-input`"
        />
        <button
          type="button"
          class="cursor-pointer rounded-lg border border-border px-2 py-1 text-xs text-text disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!draft.trim() || isBusy"
          :data-test="`${testPrefix}-reply-send`"
          @click="send()"
        >
          →
        </button>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <button
          v-if="canConfirm"
          type="button"
          class="cursor-pointer rounded-lg bg-primary px-2 py-1 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="isBusy"
          :data-test="`${testPrefix}-confirm`"
          @click="confirm()"
        >
          Подтвердить
        </button>

        <button
          v-if="isPaymentRequest"
          type="button"
          class="cursor-pointer rounded-lg bg-primary px-2 py-1 text-xs font-medium text-white"
          :data-test="`${testPrefix}-go-finance`"
          @click="goFinance()"
        >
          Перейти
        </button>

        <!--
          Общегрупповое уведомление о деньгах похода (25.11.2026): не «ты
          должен», а приглашение разобраться самому. «ОК» закрывает карточку
          без архива — это напоминание, а не долг.
        -->
        <button
          v-if="isTripFinance"
          type="button"
          class="cursor-pointer rounded-lg bg-primary px-2 py-1 text-xs font-medium text-white"
          :data-test="`${testPrefix}-go-finance`"
          @click="goFinance()"
        >
          Перейти в бухгалтерию
        </button>

        <button
          v-if="isAlmanac"
          type="button"
          class="cursor-pointer rounded-lg border border-border px-2 py-1 text-xs text-text"
          :data-test="`${testPrefix}-go-almanac`"
          @click="goAlmanac()"
        >
          Перейти
        </button>

        <!--
          «Текущий список общих продуктов» — основное действие закупки
          (§3.14): сразу в модалку закупки, а не в общий экран «Питания».
        -->
        <button
          v-if="isMealsPurchase"
          type="button"
          class="cursor-pointer rounded-lg bg-primary px-2 py-1 text-xs font-medium text-white"
          :data-test="`${testPrefix}-go-shopping`"
          @click="goShopping()"
        >
          Текущий список общих продуктов
        </button>

        <!--
          Вкладка нового вида: «Трансфер», «Ночёвки», «Питание», «Участники»,
          «Бухгалтерия». Таблица переходов — `tripTabOf` в
          `utils/notifications.ts`, чтобы карточка и тесты не держали свои
          копии названий.
        -->
        <button
          v-if="genericTab !== null"
          type="button"
          class="cursor-pointer rounded-lg border border-border px-2 py-1 text-xs text-text"
          :data-test="`${testPrefix}-go-tab`"
          @click="goTab()"
        >
          {{ genericTabLabel }}
        </button>

        <button
          v-if="canMarkOk"
          type="button"
          class="cursor-pointer rounded-lg border border-border px-2 py-1 text-xs text-text disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="isBusy"
          :data-test="`${testPrefix}-ok`"
          @click="markOk()"
        >
          ОК
        </button>

        <button
          v-if="isDirectChat"
          type="button"
          class="ml-auto cursor-pointer text-xs text-primary underline-offset-2 hover:underline"
          :data-test="`${testPrefix}-open-chat`"
          @click="openDirectChat()"
        >
          Открыть чат
        </button>
      </div>
    </div>
  </article>
</template>
