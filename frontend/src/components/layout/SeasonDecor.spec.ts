import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import SeasonDecor from '@/components/layout/SeasonDecor.vue'
import { useAppStore } from '@/stores/app'

/**
 * Тесты сезонного фона.
 *
 * Сами анимации проверяет браузер, а не jsdom: здесь важно, что слой
 * появляется только в свой сезон, что листьев столько, сколько задумано,
 * что они получают разные параметры и что просьба «меньше движения»
 * не убирает оформление целиком.
 *
 * Параметры листьев считаются в onMounted, поэтому после mount нужен
 * nextTick: без него разметка ещё пустая, и тест «проверяет» ничего.
 */
function stubMatchMedia(reduceMotion: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: reduceMotion && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  )
}

async function mountAutumn(reduceMotion = false) {
  stubMatchMedia(reduceMotion)
  useAppStore().setTheme(4)
  const wrapper = mount(SeasonDecor)
  await nextTick()
  return wrapper
}

describe('SeasonDecor', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('осенью рисует листья', async () => {
    const wrapper = await mountAutumn()
    const leaves = wrapper.findAll('.season-decor__leaf')

    // На широком экране jsdom (1024 px) — 18 штук.
    expect(leaves.length).toBeGreaterThan(0)
  })

  it('слой пустой по содержимому — это украшение, а не текст', async () => {
    const wrapper = await mountAutumn()

    expect(wrapper.text()).toBe('')
  })

  it('в другие сезоны слоя нет', () => {
    stubMatchMedia(false)
    useAppStore().setTheme(1)

    const wrapper = mount(SeasonDecor)

    expect(wrapper.find('.season-decor').exists()).toBe(false)
  })

  it('слой не ловит клики и скрыт от скринридеров', async () => {
    const wrapper = await mountAutumn()

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

  it('слой показывает листья, если просят меньше движения', async () => {
    // Раньше в этом случае слой прятался целиком, и это выглядело как
    // поломка: декора нет вовсе. Правильно — оставить оформление,
    // убрав движение.
    const wrapper = await mountAutumn(true)

    expect(wrapper.find('.season-decor').exists()).toBe(true)
    expect(wrapper.classes()).toContain('season-decor--calm')
    expect(wrapper.findAll('.season-decor__leaf').length).toBeGreaterThan(0)
  })

  it('задержка отрицательная — листья видны сразу', async () => {
    const wrapper = await mountAutumn()
    const style = wrapper.get('.season-decor__leaf').attributes('style')

    // С положительной задержкой первые секунды экран был бы пустым.
    expect(style).toMatch(/--delay:\s*-\d/)
  })

  it('стартовые позиции разные: листья не идут волной', async () => {
    const wrapper = await mountAutumn()
    const tops = new Set(
      wrapper
        .findAll('.season-decor__leaf')
        .map((leaf) => leaf.attributes('style')?.match(/--top:\s*([\d.]+)vh/)?.[1]),
    )

    expect(tops.size).toBe(wrapper.findAll('.season-decor__leaf').length)
  })
})
