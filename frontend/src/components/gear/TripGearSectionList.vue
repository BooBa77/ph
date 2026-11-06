<script setup lang="ts">
import { computed, ref } from 'vue'

import type {
  TripGearItem,
  TripGearSection,
  TripGearSectionScope,
} from '@/types/gear'

/**
 * Вложенные разделы «Берём» / «Взял» (05.11.2026).
 *
 * Заказчик: «в секциях „Берём“ и „Взял“ … возможность создавать
 * (редактировать и удалять) разделы, типа „Альпинизм“, „Пешка“, а какие-то
 * даже шаблонами встают, например, „Табор“, если есть ночёвки и/или
 * Готовка». План — `docs/ph/gear-tab.md` §3.
 *
 * **Компонент рекурсивный.** Он рисует разделы одного уровня, а внутри
 * каждого — сам себя. Глубина не ограничена: «Альпинизм» → «Верёвки» —
 * обычный случай. Пилюли вещей приходят слотом: у «Берём» и «Взял» они
 * разные (статус, хозяин, вес), и копировать разметку в компонент значит
 * получить две версии, которые однажды разойдутся.
 *
 * **Что здесь не живёт.** Сами ручки API — у `TripGear.vue`: компонент
 * только показывает дерево и сообщает наверх «создай», «переименуй»,
 * «удали», «перенеси вещь». Так права и ошибки остаются в одном месте.
 *
 * **Удаление не теряет вещи** — это правило сервера: раздел уходит,
 * вещи возвращаются в корень. Компонент не спрашивает подтверждения:
 * терять нечего, а лишний диалог на каждое действие — шум.
 */

const props = withDefaults(
  defineProps<{
    /** Все видимые разделы обеих больших секций — дерево строится из них. */
    sections: TripGearSection[]
    /** Вещи большой секции; какие из них в разделе — решает `scope`. */
    items: TripGearItem[]
    /** Раздел, содержимое которого рисуем. `null` — корень большой секции. */
    parentId: string | null
    scope: TripGearSectionScope
    /** Создавать, переименовывать и удалять разделы. */
    canManage?: boolean
    /** Перетаскивать вещи между разделами. */
    canPlace?: boolean
    /** Кнопка «Добавить снаряжение» внутри раздела. */
    canAdd?: boolean
  }>(),
  { canManage: false, canPlace: false, canAdd: false },
)

const emit = defineEmits<{
  create: [{ parentId: string | null; title: string }]
  rename: [{ section: TripGearSection; title: string }]
  remove: [section: TripGearSection]
  /** Вещь перенесли в раздел `sectionId`; `null` — в корень. */
  move: [sectionId: string | null]
  addTo: [sectionId: string | null]
}>()

/**
 * Пилюля приходит слотом: у «Берём» и «Взял» она разная. Тип объявлен
 * явно — иначе рекурсивный компонент выводил бы его сам из себя.
 */
defineSlots<{
  item: (props: { item: TripGearItem }) => unknown
}>()

/** Поле вещи, в котором лежит её раздел этой большой секции. */
function sectionOf(item: TripGearItem): string | null {
  return props.scope === 'shared'
    ? item.sharedSectionId
    : item.personalSectionId
}

const sectionIds = computed(() => new Set(props.sections.map((section) => section.id)))

/** Разделы этого уровня — по порядку, как их расставил человек. */
const childSections = computed(() =>
  props.sections
    .filter((section) => section.parentId === props.parentId)
    .slice()
    .sort((left, right) => left.sortOrder - right.sortOrder || Number(left.id) - Number(right.id)),
)

/**
 * Вещи этого уровня. В корне — те, чей раздел не найден: раздел могли
 * удалить в другой вкладке, и вещь не должна исчезнуть с экрана.
 */
const containerItems = computed(() =>
  props.items.filter((item) => {
    const sectionId = sectionOf(item)

    // Раздел могли удалить в другой вкладке — вещь не должна исчезнуть.
    if (sectionId !== null && sectionIds.value.has(sectionId)) {
      return sectionId === props.parentId
    }

    return props.parentId === null
  }),
)

/** Есть ли у раздела хоть что-то: свои вещи или подразделы. */
function hasContent(sectionId: string): boolean {
  return (
    props.items.some((item) => sectionOf(item) === sectionId) ||
    props.sections.some((section) => section.parentId === sectionId)
  )
}

// ───────────────────────────── инструменты раздела ─────────────────────────────

/**
 * Инструменты раздела спрятаны за кнопкой в заголовке (06.11.2026).
 *
 * Заказчик: «Инструменты „+ Подраздел / Переименовать / Удалить“ нужно прятать
 * кнопкой в заголовке раздела». Три кнопки под каждым заголовком — это девять
 * строк управления на три раздела, и в свёрнутом виде они видны всегда, хотя
 * нужны раз в жизни. Кнопка «⋯» стоит в самом `<summary>`: раздел остаётся
 * одной строкой, а инструменты раскрываются под ним.
 *
 * Список, а не одно id: инструменты двух разных разделов не обязаны
 * закрывать друг друга — человек может держать открытыми те, с которыми
 * работает.
 */
const toolsOpen = ref<string[]>([])

function isToolsOpen(sectionId: string): boolean {
  return toolsOpen.value.includes(sectionId)
}

function toggleTools(sectionId: string): void {
  toolsOpen.value = isToolsOpen(sectionId)
    ? toolsOpen.value.filter((id) => id !== sectionId)
    : [...toolsOpen.value, sectionId]
}

/** Действие начали — панель инструментов больше не нужна. */
function closeTools(sectionId: string): void {
  toolsOpen.value = toolsOpen.value.filter((id) => id !== sectionId)
}

// ───────────────────────────── создание и переименование ─────────────────────────────

/**
 * Куда добавляем раздел. `undefined` — форма закрыта, `null` — в корень,
 * строка — подраздел этого раздела.
 */
const creatingIn = ref<string | null | undefined>(undefined)
const newTitle = ref('')

function startCreate(parentId: string | null): void {
  creatingIn.value = parentId
  newTitle.value = ''
  if (parentId !== null) closeTools(parentId)
}

function submitCreate(): void {
  const title = newTitle.value.trim()
  if (title.length === 0) return

  emit('create', { parentId: creatingIn.value ?? null, title })
  creatingIn.value = undefined
  newTitle.value = ''
}

function cancelCreate(): void {
  creatingIn.value = undefined
  newTitle.value = ''
}

/** Раздел, который сейчас переименовывают, и черновик названия. */
const editingId = ref<string | null>(null)
const draftTitle = ref('')

function startRename(section: TripGearSection): void {
  editingId.value = section.id
  draftTitle.value = section.title
  closeTools(section.id)
}

function submitRename(section: TripGearSection): void {
  const title = draftTitle.value.trim()
  if (title.length === 0) return

  emit('rename', { section, title })
  editingId.value = null
  draftTitle.value = ''
}

function cancelRename(): void {
  editingId.value = null
  draftTitle.value = ''
}

// ───────────────────────────── перенос вещей ─────────────────────────────

/** Раздел под курсором — подсвечиваем, чтобы было видно, куда упадёт вещь. */
const dragOverId = ref<string | null>(null)

function onDrop(sectionId: string): void {
  dragOverId.value = null
  if (props.canPlace) emit('move', sectionId)
}

function onRootDrop(): void {
  dragOverId.value = null
  // Корневая зона есть только у верхнего уровня: вложенный компонент
  // получает тот же обработчик, но корнем для него служит родительский
  // раздел, и его drop уже поймал обработчик раздела.
  if (props.parentId === null && props.canPlace) emit('move', null)
}
</script>

<template>
  <div class="flex flex-col gap-2" @dragover.prevent @drop.prevent="onRootDrop">
    <!-- Вещи этого уровня: в корне — «без раздела» -->
    <ul v-if="containerItems.length > 0" class="flex flex-wrap gap-1.5">
      <template v-for="item in containerItems" :key="item.id">
        <slot name="item" :item="item" />
      </template>
    </ul>

    <!-- Новый раздел в корне — только у верхнего уровня -->
    <div v-if="parentId === null && canManage" class="flex flex-col gap-1">
      <button
        v-if="creatingIn === undefined"
        type="button"
        class="cursor-pointer self-start rounded-xl border border-dashed border-border bg-white px-3 py-1.5 text-sm text-muted transition-colors hover:border-primary hover:text-text"
        data-test="gear-section-add-root"
        @click="startCreate(null)"
      >
        + Раздел
      </button>

      <form
        v-if="creatingIn === null"
        class="flex flex-wrap items-center gap-1"
        data-test="gear-section-create-form"
        @submit.prevent="submitCreate"
      >
        <input
          v-model="newTitle"
          type="text"
          maxlength="60"
          class="min-w-0 grow rounded-lg border border-border bg-field px-2 py-1 text-base text-text focus:border-primary focus:outline-none"
          placeholder="Название раздела: «Альпинизм»"
          aria-label="Название нового раздела"
          data-test="gear-section-create-title"
        >
        <button
          type="submit"
          class="cursor-pointer rounded-lg border border-primary bg-primary px-2 py-1 text-sm text-white disabled:opacity-40"
          :disabled="newTitle.trim().length === 0"
          data-test="gear-section-create-submit"
        >
          Создать
        </button>
        <button
          type="button"
          class="cursor-pointer rounded-lg border border-border bg-white px-2 py-1 text-sm text-muted"
          @click="cancelCreate"
        >
          Отмена
        </button>
      </form>
    </div>

    <!-- Разделы этого уровня -->
    <div
      v-for="section in childSections"
      :key="section.id"
      class="rounded-xl border p-2 transition-colors"
      :class="dragOverId === section.id ? 'border-primary bg-primary/5' : 'border-border bg-surface'"
      :data-test="`gear-section-${section.id}`"
      @dragenter.prevent="dragOverId = section.id"
      @dragleave="dragOverId = null"
      @dragover.prevent
      @drop.stop.prevent="onDrop(section.id)"
    >
      <details open>
        <!--
          Гибкая строка внутри `<summary>`, а не `display: flex` на нём самом:
          у `<summary>` с `display: flex` пропадает треугольник раскрытия —
          раздел перестаёт выглядеть сворачиваемым.
        -->
        <summary class="cursor-pointer select-none text-sm font-medium text-text">
          <span class="flex items-center gap-2">
            <span class="min-w-0 truncate">{{ section.title }}</span>

            <!--
              Инструменты раздела: «+ Подраздел», «Переименовать», «Удалить»
              прячутся за этой кнопкой. `prevent` не даёт клику заодно
              свернуть раздел, `stop` — не пускает его к обработчикам выше.
            -->
            <button
              v-if="canManage"
              type="button"
              class="ml-auto shrink-0 cursor-pointer rounded-lg border border-border bg-white px-1.5 py-0.5 text-xs text-muted transition-colors hover:border-primary hover:text-text"
              :aria-expanded="isToolsOpen(section.id)"
              :aria-label="`Инструменты раздела «${section.title}»`"
              :title="`Инструменты раздела «${section.title}»`"
              :data-test="`gear-section-tools-${section.id}`"
              @click.prevent.stop="toggleTools(section.id)"
            >
              ⋯
            </button>
          </span>
        </summary>

        <div class="mt-2 flex flex-col gap-2">
          <!-- Переименование: поле вместо заголовка, пока правят -->
          <form
            v-if="editingId === section.id"
            class="flex flex-wrap items-center gap-1"
            :data-test="`gear-section-rename-${section.id}`"
            @submit.prevent="submitRename(section)"
          >
            <input
              v-model="draftTitle"
              type="text"
              maxlength="60"
              class="min-w-0 grow rounded-lg border border-border bg-field px-2 py-1 text-base text-text focus:border-primary focus:outline-none"
              aria-label="Новое название раздела"
              :data-test="`gear-section-rename-title-${section.id}`"
            >
            <button
              type="submit"
              class="cursor-pointer rounded-lg border border-primary bg-primary px-2 py-1 text-sm text-white disabled:opacity-40"
              :disabled="draftTitle.trim().length === 0"
              :data-test="`gear-section-rename-save-${section.id}`"
            >
              Сохранить
            </button>
            <button
              type="button"
              class="cursor-pointer rounded-lg border border-border bg-white px-2 py-1 text-sm text-muted"
              @click="cancelRename"
            >
              Отмена
            </button>
          </form>

          <div
            v-else-if="canManage && isToolsOpen(section.id)"
            class="flex flex-wrap items-center gap-1"
            :data-test="`gear-section-tools-panel-${section.id}`"
          >
            <button
              type="button"
              class="cursor-pointer rounded-lg border border-border bg-white px-1.5 py-0.5 text-xs text-muted transition-colors hover:border-primary hover:text-text"
              title="Добавить подраздел"
              :data-test="`gear-section-add-child-${section.id}`"
              @click="startCreate(section.id)"
            >
              + Подраздел
            </button>
            <button
              type="button"
              class="cursor-pointer rounded-lg border border-border bg-white px-1.5 py-0.5 text-xs text-muted transition-colors hover:border-primary hover:text-text"
              :data-test="`gear-section-rename-open-${section.id}`"
              @click="startRename(section)"
            >
              Переименовать
            </button>
            <button
              type="button"
              class="cursor-pointer rounded-lg border border-border bg-white px-1.5 py-0.5 text-xs text-muted transition-colors hover:border-red-500 hover:text-red-600"
              title="Удалить раздел — вещи останутся в корне"
              :data-test="`gear-section-remove-${section.id}`"
              @click="emit('remove', section)"
            >
              Удалить
            </button>
          </div>

          <!-- Подраздел: то же самое, уровнем ниже -->
          <form
            v-if="creatingIn === section.id"
            class="flex flex-wrap items-center gap-1"
            :data-test="`gear-section-create-child-form-${section.id}`"
            @submit.prevent="submitCreate"
          >
            <input
              v-model="newTitle"
              type="text"
              maxlength="60"
              class="min-w-0 grow rounded-lg border border-border bg-field px-2 py-1 text-base text-text focus:border-primary focus:outline-none"
              placeholder="Название подраздела"
              aria-label="Название нового подраздела"
              :data-test="`gear-section-create-child-title-${section.id}`"
            >
            <button
              type="submit"
              class="cursor-pointer rounded-lg border border-primary bg-primary px-2 py-1 text-sm text-white disabled:opacity-40"
              :disabled="newTitle.trim().length === 0"
              :data-test="`gear-section-create-child-submit-${section.id}`"
            >
              Создать
            </button>
            <button
              type="button"
              class="cursor-pointer rounded-lg border border-border bg-white px-2 py-1 text-sm text-muted"
              @click="cancelCreate"
            >
              Отмена
            </button>
          </form>

          <TripGearSectionList
            :sections="sections"
            :items="items"
            :parent-id="section.id"
            :scope="scope"
            :can-manage="canManage"
            :can-place="canPlace"
            :can-add="canAdd"
            @create="emit('create', $event)"
            @rename="emit('rename', $event)"
            @remove="emit('remove', $event)"
            @move="emit('move', $event)"
            @add-to="emit('addTo', $event)"
          >
            <template #item="slotProps">
              <slot name="item" :item="slotProps.item" />
            </template>
          </TripGearSectionList>

          <p v-if="!hasContent(section.id)" class="text-xs text-muted">
            Пусто. Перенесите сюда вещи или добавьте новые.
          </p>

          <button
            v-if="canAdd"
            type="button"
            class="cursor-pointer self-start rounded-xl border border-border bg-white px-2 py-1 text-xs text-text transition-colors hover:border-primary"
            :data-test="`gear-section-add-item-${section.id}`"
            @click="emit('addTo', section.id)"
          >
            Добавить снаряжение
          </button>
        </div>
      </details>
    </div>
  </div>
</template>
