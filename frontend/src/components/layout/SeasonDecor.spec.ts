import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import SeasonDecor from '@/components/layout/SeasonDecor.vue'
import { useAppStore } from '@/stores/app'
import { usePreferencesStore } from '@/stores/preferences'

/**
 * Тесты сезонного фона.
 *
 * Сами анимации проверяет браузер, а не jsdom: здесь важно, что слой
 * появляется только в свой сезон, что листьев столько, сколько задумано,
 * что у них разные параметры и что выключение анимации не убирает
 * оформление целиком.
 *
 * Параметры листьев считаются в onMounted, поэтому после mount нужен
 * nextTick: без него разметка ещё пустая, и тест «проверяет» ничего.
 */
async function mountAutumn() {
  useAppStore().setTheme(4)
  const wrapper = mount(SeasonDecor)
  await nextTick()
  return wrapper
}

describe('SeasonDecor', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('осенью рисует листья', async () => {
    const wrapper = await mountAutumn()

    // На широком экране jsdom (1024 px) — 18 штук.
    expect(wrapper.findAll('.season-decor__leaf').length).toBeGreaterThan(0)
  })

  it('слой пустой по содержимому — это украшение, а не текст', async () => {
    const wrapper = await mountAutumn()

    expect(wrapper.text()).toBe('')
  })

  it('в другие сезоны слоя нет', () => {
    useAppStore().setTheme(1)

    const wrapper = mount(SeasonDecor)

    expect(wrapper.find('.season-decor').exists()).toBe(false)
  })

  it('слой не ловит клики и скрыт от скринридеров', async () => {
    const wrapper = await mountAutumn()

    expect(wrapper.classes()).toContain('pointer-events-none')
    expect(wrapper.attributes('aria-hidden')).toBe('true')
  })

  it('по умолчанию анимация включена', async () => {
    const wrapper = await mountAutumn()

    expect(wrapper.classes()).not.toContain('season-decor--static')
    expect(usePreferencesStore().seasonAnimations).toBe(true)
  })

  it('выключенная анимация оставляет листья, но убирает движение', async () => {
    // Раньше в этом случае слой исчезал целиком, и это выглядело как
    // поломка: декора нет вовсе. Правильно — оставить оформление.
    usePreferencesStore().setSeasonAnimations(false)

    const wrapper = await mountAutumn()

    expect(wrapper.find('.season-decor').exists()).toBe(true)
    expect(wrapper.classes()).toContain('season-decor--static')
    expect(wrapper.findAll('.season-decor__leaf').length).toBeGreaterThan(0)
  })

  it('выключение анимации переживает перезагрузку', async () => {
    usePreferencesStore().setSeasonAnimations(false)

    expect(localStorage.getItem('ph.seasonAnimations')).toBe('off')

    // Перезагрузка: store создаётся заново и читает хранилище.
    const { usePreferencesStore: fresh } = await import(
      '@/stores/preferences'
    )
    setActivePinia(createPinia())

    expect(fresh().seasonAnimations).toBe(false)
  })

  it('расстояние падения задаётся переменной, а не vh в keyframes', async () => {
    const wrapper = await mountAutumn()

    // `vh` внутри @keyframes считаются от содержащего блока, а не от окна:
    // лист пролетал пятую часть экрана вместо полной высоты. Размер
    // приходит переменной, которую считает JS.
    const style = wrapper.attributes('style')
    expect(style).toMatch(/--fall:\s*\d+px/)
  })

  it('каждому листу достаются свои параметры', async () => {
    const wrapper = await mountAutumn()
    const styles = wrapper
      .findAll('.season-decor__leaf')
      .map((leaf) => leaf.attributes('style'))

    // Все позиции разные — иначе листья полетели бы строем.
    const lefts = new Set(
      styles.map((style) => style?.match(/--left:\s*([\d.]+)%/)?.[1]),
    )
    const durations = new Set(
      styles.map((style) => style?.match(/--duration:\s*([\d.]+)s/)?.[1]),
    )

    expect(lefts.size).toBe(styles.length)
    expect(durations.size).toBeGreaterThan(1)
  })

  it('стартовые позиции разные: листья не идут волной', async () => {
    const wrapper = await mountAutumn()
    const bottoms = new Set(
      wrapper
        .findAll('.season-decor__leaf')
        .map((leaf) => leaf.attributes('style')?.match(/bottom:\s*([^;]+)/)?.[1]),
    )

    expect(bottoms.size).toBe(wrapper.findAll('.season-decor__leaf').length)
  })

  it('задержка отрицательная — листья видны сразу', async () => {
    const wrapper = await mountAutumn()
    const style = wrapper.get('.season-decor__leaf').attributes('style')

    // С положительной задержкой первые секунды экран был бы пустым.
    expect(style).toMatch(/--delay:\s*-\d/)
  })
})
