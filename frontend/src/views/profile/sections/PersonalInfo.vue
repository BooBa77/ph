<script setup lang="ts">
import { computed, ref } from 'vue'

import { deleteAvatar, updateMe, uploadAvatar } from '@/api/users'
import { ApiError } from '@/api/errors'
import { useAuthStore } from '@/stores/auth'
import { useAppStore } from '@/stores/app'
import EditableField from '@/components/ui/EditableField.vue'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import AvatarCropperModal from '@/components/ui/AvatarCropperModal.vue'

const auth = useAuthStore()
const appStore = useAppStore()

/** Ошибка последнего сохранения (для отображения под полем). */
const error = ref<string | null>(null)

const displayName = computed(() => auth.user?.displayName ?? '')
const location = computed(() => auth.user?.location ?? '')
const avatarUrl = computed(() => auth.user?.avatarUrl ?? null)
const SUGGESTED_CITIES = ['Иркутск', 'Ангарск', 'Усолье-Сибирское']

/** Ссылка на скрытый input: открываем системный выбор файла. */
const fileInput = ref<HTMLInputElement | null>(null)

/** Файл, выбранный пользователем, — показывается в модалке обрезки. */
const pendingFile = ref<File | null>(null)

/** Идёт загрузка или сброс — блокируем кнопки, чтобы не нажать дважды. */
const isSavingAvatar = ref(false)

/**
 * Максимальный размер, который принимает бэкенд. Проверяем и на клиенте:
 * без этого пользователь выберет 40 МБ, дождётся загрузки по сети и
 * получит отказ. Быстрый отказ лучше.
 */
const MAX_AVATAR_BYTES = 10 * 1024 * 1024

/**
 * Выполнить запрос, удерживая счётчик занятости.
 *
 * Без этого остаётся дыра: правку пользователь закончил, EditableField
 * освободил счётчик, а запрос на сохранение ещё летит — и PWA-обновление
 * может перезагрузить страницу прямо посреди него, потеряв изменение.
 * Кнопки с городами вообще сохраняют без редактирования, поэтому им
 * счётчик нужен не меньше.
 */
async function whileBusy<T>(action: () => Promise<T>): Promise<T> {
  appStore.setBusy(true)
  try {
    return await action()
  } finally {
    appStore.setBusy(false)
  }
}

/**
 * Сохранение displayName.
 *
 * Клиентская валидация лёгкая: не пустая строка, 2–50 символов.
 * Основная валидация — на бэке (regexp). Если бэк вернёт 400 —
 * покажем сообщение.
 */
async function saveDisplayName(value: string) {
  error.value = null
  try {
    const updated = await whileBusy(() => updateMe({ displayName: value }))
    auth.setUser(updated)
  } catch (e) {
    if (e instanceof ApiError) {
      error.value = e.message
    } else {
      error.value = 'Не удалось сохранить. Попробуйте ещё раз.'
    }
  }
}

/** Сохранение location. Пустая строка → null (очистить). */
async function saveLocation(value: string) {
  error.value = null
  try {
    const newValue = value === '' ? null : value
    const updated = await whileBusy(() => updateMe({ location: newValue }))
    auth.setUser(updated)
  } catch (e) {
    if (e instanceof ApiError) {
      error.value = e.message
    } else {
      error.value = 'Не удалось сохранить. Попробуйте ещё раз.'
    }
  }
}

/**
 * Пользователь выбрал файл — открываем модалку обрезки.
 *
 * Файл никуда не отправляется, пока пользователь не подтвердит кроп:
 * сначала он должен увидеть, что попадёт в аватарку.
 */
function onFileSelected(event: Event) {
  error.value = null

  const input = event.target as HTMLInputElement
  const file = input.files?.[0]

  // input сразу очищаем: иначе повторный выбор того же файла не вызовет
  // change, и кнопка «Изменить» перестанет работать. Сам файл остаётся
  // жив в `file` — ссылка на него уже получена.
  input.value = ''

  if (!file) return

  if (file.size > MAX_AVATAR_BYTES) {
    const megabytes = Math.round(MAX_AVATAR_BYTES / (1024 * 1024))
    error.value = `Файл больше ${megabytes} МБ. Выберите фото поменьше.`
    return
  }

  pendingFile.value = file
}

/**
 * Пользователь подтвердил кроп — отправляем готовый квадрат.
 *
 * Модалку закрываем только после успеха: если загрузка упала, он
 * останется на месте и сможет выбрать область заново, не начиная
 * с выбора файла.
 */
async function saveAvatar(blob: Blob) {
  error.value = null
  try {
    const updated = await whileBusy(async () => {
      isSavingAvatar.value = true
      try {
        return await uploadAvatar(blob)
      } finally {
        isSavingAvatar.value = false
      }
    })
    auth.setUser(updated)
    pendingFile.value = null
  } catch (e) {
    error.value =
      e instanceof ApiError
        ? e.message
        : 'Не удалось загрузить аватарку. Попробуйте ещё раз.'
  }
}

/** Сбросить аватарку: на бэке avatar_url = null, файл удаляется. */
async function removeAvatar() {
  error.value = null
  try {
    const updated = await whileBusy(async () => {
      isSavingAvatar.value = true
      try {
        return await deleteAvatar()
      } finally {
        isSavingAvatar.value = false
      }
    })
    auth.setUser(updated)
  } catch (e) {
    error.value =
      e instanceof ApiError
        ? e.message
        : 'Не удалось убрать аватарку. Попробуйте ещё раз.'
  }
}
</script>

<template>
  <section>    <h2 class="mb-2 text-xl font-semibold text-text">Профиль</h2>

    <div class="divide-y divide-border">
      <!-- Аватарка -->
      <div class="flex flex-col gap-3 py-3 md:flex-row md:items-center md:gap-6">
        <div class="text-sm text-muted md:w-48 md:shrink-0">Аватарка</div>

        <div class="flex items-center gap-4">
          <UserAvatar :src="avatarUrl" :size="80" alt="Ваша аватарка" />

          <div class="flex flex-col gap-2">
            <input
              ref="fileInput"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              class="hidden"
              @change="onFileSelected"
            />

            <button
              type="button"
              :disabled="isSavingAvatar"
              class="w-fit cursor-pointer rounded-lg border border-border bg-surface px-3 py-1 text-sm text-text transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
              @click="fileInput?.click()"
            >
              {{ avatarUrl ? 'Изменить' : 'Загрузить' }}
            </button>

            <button
              v-if="avatarUrl"
              type="button"
              :disabled="isSavingAvatar"
              class="w-fit cursor-pointer rounded-lg px-3 py-1 text-sm text-red-600 transition-colors hover:underline disabled:cursor-not-allowed disabled:opacity-50"
              @click="removeAvatar"
            >
              Убрать
            </button>

            <p class="text-xs text-muted">JPEG, PNG или WebP, до 10 МБ</p>
          </div>
        </div>
      </div>

      <EditableField
        label="Имя пользователя"
        :model-value="displayName"
        :min-length="2"
        :max-length="50"
        placeholder="Введите имя"
        @save="saveDisplayName"
      />

      <div>
        <EditableField
          label="Город"
          :model-value="location"
          :max-length="100"
          placeholder="Введите город"
          @save="saveLocation"
        />

        <div class="flex flex-wrap gap-2 pb-3 md:pl-56">
          <button
            v-for="city in SUGGESTED_CITIES"
            :key="city"
            type="button"
            class="cursor-pointer rounded-lg border border-border bg-surface px-3 py-1 text-sm text-text transition-colors hover:border-primary"
            @click="saveLocation(city)"
          >
            {{ city }}
          </button>
        </div>
      </div>
    </div>

    <p v-if="error" class="mt-4 text-sm text-red-600">
      {{ error }}
    </p>

    <!--
      Модалка обрезки. Появляется, когда файл выбран и ещё не сохранён.
      @close — отмена: файл забываем, ничего не отправляя.
    -->
    <AvatarCropperModal
      v-if="pendingFile"
      :file="pendingFile"
      @confirm="saveAvatar"
      @close="pendingFile = null"
    />
  </section>
</template>
