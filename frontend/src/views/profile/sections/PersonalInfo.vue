
<script setup lang="ts">
import { computed } from 'vue'

import { useAuthStore } from '@/stores/auth'
import { formatBirthDate, formatOrDash } from '@/utils/date'

const auth = useAuthStore()

/**
 * Список полей для отображения. Каждое — объект с меткой и значением.
 * computed: если auth.user поменяется (после редактирования),
 * список пересчитается автоматически.
 */
const fields = computed(() => {
  const user = auth.user
  if (!user) return []

  return [
    { label: 'Имя пользователя', value: formatOrDash(user.displayName) },
    { label: 'Никнейм', value: formatOrDash(user.nickname) },
    { label: 'Имя', value: formatOrDash(user.firstName) },
    { label: 'Фамилия', value: formatOrDash(user.lastName) },
    { label: 'Город', value: formatOrDash(user.location) },
    { label: 'Дата рождения', value: formatBirthDate(user.birthDate) },
  ]
})
</script>

<template>
  <section>
    <h2 class="mb-6 text-xl font-semibold text-text">Профиль</h2>

    <dl class="divide-y divide-border">
      <div
        v-for="field in fields"
        :key="field.label"
        class="flex flex-col gap-1 py-3 md:flex-row md:items-center md:gap-6"
      >
        <dt class="text-sm text-muted md:w-48 md:shrink-0">
          {{ field.label }}
        </dt>
        <dd class="text-base text-text">
          {{ field.value }}
        </dd>
      </div>
    </dl>
  </section>
</template>