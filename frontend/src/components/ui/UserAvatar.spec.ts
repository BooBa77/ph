import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import UserAvatar from '@/components/ui/UserAvatar.vue'

/**
 * Тесты кружка с аватаркой.
 *
 * Проверяем три вещи, которые легко сломать незаметно: подстановку
 * дефолта, деградацию на дефолт при битой ссылке и `srcset` для Retina.
 */
describe('UserAvatar', () => {
  it('без аватарки показывает дефолт', () => {
    const wrapper = mount(UserAvatar, { props: { src: null } })

    expect(wrapper.attributes('src')).toBe('/img/avatar-default-192.png')
  })

  it('с аватаркой показывает её', () => {
    const wrapper = mount(UserAvatar, {
      props: { src: '/api/uploads/avatars/u/1.webp' },
    })

    expect(wrapper.attributes('src')).toBe('/api/uploads/avatars/u/1.webp')
  })

  it('дефолт предлагает в трёх размерах под Retina', () => {
    const wrapper = mount(UserAvatar, { props: { src: null, size: 32 } })

    // Браузер выберет файл по плотности экрана; без srcset на Retina
    // было бы мыло, а отдавать всем 512 px — лишний трафик.
    expect(wrapper.attributes('srcset')).toBe(
      '/img/avatar-default-96.png 96w, ' +
        '/img/avatar-default-192.png 192w, ' +
        '/img/avatar-default-512.png 512w',
    )
    expect(wrapper.attributes('sizes')).toBe('32px')
  })

  it('для аватарки пользователя srcset не нужен', () => {
    const wrapper = mount(UserAvatar, {
      props: { src: '/api/uploads/avatars/u/1.webp' },
    })

    // Бэкенд хранит один размер — выбирать браузеру не из чего.
    expect(wrapper.attributes('srcset')).toBeUndefined()
  })

  it('на битую ссылку показывает дефолт', async () => {
    const wrapper = mount(UserAvatar, {
      props: { src: '/api/uploads/avatars/u/gone.webp' },
    })

    // Так выглядит «том пересоздали, а в базе путь остался».
    await wrapper.trigger('error')

    expect(wrapper.attributes('src')).toBe('/img/avatar-default-192.png')
    expect(wrapper.attributes('srcset')).toBeDefined()
  })

  it('новая аватарка снимает отметку о сбое', async () => {
    const wrapper = mount(UserAvatar, {
      props: { src: '/api/uploads/avatars/u/gone.webp' },
    })
    await wrapper.trigger('error')
    expect(wrapper.attributes('src')).toBe('/img/avatar-default-192.png')

    await wrapper.setProps({ src: '/api/uploads/avatars/u/fresh.webp' })

    // Иначе после одной неудачной загрузки кружок навсегда остался бы
    // дефолтным, даже когда аватарка уже есть.
    expect(wrapper.attributes('src')).toBe('/api/uploads/avatars/u/fresh.webp')
  })

  it('размер задаёт и атрибуты, и inline-стиль', () => {
    const wrapper = mount(UserAvatar, { props: { size: 80 } })

    expect(wrapper.attributes('width')).toBe('80')
    expect(wrapper.attributes('height')).toBe('80')
    expect(wrapper.attributes('style')).toContain('width: 80px')
  })
})
