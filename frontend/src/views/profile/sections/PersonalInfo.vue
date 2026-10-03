<script setup lang="ts">
import { computed, ref } from 'vue'

import { updateMe } from '@/api/users'
import { ApiError } from '@/api/errors'
import { useAuthStore } from '@/stores/auth'
import EditableField from '@/components/ui/EditableField.vue'

const auth = useAuthStore()

/** Ошибка последнего сохранения (для отображения под полем). */
const error = ref<string | null>(null)

const displayName = computed(() => auth.user?.displayName ?? '')
const location = computed(() => auth.user?.location ?? '')
const SUGGESTED_CITIES = ['Иркутск', 'Ангарск', 'Усолье-Сибирское']

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
    const updated = await updateMe({ displayName: value })
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
    const updated = await updateMe({ location: newValue })
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