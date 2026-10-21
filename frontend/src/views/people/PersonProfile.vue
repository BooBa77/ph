<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import { ApiError } from '@/api/errors'
import { getPublicUser, type PublicUser } from '@/api/users'
import UserAvatar from '@/components/ui/UserAvatar.vue'

/**
 * Публичный профиль человека: имя, город и «на сайте с».
 *
 * **Чего здесь нет и почему.** Ни аллергий, ни спортивного опыта, ни
 * телефона: это личное, и человек показывает его сам — в своём профиле.
 * Чужой профиль отвечает на вопрос «кто это», а не «что у него со
 * здоровьем».
 *
 * Кнопки «Написать» пока нет: личные диалоги API умеет (`POST
 * /api/conversations/direct`), но экрана сообщений на фронте ещё нет,
 * и кнопка, ведущая в никуда, хуже её отсутствия.
 *
 * Для себя (`isSelf`) показываем ссылку в свой профиль: человек часто
 * попадает сюда из участников похода и хочет поправить, что видно другим.
 */
const route = useRoute()

const person = ref<PublicUser | null>(null)
const isLoading = ref(true)
const error = ref<string | null>(null)

const MONTH_YEAR = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' })

/** «На сайте с марта 2026 года». */
const memberSince = computed(() => {
  if (!person.value) return ''

  const date = new Date(person.value.createdAt)
  return Number.isNaN(date.getTime()) ? '' : MONTH_YEAR.format(date)
})

async function load(id: string) {
  isLoading.value = true
  error.value = null

  try {
    person.value = await getPublicUser(id)
  } catch (problem) {
    error.value =
      problem instanceof ApiError && problem.status === 404
        ? 'Человек не найден'
        : 'Не удалось загрузить профиль'
    person.value = null
  } finally {
    isLoading.value = false
  }
}

watch(
  () => route.params.id,
  (id) => {
    if (typeof id === 'string') void load(id)
  },
  { immediate: true },
)
</script>

<template>
  <section data-test="person">
    <RouterLink
      :to="{ name: 'people' }"
      class="mb-4 inline-block text-sm text-muted underline transition-colors hover:text-text"
      data-test="person-back"
    >
      ← Контакты
    </RouterLink>

    <p v-if="isLoading" class="text-sm text-muted" data-test="person-loading">
      Загружаем профиль…
    </p>

    <p v-else-if="error" class="text-sm text-muted" data-test="person-error">{{ error }}</p>

    <div v-else-if="person" class="flex flex-col gap-4">
      <div class="flex items-center gap-4">
        <UserAvatar :src="person.avatarUrl" :alt="person.displayName" :size="96" />

        <div class="flex min-w-0 flex-col gap-1">
          <h1 class="truncate text-2xl font-bold text-text" data-test="person-name">
            {{ person.displayName }}
          </h1>

          <p v-if="person.location" class="text-sm text-text" data-test="person-location">
            {{ person.location }}
          </p>

          <p v-if="memberSince" class="text-sm text-muted" data-test="person-since">
            На сайте с {{ memberSince }}
          </p>
        </div>
      </div>

      <RouterLink
        v-if="person.isSelf"
        :to="{ name: 'profile-personal' }"
        class="self-start rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text no-underline transition-colors hover:border-primary"
        data-test="person-self-link"
      >
        Это вы — открыть свой профиль
      </RouterLink>
    </div>
  </section>
</template>
