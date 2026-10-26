<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

import { ApiError } from '@/api/errors'
import {
  fetchMealChecks,
  fetchMyMealChecks,
  updateMealCheck,
  updateMyMealCheck,
} from '@/api/trips'
import type { TripMealCheck } from '@/types/trips'
import { formatProductAmount } from '@/types/meals'

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
 * Модалка — как у календаря: затемнение, Escape, клик мимо карточки.
 * Данные грузятся один раз; отметки правятся по месту, ответ бэкенда
 * заменяет список целиком.
 */
const props = defineProps<{
  tripId: string
  /** Личный список участника, который питается отдельно. */
  personal?: boolean
}>()

const emit = defineEmits<{
  /** Пользователь закрыл модалку. */
  close: []
}>()

const title = props.personal ? 'Мой список покупок' : 'Список покупок'

const checks = ref<TripMealCheck[] | null>(null)
const error = ref<string | null>(null)

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
  void load()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
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
