<script setup lang="ts">
import { ref, watch } from 'vue'

/**
 * Кружок с аватаркой пользователя.
 *
 * Если аватарки нет — показываем дефолтную картинку из public.
 * Дефолт лежит на фронте, а не отдаётся бэком: в базе при этом
 * честный `avatar_url = null`, и лишнего запроса на каждую отрисовку
 * шапки не возникает. Когда появится нативное приложение, у него
 * будет своя дефолтная картинка — и это нормально, дефолт не часть
 * данных пользователя.
 *
 * Компонент, а не дублирование разметки в шапке и в личном кабинете:
 * у кружка есть мелочи, которые легко разъедутся, — размеры, обрезка,
 * alt, запасное изображение.
 */
const props = withDefaults(
  defineProps<{
    /** URL аватарки или null. */
    src?: string | null
    /** Сторона кружка в пикселях. */
    size?: number
    /** Подпись для alt. */
    alt?: string
  }>(),
  {
    src: null,
    size: 40,
    alt: 'Аватарка',
  },
)

const DEFAULT_AVATAR = '/img/avatar-default.png'

/**
 * Что реально показываем.
 *
 * Локальная копия нужна, чтобы обработать сбой загрузки: если файл
 * аватарки не открылся (например, том пересоздали и связь в базе
 * повисла), показываем дефолт вместо «битой картинки». Править `src`
 * в DOM напрямую нельзя — Vue перезапишет атрибут при следующей
 * перерисовке, и ошибка вернётся.
 */
const currentSrc = ref(props.src ?? DEFAULT_AVATAR)

watch(
  () => props.src,
  (next) => {
    currentSrc.value = next ?? DEFAULT_AVATAR
  },
)

function onError() {
  currentSrc.value = DEFAULT_AVATAR
}
</script>

<template>
  <img
    :src="currentSrc"
    :alt="alt"
    :width="size"
    :height="size"
    class="shrink-0 rounded-full object-cover"
    :style="{ width: `${size}px`, height: `${size}px` }"
    @error="onError"
  />
</template>
