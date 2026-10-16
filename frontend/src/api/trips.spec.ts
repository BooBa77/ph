import { describe, expect, it } from 'vitest'

import { buildTripListQuery } from '@/api/trips'

/**
 * Тесты сборки строки запроса ленты.
 *
 * Главное правило здесь одно и оно неочевидное: **«любое значение» — это
 * отсутствие параметра, а не `false`**. `?isCommercial=false` просит
 * у бэкенда только бесплатные походы, и если однажды `undefined` начнёт
 * превращаться в `false`, лента молча покажет половину походов.
 */
describe('buildTripListQuery', () => {
  it('без параметров не приписывает даже вопросительный знак', () => {
    expect(buildTripListQuery()).toBe('')
    expect(buildTripListQuery({})).toBe('')
  })

  it('отбрасывает незаданное, но сохраняет false', () => {
    const query = buildTripListQuery({
      mine: false,
      isCommercial: false,
      isSport: undefined,
      when: undefined,
      limit: 20,
      offset: 0,
    })

    expect(query).toBe('?mine=false&isCommercial=false&limit=20&offset=0')
  })

  it('собирает фильтры анонсов целиком', () => {
    const query = buildTripListQuery({
      mine: false,
      goalObjectId: 10,
      when: 'upcoming',
      status: 'decided',
      isCommercial: true,
      isSport: true,
    })

    expect(query).toContain('goalObjectId=10')
    expect(query).toContain('when=upcoming')
    expect(query).toContain('status=decided')
    expect(query).toContain('isCommercial=true')
    expect(query).toContain('isSport=true')
    expect(query).toContain('mine=false')
  })
})
