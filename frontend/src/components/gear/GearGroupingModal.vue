<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import {
  assignGearGroupType,
  createGearGroup,
  deleteGearGroup,
  moveGearGroup,
  updateGearGroup,
} from '@/api/gear'
import { ApiError } from '@/api/errors'
import type { GearGroup, GearGroupType } from '@/types/gear'

/**
 * «Настройка группировки снаряжения» (02.11.2026).
 *
 * Заказчик: «В разделе „Снаряжение“ добавляем кнопку „Настройка группировки
 * снаряжения“. По этой кнопке открывается инструмент для редактирования
 * групп — можно переименовывать, удалять, перекидывать содержащиеся типы.
 * Единственное, давай забиндим в неудаляемое „Прочее“».
 *
 * **Группа собирает типы, а не вещи.** Поэтому в карточке группы лежат типы:
 * перекладывают тип, и все его вещи переезжают вместе с ним. Вещь отдельно
 * не переносят — иначе тип и вещь спорили бы, где лежит полка.
 *
 * **«Прочее» неудаляемо и всегда последнее.** Его можно переименовать
 * (имя — не контракт), но кнопки удаления и стрелок у него нет: это
 * умолчание и место, куда уезжают типы удалённой группы.
 *
 * **Порядок — стрелками**, как у вещей в каталоге: на телефоне стрелка
 * работает так же, как мышью, и не требует отдельного кода перетаскивания.
 *
 * Все ручки отвечают списком групп целиком, поэтому после каждого действия
 * экран показывает свежие данные, а не склеивает ответ у себя.
 */
const props = defineProps<{
  /** Группы, уже загруженные каталогом: лишний запрос при открытии не нужен. */
  groups: GearGroup[]
}>()

const emit = defineEmits<{
  /** Закрыть без изменений: каталог перечитает группы сам при следующем шаге. */
  close: []
  /** Группы изменились: родитель заменяет список и перечитывает вещи. */
  updated: [groups: GearGroup[]]
}>()

const groups = ref<GearGroup[]>([...props.groups])
const error = ref<string | null>(null)
const busy = ref(false)
const newGroupName = ref('')
const confirmingGroupId = ref<number | null>(null)

/** Группы без «Прочего»: стрелки двигают только их. */
const movable = computed(() => groups.value.filter((group) => !group.isDefault))

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof ApiError ? cause.message : fallback
}

function apply(next: GearGroup[]): void {
  groups.value = next
  emit('updated', next)
}

/**
 * Одно действие с общей защитой от двойного нажатия и общим показом ошибки.
 *
 * `false` — действие не удалось: вызывающий сам решает, вернуть ли поле
 * к прежнему значению.
 */
async function run(
  action: () => Promise<GearGroup[]>,
  fallback: string,
): Promise<boolean> {
  if (busy.value) return false

  busy.value = true
  error.value = null

  try {
    apply(await action())
    return true
  } catch (cause) {
    error.value = messageOf(cause, fallback)
    return false
  } finally {
    busy.value = false
  }
}

function movableIndex(groupId: number): number {
  return movable.value.findIndex((group) => group.id === groupId)
}

function canMoveUp(group: GearGroup): boolean {
  return !group.isDefault && movableIndex(group.id) > 0
}

function canMoveDown(group: GearGroup): boolean {
  return !group.isDefault && movableIndex(group.id) < movable.value.length - 1
}

async function move(group: GearGroup, direction: 'up' | 'down'): Promise<void> {
  await run(
    () => moveGearGroup(group.id, direction),
    'Не удалось переставить группу',
  )
}

/** Переименование по потере фокуса: пустое имя возвращаем, как у вещей. */
async function rename(group: GearGroup, event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const name = input.value.trim()

  if (name.length === 0 || name === group.name) {
    input.value = group.name
    return
  }

  const saved = await run(
    () => updateGearGroup(group.id, { name }),
    'Не удалось переименовать группу',
  )
  if (!saved) input.value = group.name
}

async function addGroup(): Promise<void> {
  const name = newGroupName.value.trim()
  if (name.length === 0) return

  const saved = await run(() => createGearGroup({ name }), 'Не удалось создать группу')
  if (saved) newGroupName.value = ''
}

async function removeGroup(group: GearGroup): Promise<void> {
  confirmingGroupId.value = null
  await run(() => deleteGearGroup(group.id), 'Не удалось удалить группу')
}

/**
 * Где сейчас лежит тип: по этому значению рисуется выбор группы.
 *
 * Если типа нет ни в одной группе (гонка с новой раскладкой), считаем
 * «Прочим»: сервер всё равно положит его туда.
 */
function groupIdOfType(typeId: number): number {
  return (
    groups.value.find((group) => group.types.some((type) => type.id === typeId))
      ?.id ?? groups.value.find((group) => group.isDefault)?.id ?? 0
  )
}

/** Переложить тип: выбранная группа и есть новое место. */
async function moveType(type: GearGroupType, group: GearGroup, event: Event): Promise<void> {
  const select = event.target as HTMLSelectElement
  const targetId = Number(select.value)
  if (targetId === group.id) return

  const saved = await run(
    () => assignGearGroupType(targetId, type.id),
    'Не удалось переложить тип',
  )
  if (!saved) select.value = String(groupIdOfType(type.id))
}

function close(): void {
  emit('close')
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') close()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="gear-grouping-title"
    data-test="grouping-dialog"
    @click.self="close"
  >
    <div class="flex w-full max-w-2xl flex-col gap-4 rounded-xl border border-border bg-surface p-4">
      <div class="flex items-start justify-between gap-3">
        <div class="flex flex-col gap-1">
          <h3 id="gear-grouping-title" class="text-base font-medium text-text">Настройка группировки снаряжения</h3>
          <p class="text-xs text-muted">
            Группы собирают типы: переложи тип — его вещи переедут вместе с ним. «Прочее»
            удалить нельзя, и оно всегда последнее: туда попадает тип без своей группы.
          </p>
        </div>

        <button
          type="button"
          class="cursor-pointer rounded-xl border border-border px-2 py-1 text-xs text-muted transition-colors hover:text-text"
          aria-label="Закрыть"
          data-test="grouping-close"
          @click="close"
        >
          ✕
        </button>
      </div>

      <p v-if="error" class="text-sm text-red-600" data-test="grouping-error">{{ error }}</p>

      <!-- Новая группа: встаёт перед «Прочим», порядок потом двигают стрелками -->
      <form class="flex flex-wrap items-end gap-2" @submit.prevent="addGroup">
        <label class="flex min-w-48 flex-1 flex-col gap-1">
          <span class="text-xs text-muted">Новая группа</span>
          <input
            v-model="newGroupName"
            type="text"
            maxlength="100"
            placeholder="Рыбалка"
            class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none"
            data-test="grouping-new-name"
          />
        </label>

        <button
          type="submit"
          :disabled="busy || newGroupName.trim().length === 0"
          class="cursor-pointer rounded-xl border border-primary bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          data-test="grouping-add"
        >
          Добавить группу
        </button>
      </form>

      <div class="flex flex-col gap-3">
        <article
          v-for="group in groups"
          :key="group.id"
          class="flex flex-col gap-2 rounded-xl border border-border bg-base p-3"
          data-test="grouping-group"
        >
          <div class="flex flex-wrap items-center gap-2">
            <div class="flex items-center gap-1">
              <button
                type="button"
                :disabled="busy || !canMoveUp(group)"
                class="cursor-pointer rounded-lg border border-border px-2 py-0.5 text-xs text-muted transition-colors hover:border-primary hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
                title="Выше"
                data-test="grouping-move-up"
                @click="move(group, 'up')"
              >
                ↑
              </button>
              <button
                type="button"
                :disabled="busy || !canMoveDown(group)"
                class="cursor-pointer rounded-lg border border-border px-2 py-0.5 text-xs text-muted transition-colors hover:border-primary hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
                title="Ниже"
                data-test="grouping-move-down"
                @click="move(group, 'down')"
              >
                ↓
              </button>
            </div>

            <input
              :value="group.name"
              type="text"
              maxlength="100"
              :disabled="busy"
              class="min-w-40 flex-1 rounded-lg border border-border bg-field px-2 py-1 text-sm text-text transition-colors focus:border-primary focus:outline-none disabled:opacity-60"
              aria-label="Название группы"
              data-test="grouping-name"
              @change="rename(group, $event)"
            />

            <span
              v-if="group.isDefault"
              class="rounded-lg border border-border px-2 py-0.5 text-xs text-muted"
              data-test="grouping-default"
            >
              умолчание, всегда последнее
            </span>

            <template v-else-if="confirmingGroupId === group.id">
              <span class="text-xs text-muted">Удалить? Типы уедут в «Прочее»</span>
              <button
                type="button"
                :disabled="busy"
                class="cursor-pointer rounded-xl border border-red-600 px-2 py-1 text-xs text-red-600 transition-colors hover:bg-red-600 hover:text-white disabled:opacity-50"
                data-test="grouping-delete-confirm"
                @click="removeGroup(group)"
              >
                Да
              </button>
              <button
                type="button"
                class="cursor-pointer rounded-xl border border-border px-2 py-1 text-xs text-muted transition-colors hover:text-text"
                data-test="grouping-delete-cancel"
                @click="confirmingGroupId = null"
              >
                Нет
              </button>
            </template>

            <button
              v-else
              type="button"
              :disabled="busy"
              class="cursor-pointer rounded-xl border border-border px-2 py-1 text-xs text-muted transition-colors hover:border-red-600 hover:text-red-600 disabled:opacity-50"
              data-test="grouping-delete"
              @click="confirmingGroupId = group.id"
            >
              Удалить
            </button>
          </div>

          <p v-if="group.types.length === 0" class="text-xs text-muted" data-test="grouping-empty">
            Типов нет — переложи сюда тип из другой группы.
          </p>

          <ul v-else class="flex flex-col gap-1">
            <li
              v-for="type in group.types"
              :key="type.id"
              class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-2 py-1"
              data-test="grouping-type"
            >
              <span class="text-sm text-text">
                {{ type.name }}
                <span v-if="!type.isActive" class="text-xs text-muted">· в архиве</span>
              </span>

              <select
                v-if="type.isActive"
                :value="group.id"
                :disabled="busy"
                class="cursor-pointer rounded-lg border border-border bg-field px-2 py-1 text-xs text-text focus:border-primary focus:outline-none disabled:opacity-60"
                :aria-label="`Группа типа «${type.name}»`"
                data-test="grouping-type-group"
                @change="moveType(type, group, $event)"
              >
                <option
                  v-for="target in groups"
                  :key="target.id"
                  :value="target.id"
                >
                  {{ target.name }}
                </option>
              </select>
            </li>
          </ul>
        </article>
      </div>

      <div class="flex justify-end">
        <button
          type="button"
          class="cursor-pointer rounded-xl border border-border px-4 py-2 text-sm text-muted transition-colors hover:text-text"
          data-test="grouping-done"
          @click="close"
        >
          Готово
        </button>
      </div>
    </div>
  </div>
</template>
