<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { Cropper } from 'vue-advanced-cropper'
import type { CropperResult } from 'vue-advanced-cropper'
import 'vue-advanced-cropper/dist/style.css'

/**
 * Модалка обрезки аватарки.
 *
 * Пользователь двигает и масштабирует фотографию, выделяет квадрат —
 * наружу уходит готовый blob, уже обрезанный до квадрата. Родитель
 * (PersonalInfo.vue) только отправляет его на бэкенд: сам компонент
 * про API ничего не знает.
 *
 * Почему режем на клиенте, если бэкенд всё равно делает cover-ресайз:
 * пользователь должен видеть, что именно попадёт в аватарку. Бэкенд
 * остаётся страховкой на случай, если пришёл не квадрат.
 *
 * Формат выхода — JPEG q0.9, а не PNG и не WebP: canvas.toBlob с
 * image/webp в Safari долго не поддерживался, а PNG на фотографии
 * даёт в разы больший вес. Бэкенд всё равно перекодирует в WebP.
 */
const props = defineProps<{
  /** Выбранный пользователем файл. */
  file: File
}>()

const emit = defineEmits<{
  /** Готовый обрезанный квадрат. */
  confirm: [blob: Blob]
  /** Пользователь закрыл модалку без сохранения. */
  close: []
}>()

/** Ссылка на исходную картинку в памяти браузера. */
const imageUrl = ref('')

/** Экземпляр кроппера — через него забираем результат. */
const cropper = ref<InstanceType<typeof Cropper> | null>(null)

/** Идёт подготовка blob — блокируем кнопку, чтобы не нажать дважды. */
const isProcessing = ref(false)

/** Не удалось прочитать файл как картинку. */
const error = ref<string | null>(null)

/**
 * object URL вместо base64: файл на 10 МБ в base64 занимает ~13 МБ
 * строки в памяти и в атрибуте src. URL отзываем при закрытии —
 * иначе браузер держит файл до перезагрузки страницы.
 */
watch(
  () => props.file,
  (file) => {
    if (imageUrl.value) URL.revokeObjectURL(imageUrl.value)
    imageUrl.value = URL.createObjectURL(file)
    error.value = null
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value)
})

/**
 * Собрать результат и отдать наружу.
 *
 * `canvas.toBlob` асинхронный и умеет вернуть null, если браузер не смог
 * собрать blob (например, кончилась память) — этот случай надо обработать,
 * иначе родитель получит null вместо картинки.
 */
async function confirmCrop() {
  error.value = null

  const result: CropperResult | undefined = cropper.value?.getResult()
  if (!result?.canvas) {
    error.value = 'Не удалось подготовить изображение. Попробуйте другой файл.'
    return
  }

  const canvas = result.canvas

  isProcessing.value = true
  try {
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.9)
    })

    if (!blob) {
      error.value = 'Не удалось подготовить изображение. Попробуйте другой файл.'
      return
    }

    emit('confirm', blob)
  } finally {
    isProcessing.value = false
  }
}

/** Отмена: закрываем модалку, ничего не отправляя. */
function cancel() {
  emit('close')
}
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    role="dialog"
    aria-modal="true"
    aria-label="Обрезка аватарки"
    @click.self="cancel"
  >
    <div class="w-full max-w-lg rounded-2xl bg-surface p-4 shadow-xl">
      <h2 class="mb-3 text-lg font-semibold text-text">Аватарка</h2>

      <p class="mb-3 text-sm text-muted">
        Двигайте фото и меняйте масштаб, чтобы выбрать, что попадёт в круг.
      </p>

      <!--
        aspect-square у контейнера не случаен: кроппер растягивается
        по родителю, и если родитель прямоугольный, то и рабочая
        область будет прямоугольной. Квадрат нужен, чтобы выделение
        1:1 занимало всю область.
      -->
      <div class="relative aspect-square w-full overflow-hidden rounded-xl bg-bg">
        <Cropper
          v-if="imageUrl"
          ref="cropper"
          class="h-full w-full"
          :src="imageUrl"
          :stencil-props="{ aspectRatio: 1 }"
          :resize-image="{ touch: true, wheel: true }"
          image-restriction="stencil"
        />
      </div>

      <p v-if="error" class="mt-3 text-sm text-red-600">{{ error }}</p>

      <div class="mt-4 flex justify-end gap-2">
        <button
          type="button"
          :disabled="isProcessing"
          class="cursor-pointer rounded-lg border border-border bg-bg px-4 py-2 text-sm text-text transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
          @click="cancel"
        >
          Отмена
        </button>
        <button
          type="button"
          :disabled="isProcessing"
          class="cursor-pointer rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          @click="confirmCrop"
        >
          {{ isProcessing ? 'Готовим…' : 'Сохранить' }}
        </button>
      </div>
    </div>
  </div>
</template>
