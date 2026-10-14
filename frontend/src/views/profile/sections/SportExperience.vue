<script setup lang="ts">
import { computed } from 'vue'

import SelectField from '@/components/ui/SelectField.vue'
import { useProfilePatch } from '@/composables/useProfilePatch'
import { useAuthStore } from '@/stores/auth'
import {
  ALPINISM_RANKS,
  MOUNTAIN_CATEGORIES,
  SKYRUNNING_RANKS,
  TOURISM_CATEGORIES,
  TOURISM_DISCIPLINES,
  TOURISM_DISCIPLINE_RESULTS,
  TOURISM_KINDS,
  TOURISM_RANKS,
  type AlpinismRank,
  type MountainCategory,
  type SkyrunningRank,
  type TourismCategory,
  type TourismDiscipline,
  type TourismDisciplineResult,
  type TourismKind,
  type TourismRank,
} from '@/types/sportExperience'

/**
 * Спортивный опыт — отдельная вкладка кабинета.
 *
 * Раньше жил внизу «Профиля»: девятнадцать списков растягивали страницу
 * так, что до возраста и аллергий приходилось листать экран-другой, а
 * «Профиль» переставал быть про себя сегодняшнего. Теперь это про то,
 * что человек прошёл, и лежит отдельно.
 */
const auth = useAuthStore()
const { error, saveProfile } = useProfilePatch()

/**
 * Спортивный опыт. null — пользователь ещё ничего не заполнял:
 * строки в user_sport_experience нет, все списки показывают «— нет —».
 */
const experience = computed(() => auth.user?.sportExperience ?? null)
const alpinism = computed(() => experience.value?.alpinism ?? null)
const skyrunning = computed(() => experience.value?.skyrunning ?? null)
const tourism = computed(() => experience.value?.sportTourism ?? null)

// ─── Спортивный опыт ───
//
// Каждый обработчик шлёт только своё поле: PATCH на бэке частичный, и
// выбор в одном списке не должен стирать остальные значения.

async function saveAlpinismRank(value: AlpinismRank | null) {
  await saveProfile({ sportExperience: { alpinism: { rank: value } } })
}

async function saveAlpinismParticipation(value: MountainCategory | null) {
  await saveProfile({
    sportExperience: { alpinism: { maxParticipation: value } },
  })
}

async function saveAlpinismLeadership(value: MountainCategory | null) {
  await saveProfile({ sportExperience: { alpinism: { maxLeadership: value } } })
}

/** Жетон «Спасение в горах»: галочка, а не выпадающий список. */
async function saveRescueToken(value: boolean) {
  await saveProfile({ sportExperience: { alpinism: { rescueToken: value } } })
}

async function onRescueTokenChange(event: Event) {
  await saveRescueToken((event.target as HTMLInputElement).checked)
}

async function saveSkyrunningRank(value: SkyrunningRank | null) {
  await saveProfile({ sportExperience: { skyrunning: { rank: value } } })
}

async function saveTourismRank(value: TourismRank | null) {
  await saveProfile({ sportExperience: { sportTourism: { rank: value } } })
}

async function saveTourismCategory(
  kind: TourismKind,
  value: TourismCategory | null,
) {
  // Собираем объект, а не пишем computed-ключ в литерале: так тип
  // остаётся `Partial<Record<TourismKind, ...>>`, а не «любая строка».
  const maxCategories: Partial<Record<TourismKind, TourismCategory | null>> = {}
  maxCategories[kind] = value

  await saveProfile({ sportExperience: { sportTourism: { maxCategories } } })
}

async function saveTourismDiscipline(
  discipline: TourismDiscipline,
  value: TourismDisciplineResult | null,
) {
  const disciplines: Partial<
    Record<TourismDiscipline, TourismDisciplineResult | null>
  > = {}
  disciplines[discipline] = value

  await saveProfile({ sportExperience: { sportTourism: { disciplines } } })
}
</script>

<template>
  <section>
    <h2 class="mb-2 text-xl font-semibold text-text">Спортивный опыт</h2>

    <p class="mb-2 text-sm text-muted">
      Заполняется по разрядным требованиям: отметьте то, что уже выполнено.
      Пустая строка списка — «нет».
    </p>

    <h3
      class="mt-8 mb-1 border-t border-border pt-6 text-base font-medium text-text"
    >
      Альпинизм и скайраннинг
    </h3>

    <div>
      <SelectField
        label="Разряд или звание"
        :model-value="alpinism?.rank ?? null"
        :options="ALPINISM_RANKS"
        @change="saveAlpinismRank"
      />

      <SelectField
        label="Наивысшая категория в качестве участника"
        :model-value="alpinism?.maxParticipation ?? null"
        :options="MOUNTAIN_CATEGORIES"
        @change="saveAlpinismParticipation"
      />

      <SelectField
        label="Наивысшая категория в качестве руководителя"
        :model-value="alpinism?.maxLeadership ?? null"
        :options="MOUNTAIN_CATEGORIES"
        @change="saveAlpinismLeadership"
      />

      <!--
        Жетон — галочка, а не список: «Спасение в горах» либо есть, либо нет.
        Отдельного варианта «нет» в списках не заводим, поэтому здесь
        снятая галочка и есть «нет».
      -->
      <div class="flex flex-col gap-1 py-3 md:flex-row md:items-center md:gap-6">
        <div class="text-sm text-muted md:w-48 md:shrink-0">
          Жетон «Спасение в горах»
        </div>

        <label class="flex cursor-pointer items-center gap-2 text-base text-text">
          <input
            type="checkbox"
            class="size-4 cursor-pointer accent-primary"
            :checked="alpinism?.rescueToken ?? false"
            @change="onRescueTokenChange"
          />
          <span>Участвовал в спасательных работах</span>
        </label>
      </div>

      <SelectField
        label="Скайраннинг: разряд"
        :model-value="skyrunning?.rank ?? null"
        :options="SKYRUNNING_RANKS"
        @change="saveSkyrunningRank"
      />
    </div>

    <h3
      class="mt-8 mb-1 border-t border-border pt-6 text-base font-medium text-text"
    >
      Спортивный туризм
    </h3>

    <div>
      <SelectField
        label="Разряд или звание"
        :model-value="tourism?.rank ?? null"
        :options="TOURISM_RANKS"
        @change="saveTourismRank"
      />
    </div>

    <p class="mt-4 mb-1 text-sm text-muted">
      Максимальные категории сложности пройденных походов по видам туризма:
    </p>

    <div>
      <SelectField
        v-for="kind in TOURISM_KINDS"
        :key="kind.key"
        :label="kind.label"
        :model-value="tourism?.maxCategories[kind.key] ?? null"
        :options="TOURISM_CATEGORIES"
        @change="saveTourismCategory(kind.key, $event)"
      />
    </div>

    <p class="mt-4 mb-1 text-sm text-muted">
      Выполненные нормативы в дисциплинах группы «дистанция»:
    </p>

    <div>
      <SelectField
        v-for="discipline in TOURISM_DISCIPLINES"
        :key="discipline.key"
        :label="discipline.label"
        :model-value="tourism?.disciplines[discipline.key] ?? null"
        :options="TOURISM_DISCIPLINE_RESULTS"
        @change="saveTourismDiscipline(discipline.key, $event)"
      />
    </div>

    <p v-if="error" class="mt-4 text-sm text-red-600">
      {{ error }}
    </p>
  </section>
</template>
