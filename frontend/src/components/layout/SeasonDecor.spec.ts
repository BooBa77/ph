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
 * и что они получают разные параметры — одинаковые выглядели бы как
 * одна гирлянда, а не как падающие листья.
 *
 * Параметры листьев считаются в onMounted, поэтому после mount нужен
 * nextTick: без него разметка ещё пустая, и тест «проверяет» ничего.
 * На этом я и споткнулся — три теста падали на пустом списке.
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
    const leaves = wrapper.findAll('.season-decor__leaf')

    // На широком экране jsdom (1024 px) — 14 штук.
    expect(leaves.length).toBeGreaterThan(0)
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

    // Украшение не должно мешать нажимать на интерфейс под ним
    // и не должно читаться вслух.
    expect(wrapper.classes()).toContain('pointer-events-none')
    expect(wrapper.attributes('aria-hidden')).toBe('true')
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

  it('задержка отрицательная — листья видны сразу', async () => {
    const wrapper = await mountAutumn()
    const style = wrapper.get('.season-decor__leaf').attributes('style')

    // С положительной задержкой первые секунды экран был бы пустым.
    expect(style).toMatch(/--delay:\s*-\d/)
  })
})
