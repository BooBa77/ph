<script setup lang="ts">
import { computed, ref, watch } from 'vue'

/**
 * Кружок с аватаркой пользователя.
 *
 * Если аватарки нет — показываем дефолтную картинку из public.
 * Дефолт лежит на фронте, а не отдаётся бэком: в базе при этом честный
 * `avatar_url = null`, и лишнего запроса на каждую отрисовку шапки
 * не возникает. Когда появится нативное приложение, у него будет своя
 * дефолтная картинка — и это нормально, дефолт не часть данных
 * пользователя.
 *
 * Компонент, а не дублирование разметки в шапке и в личном кабинете:
 * у кружка есть мелочи, которые легко разъедутся, — размеры, обрезка,
 * alt, запасное изображение, Retina.
 *
 * Про Retina (`srcset`): дефолт сгенерирован в трёх размерах —
 * 96, 192 и 512 px (scripts/generate-assets.py). Браузер сам выберет
 * нужный по плотности экрана: на обычном мониторе возьмёт файл вдвое
 * больше показываемого размера, на Retina — втрое. Без `srcset`
 * пришлось бы либо отдавать всем 512 px, либо показывать на Retina
 * мыло. У загруженной пользователем аватарки вариант один: бэкенд
 * хранит готовый webp 150×150, апскейлить его нечем.
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

/** Набор размеров дефолта. Меняется вместе с scripts/generate-assets.py. */
const DEFAULT_SIZES = [96, 192, 512]
const DEFAULT_SRC = '/img/avatar-default-192.png'

/**
 * Источник картинки: либо аватарка пользователя, либо null — тогда дефолт.
 *
 * Локальная копия, а не чтение props напрямую, нужна ради сбоя загрузки:
 * если файл аватарки не открылся (том пересоздали, связь в базе повисла),
 * показываем дефолт вместо «битой картинки». Править `src` в DOM напрямую
 * нельзя — Vue перезапишет атрибут при следующей перерисовке, и ошибка
 * вернётся.
 */
const broken = ref(false)

const isDefault = computed(() => !props.src || broken.value)
const imageSrc = computed(() => (isDefault.value ? DEFAULT_SRC : props.src!))

const srcset = computed(() =>
  isDefault.value
    ? DEFAULT_SIZES.map((width) => `/img/avatar-default-${width}.png ${width}w`).join(
        ', ',
      )
    : undefined,
)

// Сменили аватарку — сбрасываем отметку о сбое: новый файл может открыться.
watch(
  () => props.src,
  () => {
    broken.value = false
  },
)
</script>

<template>
  <img
    :src="imageSrc"
    :srcset="srcset"
    :sizes="`${size}px`"
    :alt="alt"
    :width="size"
    :height="size"
    class="shrink-0 rounded-full object-cover"
    :style="{ width: `${size}px`, height: `${size}px` }"
    @error="broken = true"
  />
</template>
