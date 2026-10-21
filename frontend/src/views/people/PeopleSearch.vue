<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'

import { searchUsers, type UserSearchResult } from '@/api/users'
import UserAvatar from '@/components/ui/UserAvatar.vue'

/**
 * «Контакты» — поиск людей.
 *
 * **Почему поиск, а не список всех.** Людей немного, но «простыня»
 * из всех не помогает найти нужного: искать по имени быстрее и точнее.
 * Тот же принцип, что у справочника объектов и продуктов. Поэтому пустой
 * запрос ничего не показывает, а сервер отвечает пустым списком.
 *
 * Минимальная длина — два символа: одна буква найдёт пол-сайта, и такое
 * «приглашение» ничего не выбирает. До порога запрос не отправляется.
 *
 * Карточка ведёт в публичный профиль (`/people/:id`) — там город и «на
 * сайте с». Себя сервер из выдачи убирает: искать себя незачем.
 */
const MIN_LENGTH = 2

/** Пауза перед поиском: на каждую букву ходить в сервер незачем. */
const SEARCH_DELAY_MS = 300

const query = ref('')
const results = ref<UserSearchResult[]>([])
const isLoading = ref(false)
const error = ref<string | null>(null)

let searchTimer: ReturnType<typeof setTimeout> | undefined

async function search() {
  const text = query.value.trim()

  if (text.length < MIN_LENGTH) {
    results.value = []
    error.value = null
    return
  }

  isLoading.value = true
  error.value = null

  try {
    results.value = await searchUsers(text)
  } catch {
    error.value = 'Не удалось выполнить поиск.'
    results.value = []
  } finally {
    isLoading.value = false
  }
}

watch(query, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(search, SEARCH_DELAY_MS)
})

onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer)
})
</script>

<template>
  <section data-test="people">
    <h2 class="mb-2 text-xl font-semibold text-text">Контакты</h2>

    <p class="mb-4 text-sm text-muted">
      Найдите человека по имени — чтобы пригласить в поход или посмотреть профиль.
    </p>

    <input
      v-model="query"
      type="search"
      placeholder="Имя: «Иван»"
      class="mb-3 w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none"
      data-test="people-search"
    />

    <p v-if="error" class="mb-3 text-sm text-red-600" data-test="people-error">{{ error }}</p>

    <p v-if="isLoading" class="text-sm text-muted" data-test="people-loading">Ищем…</p>

    <ul v-else-if="results.length > 0" class="flex flex-col gap-2" data-test="people-list">
      <li v-for="person in results" :key="person.id">
        <RouterLink
          :to="{ name: 'person', params: { id: person.id } }"
          class="flex items-center gap-3 rounded-xl border border-border bg-surface p-3 no-underline transition-colors hover:border-primary"
          data-test="people-option"
        >
          <UserAvatar :src="person.avatarUrl" :alt="person.displayName" :size="40" />

          <span class="min-w-0 flex-1 truncate text-sm text-text">{{ person.displayName }}</span>
        </RouterLink>
      </li>
    </ul>

    <p
      v-else-if="query.trim().length >= MIN_LENGTH"
      class="text-sm text-muted"
      data-test="people-nothing"
    >
      Никого не нашлось. Имена чувствительны к опечаткам — попробуйте часть имени.
    </p>

    <p v-else class="text-sm text-muted" data-test="people-hint">
      Начните вводить имя — от двух символов.
    </p>
  </section>
</template>
