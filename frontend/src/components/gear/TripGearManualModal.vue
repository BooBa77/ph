<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import { addManualTripGear } from '@/api/gear'
import { fetchGearTypes } from '@/api/gearTypes'
import { ApiError } from '@/api/errors'
import { useAuthStore } from '@/stores/auth'
import GearAttributeFields from '@/components/gear/GearAttributeFields.vue'
import type { TripGearItem } from '@/types/gear'
import type { GearType } from '@/types/gearTypes'
import {
  buildGearAttributes,
  type GearAttributeDrafts,
} from '@/utils/gearAttributes'
import { parseWeightGrams } from '@/utils/gearWeight'

/**
 * «Указать вручную» — вещь, которой нет в каталоге (31.10.2026).
 *
 * Второй путь снаряжения похода, слова заказчика: «При добавлении снаряги
 * нужен пункт „Указать вручную“. Для модалки с вводом характеристик и
 * выбором хозяина». И уточнение: «Участникам даётся возможность добавить
 * в поход что-то одноразовое, бутылку бензина на розжиг, кусок целлофана
 * на тент и т.п.».
 *
 * **Модалка одна на три секции** — «Палатки», «Тент» и «Костровое»: форма
 * одна и та же (тип, характеристики, название, вес, хозяин), разница только
 * в типах, из которых выбирают. Копия формы в каждой секции разошлась бы
 * на первой правке — ровно как это было с полями характеристик каталога.
 *
 * **Характеристики спрашивает тип, а не экран.** Набор полей приходит из
 * `GET /api/gear-types` — того же справочника, что у каталога в профиле, —
 * и рисуется готовым `GearAttributeFields.vue`. Поэтому обязательные
 * значения проверяются тем же кодом и тем же текстом, что и в профиле.
 *
 * **Хозяин — только у организатора и только если в походе есть люди без
 * аккаунта.** Решение заказчика 31.10.2026: другому настоящему участнику
 * организатор вещь не добавляет (каждый добавляет своё сам, бэкенд отвечает
 * 403), а виртуальному — может. Если выбирать не из кого, селекта нет
 * вовсе: «я» — единственный вариант, и спрашивать не о чем.
 *
 * **Флаг «Регулярное» — только при настоящем хозяине.** У человека без
 * аккаунта каталога нет; без флага вещь живёт одним походом, с флагом —
 * появляется ещё и в списке снаряжения владельца. Это и есть второй путь
 * наполнения каталога: не через профиль, а из подготовки похода.
 */
const props = withDefaults(
  defineProps<{
    tripId: string
    /** Коды типов, из которых выбирают: контекст секции, открывшей модалку. */
    typeCodes: readonly string[]
    /** Тип, выбранный при открытии: «Палатка» из «Палаток», «Топор» из кострового. */
    defaultTypeCode: string
    /**
     * Кому можно отдать вещь. Пусто — выбор не показывается, хозяин «я».
     * Первым идёт смотрящий, дальше — люди без аккаунта этого похода.
     */
    ownerOptions?: readonly { userId: string; displayName: string }[]
  }>(),
  { ownerOptions: () => [] },
)

const emit = defineEmits<{
  /** Вещь заведена: родитель кладёт её в список секции и закрывает модалку. */
  created: [item: TripGearItem]
  close: []
}>()

const auth = useAuthStore()

const meId = computed(() => auth.user?.id ?? '')

/**
 * Выбор хозяина показываем, только когда вариантов больше одного.
 * Список с одним «я» — это поле, которое нечего заполнять.
 */
const hasOwnerChoice = computed(() => props.ownerOptions.length > 0)

const ownerUserId = ref(props.ownerOptions[0]?.userId ?? '')

const isVirtualOwner = computed(
  () => hasOwnerChoice.value && ownerUserId.value !== '' && ownerUserId.value !== meId.value,
)

/** Хозяин — настоящий пользователь: только тогда есть куда «положить в каталог». */
const canAddToCatalog = computed(() => !isVirtualOwner.value)

const addToCatalog = ref(false)

const types = ref<GearType[]>([])
const typesError = ref<string | null>(null)
const isLoadingTypes = ref(true)

const typeId = ref<number | null>(null)
const title = ref('')
const weight = ref('')
const drafts = ref<GearAttributeDrafts>({})

const isSaving = ref(false)
const error = ref<string | null>(null)

/** Типы контекста: палатка и тент — в «Палатках», один тип — в костровом. */
const availableTypes = computed<readonly GearType[]>(() =>
  types.value.filter((type) => props.typeCodes.includes(type.code)),
)

const selectedType = computed<GearType | null>(
  () => availableTypes.value.find((type) => type.id === typeId.value) ?? null,
)

const selectedAttributes = computed(() => selectedType.value?.attributes ?? [])

/**
 * Справочник грузим при открытии, а не при входе на вкладку: модалка
 * открывается не каждый раз, а справочник в походе нужен только ей.
 */
onMounted(async () => {
  isLoadingTypes.value = true
  typesError.value = null

  try {
    types.value = await fetchGearTypes()

    const preferred = availableTypes.value.find((type) => type.code === props.defaultTypeCode)
    typeId.value = preferred?.id ?? availableTypes.value[0]?.id ?? null
  } catch (problem) {
    typesError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось загрузить типы снаряжения'
  } finally {
    isLoadingTypes.value = false
  }
})

/**
 * Смена типа стирает значения прежнего типа — так же, как в каталоге.
 * Оставить их значило бы отправить «вместимость» топору: у нового типа
 * такого поля нет.
 */
watch(typeId, () => {
  drafts.value = {}
})

async function save(): Promise<void> {
  if (isSaving.value) return

  const type = selectedType.value

  if (type === null) {
    error.value = 'Выберите тип снаряжения: характеристики вещи задаёт тип.'
    return
  }

  const weightGrams = parseWeightGrams(weight.value)

  if (weightGrams === undefined) {
    error.value = 'Вес — целое число граммов, больше нуля. Или оставьте поле пустым.'
    return
  }

  const built = buildGearAttributes(type.attributes, drafts.value)

  if (built.error !== null) {
    error.value = built.error
    return
  }

  isSaving.value = true
  error.value = null

  try {
    const item = await addManualTripGear(props.tripId, {
      typeId: type.id,
      attributes: built.attributes,
      // `null` — «подпиши именем типа»: название у одноразовой вещи
      // необязательно, и пустая строка здесь была бы названием.
      title: title.value.trim().length > 0 ? title.value.trim() : null,
      weightGrams,
      ownerUserId: hasOwnerChoice.value ? ownerUserId.value : null,
      // У виртуального каталога нет: бэкенд ответил бы 400.
      addToCatalog: canAddToCatalog.value && addToCatalog.value,
    })

    emit('created', item)
  } catch (problem) {
    // Ошибка — в модалке, а не строкой под затемнением (правило «Трансфера»).
    error.value =
      problem instanceof ApiError ? problem.message : 'Не удалось добавить вещь'
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4"
    data-test="manual-gear-dialog"
  >
    <div
      class="flex w-full max-w-lg flex-col gap-3 rounded-xl border border-border bg-surface p-4"
    >
      <div class="flex flex-col gap-1">
        <h3 class="text-base font-medium text-text">Указать вручную</h3>
        <p class="text-xs text-muted">
          Вещь для этого похода: бутылка бензина на розжиг, кусок целлофана на тент.
          В личный каталог она попадает только по галочке ниже.
        </p>
      </div>

      <p v-if="isLoadingTypes" class="text-sm text-muted" data-test="manual-gear-loading">
        Загружаем типы снаряжения…
      </p>

      <p v-else-if="typesError" class="text-sm text-red-600" data-test="manual-gear-types-error">
        {{ typesError }}
      </p>

      <template v-else>
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="flex flex-col gap-1 text-xs text-muted">
            Тип
            <select
              v-model="typeId"
              class="w-full cursor-pointer rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none"
              data-test="manual-type"
            >
              <option v-for="type in availableTypes" :key="type.id" :value="type.id">
                {{ type.name }}
              </option>
            </select>
          </label>

          <label class="flex flex-col gap-1 text-xs text-muted">
            Вес, г
            <input
              v-model="weight"
              type="number"
              min="1"
              step="1"
              placeholder="800"
              class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none"
              data-test="manual-weight"
            />
          </label>
        </div>

        <label class="flex flex-col gap-1 text-xs text-muted">
          Название
          <input
            v-model="title"
            type="text"
            maxlength="120"
            placeholder="Пусто — подпишем именем типа"
            class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none"
            data-test="manual-title"
          />
        </label>

        <!-- Характеристики выбранного типа: обязательные спрашиваются здесь же -->
        <div
          v-if="selectedAttributes.length > 0"
          class="rounded-xl border border-border bg-surface p-3"
          data-test="manual-attributes"
        >
          <h4 class="mb-2 text-sm font-medium text-text">
            Характеристики типа «{{ selectedType?.name }}»
          </h4>
          <GearAttributeFields
            v-model="drafts"
            :attributes="selectedAttributes"
            prefix="manual"
            :disabled="isSaving"
          />
        </div>

        <!--
          Хозяин — только организатору и только если в походе есть люди без
          аккаунта: другому настоящему участнику вещь не добавляют.
        -->
        <label
          v-if="hasOwnerChoice"
          class="flex flex-col gap-1 text-xs text-muted"
          data-test="manual-owner-field"
        >
          Хозяин вещи
          <select
            v-model="ownerUserId"
            class="w-full cursor-pointer rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none"
            data-test="manual-owner"
          >
            <option
              v-for="owner in ownerOptions"
              :key="owner.userId"
              :value="owner.userId"
            >
              {{ owner.displayName }}
            </option>
          </select>
        </label>

        <label
          v-if="canAddToCatalog"
          class="flex items-start gap-2 text-sm text-text"
          data-test="manual-catalog-field"
        >
          <input
            v-model="addToCatalog"
            type="checkbox"
            class="mt-0.5 h-4 w-4 cursor-pointer accent-primary"
            data-test="manual-catalog"
          />
          <span>
            Добавить в мой список снаряжения для регулярного использования
            <span class="block text-xs text-muted">
              Без галочки вещь останется только в этом походе.
            </span>
          </span>
        </label>

        <p v-else class="text-xs text-muted" data-test="manual-virtual-hint">
          У человека без аккаунта каталога нет — вещь будет только в этом походе.
        </p>

        <p v-if="error" class="text-sm text-red-600" data-test="manual-error">{{ error }}</p>

        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="cursor-pointer rounded-xl border border-primary bg-primary px-3 py-1.5 text-sm text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            :disabled="isSaving || selectedType === null"
            data-test="manual-save"
            @click="save"
          >
            {{ isSaving ? 'Добавляем…' : 'Добавить' }}
          </button>

          <button
            type="button"
            class="cursor-pointer rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-text transition-colors hover:border-primary"
            :disabled="isSaving"
            data-test="manual-cancel"
            @click="emit('close')"
          >
            Отмена
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
