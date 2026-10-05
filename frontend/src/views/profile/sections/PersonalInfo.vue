<script setup lang="ts">
import { computed, ref } from 'vue'

import { updateMe } from '@/api/users'
import { ApiError } from '@/api/errors'
import { useAuthStore } from '@/stores/auth'
import { useAppStore } from '@/stores/app'
import EditableField from '@/components/ui/EditableField.vue'

const auth = useAuthStore()
const appStore = useAppStore()

/** Ошибка последнего сохранения (для отображения под полем). */
const error = ref<string | null>(null)

const displayName = computed(() => auth.user?.displayName ?? '')
const location = computed(() => auth.user?.location ?? '')
const SUGGESTED_CITIES = ['Иркутск', 'Ангарск', 'Усолье-Сибирское']

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
</script>

<template>
  <section>
    <h2 class="mb-2 text-xl font-semibold text-text">Профиль</h2>

    <div class="divide-y divide-border">
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
  </section>
</template>