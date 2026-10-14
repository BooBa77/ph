<script setup lang="ts">
import { computed, ref } from 'vue'

import { deleteAvatar, uploadAvatar } from '@/api/users'
import { ApiError } from '@/api/errors'
import { useAuthStore } from '@/stores/auth'
import { useProfilePatch } from '@/composables/useProfilePatch'
import EditableField from '@/components/ui/EditableField.vue'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import AvatarCropperModal from '@/components/ui/AvatarCropperModal.vue'
import { canBrowserDecode, looksLikeHeic } from '@/utils/imageDecode'

/**
 * «Профиль» — кто человек: аватарка, имя, город и еда.
 *
 * Спортивный опыт отсюда уехал в свою вкладку (`SportExperience.vue`):
 * девятнадцать списков растягивали страницу, и «Профиль» переставал быть
 * про себя сегодняшнего.
 */
const auth = useAuthStore()
const { error, whileBusy, saveProfile } = useProfilePatch()

const displayName = computed(() => auth.user?.displayName ?? '')
const location = computed(() => auth.user?.location ?? '')
const avatarUrl = computed(() => auth.user?.avatarUrl ?? null)
const isVegetarian = computed(() => auth.user?.isVegetarian ?? false)
const allergies = computed(() => auth.user?.allergies ?? '')

/**
 * Города-подсказки. Показываются, только пока поле пустое: они нужны,
 * чтобы заполнить город в один клик, а не чтобы менять уже выбранный —
 * своего города в списке из трёх всё равно может не оказаться.
 */
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
 * Сохранение displayName.
 *
 * Клиентская валидация лёгкая: не пустая строка, 2–50 символов.
 * Основная валидация — на бэке (regexp). Если бэк вернёт 400 —
 * покажем сообщение.
 */
async function saveDisplayName(value: string) {
  await saveProfile({ displayName: value })
}

/**
 * Сохранение location. Пустая строка → null (очистить).
 *
 * Очистка здесь не украшение: подсказки городов показываются только
 * у пустого поля, а раньше стереть город было нельзя вообще —
 * `EditableField` не отправлял пустое значение, и подсказки не
 * возвращались. Теперь у полей с `allow-empty` это работает.
 */
async function saveLocation(value: string) {
  await saveProfile({ location: value === '' ? null : value })
}

/** Галочка «вегетарианство». Снятая галочка — тоже ответ, а не «не знаю». */
async function saveVegetarian(value: boolean) {
  await saveProfile({ isVegetarian: value })
}

async function onVegetarianChange(event: Event) {
  await saveVegetarian((event.target as HTMLInputElement).checked)
}

/** Аллергии: свободный текст. Пустая строка → null (очистить). */
async function saveAllergies(value: string) {
  await saveProfile({ allergies: value === '' ? null : value })
}

/**
 * Пользователь выбрал файл — проверяем и открываем модалку обрезки.
 *
 * Проверок две. Размер — чтобы не гонять по сети то, что бэкенд всё
 * равно отвергнет. Декодирование — потому что кроппер рисует картинку
 * средствами браузера: нечитаемый файл даст пустой квадрат без
 * объяснений. Чаще всего так выглядит HEIC с айфона, открытый
 * в Chrome или Firefox на компьютере (iOS Safari такой файл
 * конвертирует сам, и до нас доезжает JPEG).
 */
async function onFileSelected(event: Event) {
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

  if (!(await canBrowserDecode(file))) {
    error.value = looksLikeHeic(file)
      ? 'Фотографии в формате HEIC этот браузер показать не может. Сохраните фото как JPEG или загрузите его с телефона.'
      : 'Не удалось прочитать этот файл как изображение. Выберите другое фото.'
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
  <section>
    <h2 class="mb-2 text-xl font-semibold text-text">Профиль</h2>

    <!--
      Линии отделяют разделы друг от друга, а не строки внутри раздела:
      линия после каждой строки ввода читается как «здесь что-то кончилось»,
      хотя список продолжается.
    -->
    <div>
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
          </div>
        </div>
      </div>

      <EditableField
        label="Отображаемое имя"
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
          allow-empty
          placeholder="Введите город"
          @save="saveLocation"
        />

        <!--
          Подсказки городов — только для пустого поля: они помогают
          заполнить город, а не переиграть уже выбранный. Убрать город
          можно кнопкой ниже — тогда подсказки возвращаются.
        -->
        <div v-if="!location" class="flex flex-wrap gap-2 pb-3 md:pl-56">
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

        <div v-else class="pb-3 md:pl-56">
          <button
            type="button"
            class="cursor-pointer rounded-lg px-3 py-1 text-sm text-red-600 transition-colors hover:underline"
            @click="saveLocation('')"
          >
            Убрать
          </button>
        </div>
      </div>
    </div>

    <h2
      class="mt-8 mb-2 border-t border-border pt-6 text-xl font-semibold text-text"
    >
      Пищевые ограничения
    </h2>

    <div>
      <div class="flex flex-col gap-1 py-3 md:flex-row md:items-center md:gap-6">
        <div class="text-sm text-muted md:w-48 md:shrink-0">Вегетарианство</div>

        <label class="flex cursor-pointer items-center gap-2 text-base text-text">
          <input
            type="checkbox"
            class="size-4 cursor-pointer accent-primary"
            :checked="isVegetarian"
            @change="onVegetarianChange"
          />
          <span>Да, я вегетарианец</span>
        </label>
      </div>

      <div>
        <EditableField
          label="Мои аллергии"
          :model-value="allergies"
          :max-length="500"
          allow-empty
          placeholder="Орехи, цитрусовые…"
          empty-text="— нет —"
          @save="saveAllergies"
        />

        <!--
          Единственное поле профиля с кнопкой очистки: список аллергий
          со временем меняется, и «стереть совсем» здесь нужно чаще, чем
          в имени. Пустая строка уходит на бэк как null.
        -->
        <div v-if="allergies" class="pb-3 md:pl-56">
          <button
            type="button"
            class="cursor-pointer rounded-lg px-3 py-1 text-sm text-red-600 transition-colors hover:underline"
            @click="saveAllergies('')"
          >
            Убрать
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
