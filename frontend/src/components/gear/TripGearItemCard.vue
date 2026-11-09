<script setup lang="ts">
import { ref } from 'vue'

import { updateTripGear } from '@/api/gear'
import { ApiError } from '@/api/errors'
import TripGearItemModal from '@/components/gear/TripGearItemModal.vue'
import type { TripGearItem, TripGearStatus } from '@/types/gear'

/**
 * Карточка вещи похода для «Ночёвок» (06.11.2026).
 *
 * Заказчик: «в Ночёвках на пилюлях снаряжения также нужна модалка
 * с характеристиками и выбором „Берём/не берём“ (для организатора)».
 * На вкладке «Снаряжение» такая карточка уже есть — это та же
 * `TripGearItemModal`, а здесь только обвязка: чем отличается «Ночёвки».
 *
 * **Чем отличается.** В «Ночёвках» карточку открывает пилюля секции,
 * а не список «Берём», и всё, что не про состав, ей не нужно: разделы
 * и несущего в «Ночёвках» не правят. Поэтому `canPlace`/`canAssign`
 * выключены всегда, а `canDecide` приходит от роли: «Не берём» — решение
 * ведущего вкладку, и его видит только он.
 *
 * **Данные не копятся.** Выбор сразу уходит на сервер, ответ отдаётся
 * наверх событием `updated`: у каждой секции «Ночёвок» свой список, и
 * родитель обязан заменить строку именно в нём, а не перечитать всю
 * вкладку. Ошибку показываем в самой карточке — строка секции далеко,
 * и молчание выглядело бы как «сохранилось».
 */
const props = withDefaults(
  defineProps<{
    tripId: string
    /** Вещь, по которой открыта карточка. `null` — карточка закрыта. */
    item: TripGearItem | null
    /** Менять «предложено / берём / не берём» — право вкладки. */
    canDecide?: boolean
    /** Владелец словами: имя приходит из состава похода. */
    ownerName?: string
    /** Кто несёт. `null` — ещё не распределена. */
    assigneeName?: string | null
    /** Кого можно выбрать несущим: только идущие, как на сервере. */
    assigneeChoices?: readonly { userId: string; label: string }[]
    /** Менять несущего: в «Ночёвках» несущего правят в «Снаряжении». */
    canAssign?: boolean
  }>(),
  {
    canDecide: false,
    ownerName: 'Участник',
    assigneeName: null,
    assigneeChoices: () => [],
    canAssign: false,
  },
)

const emit = defineEmits<{
  updated: [item: TripGearItem]
  close: []
}>()

const busy = ref(false)
const errorText = ref<string | null>(null)

async function saveStatus(status: TripGearStatus): Promise<void> {
  if (props.item === null || busy.value) return

  busy.value = true
  errorText.value = null

  try {
    const updated = await updateTripGear(props.tripId, props.item.id, { status })
    emit('updated', updated)
  } catch (problem) {
    errorText.value =
      problem instanceof ApiError
        ? problem.message
        : 'Не удалось сохранить решение по вещи'
  } finally {
    busy.value = false
  }
}

async function saveAssignee(userId: string | null): Promise<void> {
  if (props.item === null || busy.value) return

  busy.value = true
  errorText.value = null

  try {
    const updated = await updateTripGear(props.tripId, props.item.id, {
      assignedUserId: userId,
    })
    emit('updated', updated)
  } catch (problem) {
    errorText.value =
      problem instanceof ApiError
        ? problem.message
        : 'Не удалось сменить несущего'
  } finally {
    busy.value = false
  }
}

function close(): void {
  errorText.value = null
  emit('close')
}
</script>

<template>
  <TripGearItemModal
    v-if="item"
    :item="item"
    scope="shared"
    :owner-name="ownerName"
    :assignee-name="assigneeName"
    :assignee-choices="assigneeChoices"
    :can-assign="canAssign"
    :can-decide="canDecide"
    :can-place="false"
    :can-remove="false"
    :hide-assignee="true"
    :busy="busy"
    :error-text="errorText"
    @status="saveStatus"
    @assignee="saveAssignee"
    @close="close"
  />
</template>
