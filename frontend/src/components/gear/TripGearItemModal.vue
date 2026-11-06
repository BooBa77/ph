<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'

import { TRIP_GEAR_STATUS_LABELS } from '@/types/gear'
import type {
  TripGearItem,
  TripGearSectionScope,
  TripGearStatus,
} from '@/types/gear'
import { gearAttributeValueWords } from '@/utils/gearAttributes'
import { formatWeight } from '@/utils/gearWeight'

/**
 * Карточка вещи в снаряжении похода (06.11.2026).
 *
 * Заказчик: «В пилюле отображение полей выбора раздела и выбор
 * „Берём/не берём“ это лишнее, особенно в мобилке. Предлагаю модалку,
 * в которой отображаются все характеристики объекта и эти два поля.
 * А статусы „Берём/не берём/предложено“ отображать оформлением».
 *
 * **Почему карточка, а не поля в пилюле.** Пилюля — это строка списка:
 * название, вес и владелец. Два `select` в каждой строке превращали
 * «Берём» в форму на десяток полей, а на телефоне ещё и делили ширину
 * 390 px на три части. В карточке те же два выбора стоят полноширинными,
 * рядом с характеристиками и заметкой — то есть там, где человек и так
 * смотрит на вещь.
 *
 * **Карточка одна на всё.** Её открывает пилюля «Берём», пилюля рюкзака
 * в «Распределении» и пилюля секции «Ночёвок» (с 06.11.2026 — через
 * `TripGearItemCard`); `scope` решает только одно: какой раздел показывать —
 * общественный или личный. Статус живёт у вещи похода, а не у секции.
 * Во «Взял» вещей похода больше нет (там личное), поэтому личное поле
 * раздела осталось для собственных разделов человека.
 *
 * **Права не решает компонент.** `canDecide` (статус), `canAssign` (несущий),
 * `canPlace` (раздел) и `canRemove` (крестик) приходят сверху: их считает
 * сервер, а экран только не рисует то, что всё равно ответит 403.
 *
 * **«Несёт» — выбор, а не подпись** (06.11.2026). Заказчик: «раз уж вставил
 * „Несёт Трегубов Сергей“, то давай сразу это будет поле выбора несущего».
 * Список — только идущие: сервер отбивает «пока не решил» и отказавшегося.
 * Во «Взял» несущий остаётся строкой: вещь там уже в чьём-то рюкзаке,
 * и менять это место — дело «Берём» и «Распределения».
 *
 * **Данные не копятся здесь.** Никакого черновика: выбор сразу уходит
 * наверх, родитель делает `PATCH`, а карточка показывает обновлённую вещь
 * по `item`. Поэтому после ошибки сервера на экране остаётся правда,
 * а не выбранное значение.
 */
const props = withDefaults(
  defineProps<{
    item: TripGearItem
    /** Большая секция, из которой открыли: `shared` — «Берём», `personal` — «Взял». */
    scope: TripGearSectionScope
    /** Разделы этой секции плоским списком с отступами: «— Пешая часть». */
    sectionChoices?: readonly { id: string; label: string }[]
    /** Владелец вещи словами: имя приходит из состава похода. */
    ownerName: string
    /** Кто несёт. `null` — ещё не распределена. */
    assigneeName?: string | null
    /** Кого можно выбрать несущим: только идущие, как на сервере. */
    assigneeChoices?: readonly { userId: string; label: string }[]
    /** Менять несущего: любой участник, но только в «Берём» (06.11.2026). */
    canAssign?: boolean
    /** Менять «предложено / берём / не берём». */
    canDecide?: boolean
    /** Менять раздел — путь переноса для телефона. */
    canPlace?: boolean
    /** Убрать вещь из похода: своя вещь или право вкладки. */
    canRemove?: boolean
    /** По вещи идёт запрос: поля блокируются до ответа. */
    busy?: boolean
    /**
     * Текст ошибки сервера (06.11.2026). Карточку открывают не только
     * «Берём» и «Распределение», но и пилюли «Ночёвок»: там у каждой секции
     * своя строка ошибок, и общая на всю вкладку не сказала бы, какая вещь
     * не сохранилась.
     */
    errorText?: string | null
  }>(),
  {
    sectionChoices: () => [],
    assigneeName: null,
    assigneeChoices: () => [],
    canAssign: false,
    canDecide: false,
    canPlace: false,
    canRemove: false,
    busy: false,
    errorText: null,
  },
)

const emit = defineEmits<{
  status: [status: TripGearStatus]
  /** `null` — освободить вещь: «не распределено». */
  assignee: [userId: string | null]
  /** `null` — вернуть вещь в корень большой секции. */
  section: [sectionId: string | null]
  remove: []
  close: []
}>()

/** Порядок кнопок — как в жизни: сначала «предложено», потом решение. */
const STATUSES: readonly TripGearStatus[] = ['proposed', 'approved', 'declined']

/** Раздел этой большой секции: у «Берём» и «Взял» это разные ссылки. */
const currentSectionId = computed(() =>
  props.scope === 'shared' ? props.item.sharedSectionId : props.item.personalSectionId,
)

/**
 * Характеристики без пустых значений: «Модель: » читалось бы как поломка.
 * Подпись собирает `gearAttributeValueWords` — тем же кодом, что каталог.
 */
const characteristics = computed(() =>
  props.item.attributes
    .map((attribute) => ({
      code: attribute.code,
      name: attribute.name,
      words: gearAttributeValueWords(attribute),
    }))
    .filter((row) => row.words.length > 0),
)

/**
 * Подпись под названием: тип (если название вещи другое) и вес.
 *
 * Вес здесь в килограммах — это карточка, а не строка списка: «2,6 кг»
 * читается лучше, чем «2600 гр.», и совпадает с каталогом.
 */
const typeLine = computed(() => {
  const parts: string[] = []

  if (props.item.typeName !== props.item.title) parts.push(props.item.typeName)
  if (props.item.weightGrams !== null) parts.push(formatWeight(props.item.weightGrams))

  return parts.join(' · ')
})

const statusWords = computed(() => TRIP_GEAR_STATUS_LABELS[props.item.status])

/**
 * Поле «Раздел» — только если есть из чего выбирать. В новой секции без
 * разделов оно состояло бы из одного «Без раздела»: поле, которое нечего
 * заполнять.
 */
const sectionFieldVisible = computed(
  () => props.canPlace && props.sectionChoices.length > 0,
)

/**
 * Поле «Несёт» — выпадающий список, а не строка (06.11.2026).
 *
 * Заказчик: «раз уж вставил „Несёт Трегубов Сергей“, то давай сразу это
 * будет поле выбора несущего». Список — только идущие: сервер отбивает
 * назначение «пока не решил» и отказавшемуся, чтобы вещь не спряталась
 * с экрана в чужом статусе. Пустых вариантов не бывает: пока никто не идёт,
 * поле не рисуем — `select` из одного «не распределено» ничего не выбирает.
 */
const assigneeFieldVisible = computed(
  () => props.canAssign && props.assigneeChoices.length > 0,
)

function changeStatus(status: TripGearStatus): void {
  if (props.busy || status === props.item.status) return

  emit('status', status)
}

function changeAssignee(event: Event): void {
  const value = (event.target as HTMLSelectElement).value

  emit('assignee', value === '' ? null : value)
}

function changeSection(event: Event): void {
  const value = (event.target as HTMLSelectElement).value

  emit('section', value === '' ? null : value)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="gear-item-title"
    data-test="gear-item-dialog"
    @click.self="emit('close')"
  >
    <div class="flex w-full max-w-lg flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <div class="flex items-start justify-between gap-3">
        <div class="flex min-w-0 flex-col gap-1">
          <h3
            id="gear-item-title"
            class="text-base font-medium text-text"
            data-test="gear-item-title"
          >
            {{ item.title }}
          </h3>
          <p v-if="typeLine" class="text-xs text-muted" data-test="gear-item-type-line">
            {{ typeLine }}
          </p>
        </div>

        <button
          type="button"
          class="shrink-0 cursor-pointer rounded-xl border border-border px-2 py-1 text-xs text-muted transition-colors hover:text-text"
          aria-label="Закрыть"
          data-test="gear-item-close"
          @click="emit('close')"
        >
          ✕
        </button>
      </div>

      <dl class="grid gap-x-3 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt class="text-muted">Владелец</dt>
        <dd data-test="gear-item-owner">{{ ownerName }}</dd>

        <!--
          Без права менять несущего «Несёт» остаётся строкой: в «Взял»
          вещь уже в чьём-то рюкзаке, и это факт, а не поле.
        -->
        <template v-if="!assigneeFieldVisible">
          <dt class="text-muted">Несёт</dt>
          <dd data-test="gear-item-assignee-words">{{ assigneeName ?? 'не распределено' }}</dd>
        </template>
      </dl>

      <!--
        Поле несущего (06.11.2026): несущий — это выбор, а не подпись.
        Список только из идущих — правило сервера, здесь оно просто
        не предлагает заведомо запрещённое.
      -->
      <label
        v-if="assigneeFieldVisible"
        class="flex flex-col gap-1 text-xs text-muted"
      >
        Несёт
        <select
          :value="item.assignedUserId ?? ''"
          :disabled="busy"
          class="w-full cursor-pointer rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none disabled:opacity-50"
          data-test="gear-item-assignee"
          @change="changeAssignee"
        >
          <option value="">Не распределено</option>
          <option v-for="person in assigneeChoices" :key="person.userId" :value="person.userId">
            {{ person.label }}
          </option>
        </select>
      </label>

      <!--
        «Берём / не берём» — в карточке, а не в пилюле. Участник без права
        вкладки видит статус словами: решает не он, но знать ему нужно.
      -->
      <div
        v-if="canDecide"
        class="flex flex-col gap-1"
        data-test="gear-item-status-field"
      >
        <span class="text-xs text-muted">Берём?</span>

        <div class="flex flex-wrap gap-1" role="group" aria-label="Статус вещи">
          <button
            v-for="status in STATUSES"
            :key="status"
            type="button"
            class="cursor-pointer rounded-xl border px-3 py-1.5 text-sm transition-colors disabled:opacity-50"
            :class="
              item.status === status
                ? 'border-primary bg-primary text-white'
                : 'border-border bg-white text-muted hover:border-primary hover:text-text'
            "
            :aria-pressed="item.status === status"
            :disabled="busy"
            :data-test="`gear-item-status-${status}`"
            @click="changeStatus(status)"
          >
            {{ TRIP_GEAR_STATUS_LABELS[status] }}
          </button>
        </div>
      </div>

      <p v-else class="text-sm text-text" data-test="gear-item-status-words">
        Статус: {{ statusWords }}
      </p>

      <label
        v-if="sectionFieldVisible"
        class="flex flex-col gap-1 text-xs text-muted"
      >
        Раздел
        <select
          :value="currentSectionId ?? ''"
          :disabled="busy"
          class="w-full cursor-pointer rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none disabled:opacity-50"
          data-test="gear-item-section"
          @change="changeSection"
        >
          <option value="">Без раздела</option>
          <option v-for="choice in sectionChoices" :key="choice.id" :value="choice.id">
            {{ choice.label }}
          </option>
        </select>
      </label>

      <div
        v-if="characteristics.length > 0"
        class="rounded-xl border border-border bg-white p-3"
        data-test="gear-item-characteristics"
      >
        <h4 class="mb-1 text-xs font-medium text-muted">Характеристики</h4>

        <!--
          Характеристики — в одну строку и на телефоне: подпись и значение
          умещаются рядом, а колонка значений переносится по словам.
          Заказчик: «визуально характеристики на мобиле помещаются
          в одну строку. Нет?»
        -->
        <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <template v-for="row in characteristics" :key="row.code">
            <dt class="text-muted">{{ row.name }}</dt>
            <dd class="min-w-0 break-words">{{ row.words }}</dd>
          </template>
        </dl>
      </div>

      <div
        v-if="item.note"
        class="rounded-xl border border-border bg-white p-3"
        data-test="gear-item-note"
      >
        <h4 class="mb-1 text-xs font-medium text-muted">Заметка</h4>
        <p class="text-sm text-text">{{ item.note }}</p>
      </div>

      <p
        v-if="errorText"
        class="text-sm text-red-600"
        data-test="gear-item-error"
      >
        {{ errorText }}
      </p>

      <div class="flex flex-wrap items-center gap-2">
        <button
          v-if="canRemove"
          type="button"
          class="cursor-pointer rounded-xl border border-red-300 bg-white px-3 py-1.5 text-sm text-red-600 transition-colors hover:border-red-500 disabled:opacity-50"
          :disabled="busy"
          data-test="gear-item-remove"
          @click="emit('remove')"
        >
          Убрать из похода
        </button>

        <button
          type="button"
          class="ml-auto cursor-pointer rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-text transition-colors hover:border-primary"
          :disabled="busy"
          data-test="gear-item-done"
          @click="emit('close')"
        >
          Готово
        </button>
      </div>
    </div>
  </div>
</template>
