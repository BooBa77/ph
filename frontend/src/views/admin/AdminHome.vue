<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

import { useAuthStore } from '@/stores/auth'

/**
 * Админка — оглавление разделов.
 *
 * Решение заказчика 30.10.2026: в общем меню появился пункт «Админка».
 * Ведёт он сюда, а не сразу в один из экранов: админских экранов два
 * («Типы снаряжения» и «Модерация иконок») и будет больше, а меню не должно
 * расти вместе с ними. Новый экран — строка в `ADMIN_SECTIONS` и маршрут
 * в `router/index.ts`.
 *
 * **Права.** Пункт меню виден только админу (`user.isAdmin`), и это же поле
 * проверяется здесь: человек, набравший `/admin` руками, увидит сообщение
 * вместо списка. Пускает всё равно сервер — каждый экран отдельно отвечает
 * чужим 403, — а этот текст существует затем, чтобы адрес не выглядел
 * сломанным.
 */
const auth = useAuthStore()

interface AdminSectionLink {
  to: string
  title: string
  description: string
}

/**
 * Разделы админки в порядке показа.
 *
 * Подписи — те же, что в заголовках экранов: человек ищет в меню то слово,
 * которое потом видит на странице.
 */
const ADMIN_SECTIONS: readonly AdminSectionLink[] = [
  {
    to: '/admin/gear',
    title: 'Типы снаряжения',
    description:
      'Справочник типов и характеристик: палатка, спальник, топор. Обязательные значения, единицы измерения, списки вариантов, архив.',
  },
  {
    to: '/admin/activities',
    title: 'Модерация иконок',
    description:
      'Заявки на новые иконки активностей и все варианты иконок — включая погашенные, то есть ещё не нарисованные.',
  },
]

const isAdmin = computed(() => auth.user?.isAdmin === true)
</script>

<template>
  <!-- Внешний контейнер даёт общий каркас приложения (App.vue) -->
  <main>
    <h1 class="text-2xl font-bold text-text">Админка</h1>

    <template v-if="isAdmin">
      <p class="mt-2 text-sm text-muted">
        Разделы, которые видит только администратор. Остальным их не показывает меню, а на
        запрос сервер отвечает отказом.
      </p>

      <ul class="mt-6 grid gap-3 sm:grid-cols-2" data-test="admin-sections">
        <li v-for="section in ADMIN_SECTIONS" :key="section.to">
          <RouterLink
            :to="section.to"
            class="block h-full rounded-xl border border-border bg-surface p-4 text-text no-underline transition-colors hover:border-primary"
            data-test="admin-section"
          >
            <span class="block text-base font-medium">{{ section.title }}</span>
            <span class="mt-1 block text-sm text-muted">{{ section.description }}</span>
          </RouterLink>
        </li>
      </ul>
    </template>

    <!--
      Не админу показываем тот же текст, что отвечает сервер на админские
      ручки: адрес открыт, но делать здесь нечего. Молчаливый пустой список
      читался бы как «сломалось».
    -->
    <p v-else class="mt-3 text-sm text-red-600" data-test="admin-forbidden">
      Раздел только для администратора.
    </p>
  </main>
</template>
