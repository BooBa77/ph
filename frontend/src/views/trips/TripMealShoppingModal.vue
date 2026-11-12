<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { subscribeTripEvents } from '@/api/events'
import type { TripEvent } from '@/api/events'
import { ApiError } from '@/api/errors'
import { createTripExpense } from '@/api/finance'
import {
  fetchMealChecks,
  fetchMyMealChecks,
  updateMealCheck,
  updateMyMealCheck,
} from '@/api/trips'
import { useAuthStore } from '@/stores/auth'
import type { TripMealCheck } from '@/types/trips'
import { formatProductAmount } from '@/types/meals'
import { parseRub } from '@/utils/money'

/**
 * «Список покупок» модалкой.
 *
 * Чек-лист — живая проекция раскладки: строки и «надо» считает бэкенд,
 * отметки «куплено»/«домашнее» и фактически купленное живут отдельно
 * и переживают правку плана. Здесь только экран.
 *
 * **Загрузка при открытии.** Раскладка грузится всегда, а чек-лист нужен
 * нечасто — лишний запрос на каждое открытие вкладки ни к чему. Поэтому
 * компонент монтируется по кнопке и грузит данные сам: стоимости открытия
 * у него нет, если его не открыли. Заодно его состояние не живёт в
 * «Питании» и не сбрасывается при правках раскладки.
 *
 * **Списков два.** `personal` переключает общий список завхоза на личный
 * участника: строки (и отметки) разные, экран один — две копии модалки
 * разошлись бы разметкой и поведением.
 *
 * **«Чек» (12.11.2026).** Заказчик: «Сразу добавить кнопку Чек в Походы →
 * Питание → Список общих продуктов: сумма и комментарий, пустой „на
 * продукты“, делится на всех питающихся с общего». Чек — не отдельная
 * сущность, а тот же расход с `split = 'commonEaters'`: так он сразу виден
 * в таблице движения денег и в балансе, и второй кассы не появляется.
 * Кого именно делить, решает **сервер** (`eatsSeparately`), а не экран:
 * список питающихся с общего приходит сюда только числом, для подписи.
 *
 * **Живой список (12.11.2026).** Заказчик: «Две группы закупщиков могут
 * работать параллельно в соседних супермаркетах и хорошо бы при прокликивании
 * закупленных продуктов коллеги были в курсе или если внезапно повар что-то
 * вспомнил и добавил в чек-лист». Пока модалка открыта, она подписана на
 * `/meals/events`: чужая отметка или правка раскладки перечитывает строки,
 * своё действие пропускается — ответ на `PATCH` уже заменил список.
 *
 * Модалка — как у календаря: затемнение, Escape, клик мимо карточки.
 * Данные грузятся один раз; отметки правятся по месту, ответ бэкенда
 * заменяет список целиком.
 */
const props = defineProps<{
  tripId: string
  /** Личный список участника, который питается отдельно. */
  personal?: boolean
  /**
   * Сколько человек едят с общего. Ноль — чек делить не на кого, кнопки нет.
   * Считает «Питание» из состава (`plan.eaters.total` — без отдельно
   * питающихся), а доли всё равно раскладывает сервер.
   */
  commonEaters?: number
}>()

const emit = defineEmits<{
  /** Пользователь закрыл модалку. */
  close: []
}>()

const title = props.personal ? 'Мой список покупок' : 'Список покупок'

const checks = ref<TripMealCheck[] | null>(null)
const error = ref<string | null>(null)

// ───────────────────────────── чек ─────────────────────────────

const checkOpen = ref(false)
const checkAmount = ref('')
const checkComment = ref('')
const checkSaving = ref(false)
const checkError = ref<string | null>(null)
const checkSaved = ref(false)

/** Чек есть только у общего списка и только если есть кого делить. */
const canWriteCheck = computed(
  () => props.personal !== true && (props.commonEaters ?? 0) > 0,
)

function openCheck(): void {
  checkOpen.value = true
  checkError.value = null
  checkSaved.value = false
}

async function saveCheck(): Promise<void> {
  if (checkSaving.value) return

  checkError.value = null

  const amount = parseRub(checkAmount.value)
  if (amount === null) {
    checkError.value = 'Укажи сумму чека'
    return
  }
  if (amount === undefined) {
    checkError.value = 'Сумма — целое число рублей, больше нуля'
    return
  }

  checkSaving.value = true

  try {
    const comment = checkComment.value.trim()

    await createTripExpense(props.tripId, {
      amountRub: amount,
      split: 'commonEaters',
      // Пустой комментарий сервер запишет как «на продукты» — это и есть
      // решение заказчика, а не догадка экрана.
      ...(comment === '' ? {} : { description: comment }),
    })

    checkAmount.value = ''
    checkComment.value = ''
    checkOpen.value = false
    checkSaved.value = true
  } catch (problem) {
    checkError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось записать чек'
  } finally {
    checkSaving.value = false
  }
}

// ───────────────────────────── отметки ─────────────────────────────

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof ApiError ? cause.message : fallback
}

async function load(): Promise<void> {
  try {
    checks.value = props.personal
      ? await fetchMyMealChecks(props.tripId)
      : await fetchMealChecks(props.tripId)
  } catch (problem) {
    error.value = messageOf(problem, 'Не удалось загрузить список покупок')
  }
}

// ───────────────────────────── живые обновления (SSE) ─────────────────────────────

/**
 * Две группы закупщиков в соседних магазинах (12.11.2026). Отметка
 * «куплено», введённое количество и строка, которую завхоз добавил
 * в раскладку, приезжают коллегам без перезахода в модалку.
 *
 * Поток открыт, пока модалка на экране: за её пределами список никто
 * не смотрит, а лишнее соединение на телефоне стоит батареи. `scope`
 * отсекает чужие вкладки, `actorId` — своё действие: ответ на `PATCH`
 * уже заменил список, второй запрос только что сделанного не нужен.
 */
const LIVE_REFRESH_DELAY = 300

const auth = useAuthStore()
let stopLiveEvents: (() => void) | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null

function onLiveEvent(event: TripEvent): void {
  if (event.scope !== 'meals') return
  if (event.actorId === (auth.user?.id ?? '')) return

  if (refreshTimer !== null) return

  refreshTimer = setTimeout(() => {
    refreshTimer = null
    void load()
  }, LIVE_REFRESH_DELAY)
}

async function patchCheck(
  check: TripMealCheck,
  patch: { isBought?: boolean; isHome?: boolean; boughtAmount?: number | null },
): Promise<void> {
  error.value = null

  try {
    checks.value = props.personal
      ? await updateMyMealCheck(props.tripId, check.productId, patch)
      : await updateMealCheck(props.tripId, check.productId, patch)
  } catch (problem) {
    error.value = messageOf(problem, 'Не удалось сохранить отметку')
  }
}

/** Отметки — любому участнику, права правки раскладки тут не нужны. */
function toggleCheck(check: TripMealCheck, field: 'isBought' | 'isHome'): void {
  void patchCheck(check, { [field]: !check[field] })
}

function setCheckAmount(check: TripMealCheck, event: Event): void {
  const raw = (event.target as HTMLInputElement).value.trim()
  const amount = raw === '' ? null : Number(raw)
  if (amount !== null && (!Number.isInteger(amount) || amount < 0)) return

  void patchCheck(check, { boughtAmount: amount })
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  stopLiveEvents = subscribeTripEvents(props.tripId, onLiveEvent, 'meals')
  void load()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)

  stopLiveEvents?.()
  stopLiveEvents = null

  if (refreshTimer !== null) clearTimeout(refreshTimer)
  refreshTimer = null
})
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="shopping-title"
    data-test="checklist"
    @click.self="emit('close')"
  >
    <div
      class="flex max-h-[85vh] w-full max-w-lg flex-col gap-3 rounded-2xl bg-surface p-4 shadow-xl"
    >
      <div class="flex items-baseline justify-between gap-2">
        <h2 id="shopping-title" class="text-lg font-semibold text-text">{{ title }}</h2>

        <button
          type="button"
          class="cursor-pointer text-xs text-muted underline transition-colors hover:text-text"
          data-test="checklist-close"
          @click="emit('close')"
        >
          Закрыть
        </button>
      </div>

      <p v-if="error" class="text-sm text-red-600" data-test="checklist-error">{{ error }}</p>

      <!--
        «Чек за продукты» — одна кнопка вместо блока с объяснением
        (заказчик 12.11.2026). Чек записывают, когда вернулись из магазина,
        и лишний абзац над списком только отодвигал список.
      -->
      <div
        v-if="!personal"
        class="flex flex-col gap-2"
        data-test="check-block"
      >
        <button
          v-if="!checkOpen"
          type="button"
          class="cursor-pointer self-start rounded-lg border border-primary bg-primary px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!canWriteCheck"
          data-test="check-open"
          @click="openCheck"
        >
          Чек за продукты
        </button>

        <p v-if="!canWriteCheck" class="text-xs text-muted" data-test="check-unavailable">
          Все питаются отдельно — делить чек не на кого.
        </p>

        <form
          v-else-if="checkOpen"
          class="flex flex-col gap-2"
          data-test="check-form"
          @submit.prevent="saveCheck"
        >
          <div class="grid gap-2 sm:grid-cols-[8rem_1fr]">
            <label class="flex flex-col gap-1 text-xs text-muted">
              Сумма, ₽
              <input
                v-model="checkAmount"
                type="number"
                min="1"
                step="1"
                inputmode="numeric"
                placeholder="3500"
                class="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-base text-text focus:border-primary focus:outline-none"
                data-test="check-sum"
              />
            </label>

            <label class="flex flex-col gap-1 text-xs text-muted">
              Комментарий
              <input
                v-model="checkComment"
                type="text"
                maxlength="200"
                placeholder="Пусто — запишем «на продукты»"
                class="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-base text-text focus:border-primary focus:outline-none"
                data-test="check-comment"
              />
            </label>
          </div>

          <p class="text-xs text-muted" data-test="check-split-hint">
            Делится на всех, кто ест с общего ({{ commonEaters }} чел.) — доли
            раскладывает сервер.
          </p>

          <p v-if="checkError" class="text-sm text-red-600" data-test="check-error">
            {{ checkError }}
          </p>

          <div class="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              class="cursor-pointer rounded-lg border border-primary bg-primary px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              :disabled="checkSaving"
              data-test="check-save"
            >
              {{ checkSaving ? 'Записываем…' : 'Записать чек' }}
            </button>

            <button
              type="button"
              class="cursor-pointer rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-text transition-colors hover:border-primary"
              :disabled="checkSaving"
              data-test="check-cancel"
              @click="checkOpen = false"
            >
              Отмена
            </button>
          </div>
        </form>

        <p v-if="checkSaved" class="text-xs text-emerald-700" data-test="check-saved">
          Расход записан в «Бухгалтерию».
        </p>
      </div>

      <div class="flex min-h-0 flex-col gap-2 overflow-y-auto">
        <p v-if="checks === null && !error" class="text-sm text-muted" data-test="checklist-loading">
          Загружаем список покупок…
        </p>

        <p
          v-else-if="checks !== null && checks.length === 0"
          class="text-sm text-muted"
          data-test="checklist-empty"
        >
          В раскладке пока нет продуктов.
        </p>

        <ul v-if="checks !== null && checks.length > 0" class="flex flex-col gap-2">
          <!--
            Строка списка: «Гречка 200 г [---] взяли [✓] куплено [ ] из дома».
            Сначала что нужно и сколько взяли, потом отметки: куплено —
            купили в магазине, из дома — своё, покупать не надо.
          -->
          <li
            v-for="check in checks"
            :key="check.productId"
            class="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-border bg-surface p-2 text-sm"
            :class="check.isOrphaned ? 'text-muted' : 'text-text'"
            data-test="check-row"
          >
            <span class="font-medium">{{ check.name }}</span>
            <span class="text-xs text-muted">
              {{ formatProductAmount(check.needAmount, check.unit) }}
            </span>
            <span v-if="check.isOrphaned" class="text-xs text-muted">нет в плане</span>

            <label class="flex items-center gap-1 text-xs text-muted">
              <input
                type="number"
                min="0"
                step="1"
                :value="check.boughtAmount ?? ''"
                placeholder="—"
                class="w-16 rounded-lg border border-border bg-field px-2 py-1 text-xs text-text focus:border-primary focus:outline-none"
                data-test="check-amount"
                @change="setCheckAmount(check, $event)"
              />
              взяли
            </label>

            <label class="flex items-center gap-1 text-xs text-muted">
              <input
                type="checkbox"
                :checked="check.isBought"
                class="h-4 w-4 cursor-pointer accent-[var(--theme-primary)]"
                data-test="check-bought"
                @change="toggleCheck(check, 'isBought')"
              />
              куплено
            </label>

            <label class="flex items-center gap-1 text-xs text-muted">
              <input
                type="checkbox"
                :checked="check.isHome"
                class="h-4 w-4 cursor-pointer accent-[var(--theme-primary)]"
                data-test="check-home"
                @change="toggleCheck(check, 'isHome')"
              />
              из дома
            </label>

            <span v-if="check.boughtByName" class="text-xs text-muted">
              купил(а): {{ check.boughtByName }}
            </span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
