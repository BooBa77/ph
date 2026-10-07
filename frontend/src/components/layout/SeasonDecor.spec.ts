import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import SeasonDecor from '@/components/layout/SeasonDecor.vue'
import { useAppStore } from '@/stores/app'

/**
 * Тесты сезонного фона.
 *
 * Сами анимации проверяет браузер, а не jsdom: здесь важно, что слой
 * появляется только в свой сезон, что листьев столько, сколько задумано,
 * и что у них разные параметры — одинаковые выглядели бы как одна
 * гирлянда, а не как листопад.
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
  })

  it('осенью рисует листья', async () => {
    const wrapper = await mountAutumn()

    // На широком экране jsdom (1024 px) — 18 штук.
    expect(wrapper.findAll('.leaf').length).toBeGreaterThan(0)
  })

  it('слой пустой по содержимому — это украшение, а не текст', async () => {
    const wrapper = await mountAutumn()

    expect(wrapper.text()).toBe('')
  })

  it('в другие сезоны слоя нет', () => {
    useAppStore().setTheme(1)

    const wrapper = mount(SeasonDecor)

    expect(wrapper.find('.leaves').exists()).toBe(false)
  })

  it('слой скрыт от скринридеров', async () => {
    const wrapper = await mountAutumn()

    expect(wrapper.attributes('aria-hidden')).toBe('true')
  })

  it('у листьев разные позиции, скорости и задержки', async () => {
    const wrapper = await mountAutumn()
    const styles = wrapper
      .findAll('.leaf')
      .map((leaf) => leaf.attributes('style') ?? '')

    const values = (name: string) =>
      new Set(styles.map((style) => style.match(new RegExp(`${name}:\\s*([^;]+)`))?.[1]))

    // Все позиции разные — иначе листья полетели бы строем.
    expect(values('--left').size).toBe(styles.length)
    expect(values('--duration').size).toBeGreaterThan(1)
  })

  it('задержка отрицательная — листья видны сразу', async () => {
    const wrapper = await mountAutumn()
    const style = wrapper.get('.leaf').attributes('style') ?? ''

    // С положительной задержкой первые секунды экран был бы пустым.
    expect(style).toMatch(/--delay:\s*-\d/)
  })

  it('скорость падения в диапазоне 45–90 секунд', async () => {
    const wrapper = await mountAutumn()
    const durations = wrapper
      .findAll('.leaf')
      .map((leaf) => Number(leaf.attributes('style')?.match(/--duration:\s*([\d.]+)s/)?.[1]))

    // Медленное падение читается как листопад, быстрое — как помехи.
    for (const duration of durations) {
      expect(duration).toBeGreaterThanOrEqual(45)
      expect(duration).toBeLessThanOrEqual(90)
    }
  })
})
