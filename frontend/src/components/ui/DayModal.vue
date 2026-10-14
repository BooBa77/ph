<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import type { CalendarDay } from '@/api/calendar'
import { ApiError } from '@/api/errors'
import ActivityIcon from '@/components/ui/ActivityIcon.vue'
import { useCalendarStore } from '@/stores/calendar'
import { capitalize, fullDate, toIsoDate } from '@/utils/calendar'

/**
 * Модалка выбранного дня.
 *
 * Показывает день и даёт его отредактировать: в правом верхнем углу —
 * переключатель РАБ/ВЫХ, в заголовке — метка дня («Понедельник», «Новый
 * год», «ДР Любы»), которую можно переписать кликом.
 *
 * Статус меняется одним кликом: рабочий или выходной. Сокращённый день
 * отдельной кнопкой не выносим — он рабочий, просто короче, и рядом
 * появляется подпись об этом. Поэтому нажатие «РАБ» на сокращённом дне
 * ничего не делает: иначе одна ошибка стирала бы признак «короче на час».
 *
 * Модалка сама ходит в стор: день — часть календаря, и передавать наружу
 * каждую правку ради того, чтобы родитель её переслал обратно, незачем.
 */
const props = defineProps<{
  /** Выбранный день. */
  date: Date
}>()

const emit = defineEmits<{ close: [] }>()

const store = useCalendarStore()

/** Ключ дня — по нему ищем день в кэше стора. */
const iso = computed(() => toIsoDate(props.date))

/** День из стора: после правки он обновляется, и модалка это видит. */
const day = computed<CalendarDay | null>(() => store.day(iso.value))

const isToday = computed(() => iso.value === toIsoDate(new Date()))

/** Выходной ли: всё остальное (рабочий и сокращённый) — рабочие дни. */
const isWeekend = computed(() => day.value?.dayType === 'weekend')

/** Сокращённый день: рабочий, но на час короче. */
const isShort = computed(() => day.value?.dayType === 'short_workday')

/** Заголовок — метка дня; если её нет, показываем дату. */
const title = computed(
  () => day.value?.label ?? capitalize(fullDate(props.date)),
)

const isEditingLabel = ref(false)
const labelDraft = ref('')
const isSaving = ref(false)
const error = ref<string | null>(null)

// День обновился (в том числе после нашей же правки) — подтягиваем черновик.
watch(
  () => day.value?.label,
  (label) => {
    labelDraft.value = label ?? ''
  },
  { immediate: true },
)

async function run(action: () => Promise<unknown>) {
  isSaving.value = true
  error.value = null
  try {
    await action()
  } catch (cause) {
    error.value =
      cause instanceof ApiError
        ? cause.message
        : 'Не удалось сохранить. Попробуйте ещё раз.'
  } finally {
    isSaving.value = false
  }
}

/**
 * «ВЫХ»: сделать день выходным.
 *
 * Повторный клик — ничего: лишний запрос ради того же значения только
 * дёргает сеть и мигает состоянием.
 */
function setWeekend() {
  if (isWeekend.value) return
  void run(() => store.patchDay({ date: iso.value, dayType: 'weekend' }))
}

/**
 * «РАБ»: вернуть день в рабочие.
 *
 * Сокращённый день тоже рабочий, поэтому клик по «РАБ» на нём ничего
 * не меняет — иначе короткий день в один тап превращался бы в обычный.
 */
function setWorkday() {
  if (!isWeekend.value) return
  void run(() => store.patchDay({ date: iso.value, dayType: 'workday' }))
}

function startEditingLabel() {
  labelDraft.value = day.value?.label ?? ''
  isEditingLabel.value = true
}

function saveLabel() {
  const label = labelDraft.value.trim()
  void run(async () => {
    await store.patchDay({ date: iso.value, label: label === '' ? null : label })
    isEditingLabel.value = false
  })
}

/** Пункт закладки: тип активности с цветом своей группы. */
interface TypeItem {
  id: number
  icon: string
  label: string
  color: string
}

const notePublicDraft = ref('')
const notePersonalDraft = ref('')

/** Активная закладка: 'favorites' или идентификатор группы. */
const activeTab = ref<number | 'favorites'>('favorites')
const isRequesting = ref(false)
const requestLabel = ref('')
const requestSent = ref(false)

const groups = computed(() => store.dictionary?.groups ?? [])

/** Все типы с цветом группы — по нему рисуются иконки. */
const allTypes = computed<TypeItem[]>(() =>
  groups.value.flatMap((group) =>
    group.types.map((type) => ({
      id: type.id,
      icon: type.icon,
      label: type.label,
      color: group.color,
    })),
  ),
)

const favoriteTypes = computed(() =>
  (store.dictionary?.favorites ?? [])
    .map((id) => allTypes.value.find((type) => type.id === id))
    .filter((type): type is TypeItem => Boolean(type)),
)

/** Отмечено на этом дне. */
const selected = computed(() => store.activities(iso.value))

/** Что показывать в закладке: отмеченное уже уехало наверх. */
const tabTypes = computed(() => {
  if (activeTab.value === 'favorites') return favoriteTypes.value
  const group = groups.value.find((item) => item.id === activeTab.value)
  return (group?.types ?? []).map((type) => ({
    id: type.id,
    icon: type.icon,
    label: type.label,
    color: group?.color ?? 'currentColor',
  }))
})

const availableTypes = computed(() =>
  tabTypes.value.filter((type) => !selected.value.includes(type.id)),
)

const selectedTypes = computed(() =>
  selected.value
    .map((id) => allTypes.value.find((type) => type.id === id))
    .filter((type): type is TypeItem => Boolean(type)),
)

const myRequests = computed(() => store.dictionary?.requests ?? [])

// День или его заметки обновились — подтягиваем черновики.
watch(
  () => day.value,
  (value) => {
    notePublicDraft.value = value?.notePublic ?? ''
    notePersonalDraft.value = value?.notePersonal ?? ''
  },
  { immediate: true },
)

function toggleType(typeId: number) {
  const active = selected.value.includes(typeId)
  void run(() => store.toggleActivity(iso.value, typeId, !active))
}

/**
 * Закрыть модалку, сохранив заметки.
 *
 * Отдельной кнопки «Сохранить» нет: заметки — часть дня, и уходят они
 * в базу так же, как метка и статус, — в момент ухода. Пишем, только если
 * текст изменился, чтобы уход без правок не дёргал сеть.
 *
 * Если запись не прошла, модалку не закрываем: написанный текст дороже
 * одного лишнего клика, а показать ошибку больше негде.
 */
async function closeWithSave() {
  const personal =
    notePersonalDraft.value.trim() === '' ? null : notePersonalDraft.value
  const shared = notePublicDraft.value.trim() === '' ? null : notePublicDraft.value

  const changed =
    (day.value?.notePersonal ?? null) !== personal ||
    (day.value?.notePublic ?? null) !== shared

  if (changed) {
    try {
      await store.saveNotes(iso.value, {
        notePublic: shared,
        notePersonal: personal,
      })
    } catch (cause) {
      error.value =
        cause instanceof ApiError
          ? cause.message
          : 'Не удалось сохранить заметки. Попробуйте ещё раз.'
      return
    }
  }

  emit('close')
}

async function sendRequest() {
  const label = requestLabel.value.trim()
  if (label === '') return

  isRequesting.value = true
  error.value = null
  try {
    await store.requestActivity(label)
    requestLabel.value = ''
    requestSent.value = true
  } catch (cause) {
    error.value =
      cause instanceof ApiError
        ? cause.message
        : 'Не удалось отправить запрос. Попробуйте ещё раз.'
  } finally {
    isRequesting.value = false
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  // Escape при открытом поле метки сначала отменяет правку, а не закрывает
  // модалку: иначе один промах по клавише уносит весь диалог.
  if (isEditingLabel.value) {
    isEditingLabel.value = false
    return
  }
  void closeWithSave()
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  // Справочник активностей: нужен для закладок. Ошибку глотаем — модалка
  // остаётся полезной (статус, метка, заметки) даже без справочника.
  void store.ensureDictionary().catch(() => undefined)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="day-modal-title"
    @click.self="closeWithSave"
  >
    <div class="relative w-full max-w-sm rounded-2xl bg-surface p-4 shadow-xl">
      <!-- РАБ / ВЫХ в углу: один клик — одно изменение -->
      <div class="absolute right-3 top-3 flex gap-1 rounded-lg bg-bg p-0.5">
        <button
          type="button"
          :disabled="isSaving"
          class="cursor-pointer rounded px-2 py-1 text-xs transition-colors disabled:opacity-50"
          :class="!isWeekend ? 'bg-surface font-medium text-text' : 'text-muted'"
          aria-label="Рабочий день"
          @click="setWorkday"
        >
          РАБ
        </button>
        <button
          type="button"
          :disabled="isSaving"
          class="cursor-pointer rounded px-2 py-1 text-xs transition-colors disabled:opacity-50"
          :class="isWeekend ? 'bg-surface font-medium text-text' : 'text-muted'"
          aria-label="Выходной день"
          @click="setWeekend"
        >
          ВЫХ
        </button>
      </div>

      <!-- Метка дня: заголовок, по клику правится -->
      <div class="pr-20">
        <input
          v-if="isEditingLabel"
          v-model="labelDraft"
          type="text"
          maxlength="100"
          aria-label="Метка дня"
          class="w-full rounded border border-primary bg-field px-2 py-1 text-lg text-text outline-none"
          @keydown.enter="saveLabel"
        />
        <h2
          v-else
          id="day-modal-title"
          class="cursor-pointer text-lg font-semibold text-text hover:text-primary"
          title="Нажмите, чтобы изменить метку"
          @click="startEditingLabel"
        >
          {{ title }}
        </h2>
      </div>

      <p class="mt-1 text-sm text-muted">{{ capitalize(fullDate(date)) }}</p>
      <p v-if="isToday" class="mt-1 text-xs font-medium text-primary">Это сегодня</p>
      <p v-if="isShort" class="mt-1 text-xs text-calendar-workday">
        Сокращённый рабочий день — на час короче.
      </p>

      <div v-if="isEditingLabel" class="mt-2 flex justify-end gap-2">
        <button
          type="button"
          :disabled="isSaving"
          class="cursor-pointer rounded-lg border border-border bg-bg px-3 py-1 text-xs text-text disabled:opacity-50"
          @click="isEditingLabel = false"
        >
          Отмена
        </button>
        <button
          type="button"
          :disabled="isSaving"
          class="cursor-pointer rounded-lg bg-primary px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          @click="saveLabel"
        >
          Сохранить
        </button>
      </div>

      <p v-if="error" class="mt-3 text-sm text-red-600">{{ error }}</p>

      <!-- Что отмечено на дне: отмеченное уезжает сюда из закладок -->
      <div v-if="selectedTypes.length > 0" class="mt-3">
        <p class="text-xs text-muted">Отмечено на дне</p>
        <div class="mt-1 flex flex-wrap gap-1">
          <button
            v-for="type in selectedTypes"
            :key="type.id"
            type="button"
            :disabled="isSaving"
            class="flex cursor-pointer items-center gap-1 rounded-lg border border-primary bg-primary/10 px-2 py-1 text-xs text-text disabled:opacity-50"
            :title="`${type.label} — нажмите, чтобы убрать`"
            @click="toggleType(type.id)"
          >
            <span class="h-4 w-4" :style="{ color: type.color }">
              <ActivityIcon :name="type.icon" />
            </span>
            {{ type.label }}
          </button>
        </div>
      </div>

      <!-- Закладки: избранное и группы -->
      <div class="mt-3">
        <div class="flex flex-wrap gap-1 border-b border-border pb-1">
          <button
            type="button"
            class="cursor-pointer rounded px-2 py-1 text-xs transition-colors"
            :class="
              activeTab === 'favorites'
                ? 'bg-bg font-medium text-text'
                : 'text-muted hover:text-text'
            "
            @click="activeTab = 'favorites'"
          >
            Избранное
          </button>
          <button
            v-for="group in groups"
            :key="group.id"
            type="button"
            class="cursor-pointer rounded px-2 py-1 text-xs transition-colors"
            :class="
              activeTab === group.id
                ? 'bg-bg font-medium text-text'
                : 'text-muted hover:text-text'
            "
            @click="activeTab = group.id"
          >
            {{ group.label }}
          </button>
        </div>

        <!-- Высота фиксированная: у «Спорта» четыре лого, у «Работы» два,
             и модалка не должна прыгать при переключении закладок. Если
             типов станет больше двух рядов — появится прокрутка, а не скачок. -->
        <div
          v-if="availableTypes.length > 0"
          class="mt-2 flex h-28 flex-wrap content-start gap-2 overflow-y-auto"
        >
          <button
            v-for="type in availableTypes"
            :key="type.id"
            type="button"
            :disabled="isSaving"
            class="flex w-16 cursor-pointer flex-col items-center gap-1 rounded-lg px-1 py-1 text-xs text-muted transition-colors hover:bg-bg hover:text-text disabled:opacity-50"
            @click="toggleType(type.id)"
          >
            <span class="h-7 w-7" :style="{ color: type.color }">
              <ActivityIcon :name="type.icon" />
            </span>
            {{ type.label }}
          </button>
        </div>
        <p v-else class="mt-2 text-xs text-muted">
          {{
            activeTab === 'favorites'
              ? 'Здесь появятся ваши частые активности. Отметьте что-нибудь.'
              : 'В этой группе всё уже отмечено.'
          }}
        </p>

        <!-- Запрос новой активности: только внутри группы. В «Избранном»
             группу не выбрать, поэтому и предлагать там нечего. -->
        <div v-if="activeTab !== 'favorites'" class="mt-3 flex items-end gap-2">
          <label class="flex flex-1 flex-col gap-1 text-xs text-muted">
            Нет нужной? Предложите её
            <input
              v-model="requestLabel"
              type="text"
              maxlength="100"
              placeholder="например, диван"
              class="rounded border border-border bg-field px-2 py-1 text-sm text-text"
              @keydown.enter="sendRequest"
            />
          </label>
          <button
            type="button"
            :disabled="isRequesting || requestLabel.trim() === ''"
            class="cursor-pointer rounded-lg border border-border bg-bg px-3 py-1.5 text-sm text-text transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
            @click="sendRequest"
          >
            {{ isRequesting ? '…' : 'Предложить' }}
          </button>
        </div>

        <p v-if="requestSent" class="mt-2 text-xs text-muted">
          Запрос отправлен. Иконку нарисуем и покажем — она станет доступна всем.
        </p>

        <ul v-if="myRequests.length > 0" class="mt-2 space-y-1 text-xs text-muted">
          <li v-for="request in myRequests" :key="request.id">
            «{{ request.label }}» —
            <span v-if="request.status === 'pending'">на модерации</span>
            <span v-else-if="request.status === 'approved'">одобрено</span>
            <span v-else-if="request.status === 'revision'">на доработке у нас</span>
            <span v-else>отклонено</span>
            <span v-if="request.adminComment"> · {{ request.adminComment }}</span>
          </li>
        </ul>
      </div>

      <!-- Заметки дня: личная и «поделиться». Поля открыты сразу — прятать
           их за кнопкой значило бы делать лишний клик там, куда и приходят. -->
      <div class="mt-3">
        <p class="text-xs text-muted">Заметки дня</p>

        <label class="mt-2 flex flex-col gap-1 text-xs text-muted">
          Для себя
          <textarea
            v-model="notePersonalDraft"
            rows="2"
            maxlength="2000"
            class="rounded border border-border bg-field px-2 py-1 text-sm text-text"
          />
        </label>
        <label class="mt-2 flex flex-col gap-1 text-xs text-muted">
          Поделиться (пока видно только вам — покажем другим, когда появятся
          чужие календари)
          <textarea
            v-model="notePublicDraft"
            rows="2"
            maxlength="2000"
            class="rounded border border-border bg-field px-2 py-1 text-sm text-text"
          />
        </label>
        <div class="mt-2 flex items-center justify-end gap-2">
          <span class="mr-auto text-xs text-muted">
            Заметки сохранятся при закрытии
          </span>
        </div>
      </div>

      <div class="mt-4 flex justify-end">
        <button
          type="button"
          class="cursor-pointer rounded-lg border border-border bg-bg px-4 py-2 text-sm text-text transition-colors hover:border-primary"
          @click="closeWithSave"
        >
          Закрыть
        </button>
      </div>
    </div>
  </div>
</template>
