import { afterEach, describe, expect, it, vi } from 'vitest'

import { canBrowserDecode, looksLikeHeic } from '@/utils/imageDecode'

/**
 * Тесты проверки декодирования.
 *
 * Это защита от пустого кроппера: аватарка обрабатывается в браузере,
 * и если он файл не читает, пользователь должен получить объяснение,
 * а не пустой квадрат. Главный случай — HEIC в Chrome и Firefox
 * на компьютере.
 */
function makeFile(name: string, type: string): File {
  return new File(['данные'], name, { type })
}

describe('looksLikeHeic', () => {
  it('узнаёт по типу', () => {
    expect(looksLikeHeic(makeFile('photo.bin', 'image/heic'))).toBe(true)
    expect(looksLikeHeic(makeFile('photo.bin', 'image/heif'))).toBe(true)
  })

  it('узнаёт по расширению, когда тип пустой', () => {
    // Некоторые системы не проставляют MIME для HEIC.
    expect(looksLikeHeic(makeFile('IMG_1234.HEIC', ''))).toBe(true)
    expect(looksLikeHeic(makeFile('IMG_1234.heif', ''))).toBe(true)
  })

  it('не путает с обычными форматами', () => {
    expect(looksLikeHeic(makeFile('photo.jpg', 'image/jpeg'))).toBe(false)
    expect(looksLikeHeic(makeFile('photo.png', 'image/png'))).toBe(false)
    expect(looksLikeHeic(makeFile('photo.webp', 'image/webp'))).toBe(false)
  })
})

describe('canBrowserDecode', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('говорит «да», если браузер декодировал', async () => {
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ close }))

    await expect(canBrowserDecode(makeFile('a.jpg', 'image/jpeg'))).resolves.toBe(
      true,
    )
    // Освобождаем ресурс: bitmap держит память до close().
    expect(close).toHaveBeenCalled()
  })

  it('говорит «нет», если декодирование упало', async () => {
    // Так ведёт себя Chrome на HEIC: обещание отклоняется.
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockRejectedValue(new Error('unsupported image format')),
    )

    await expect(
      canBrowserDecode(makeFile('IMG_1234.HEIC', 'image/heic')),
    ).resolves.toBe(false)
  })

  it('не блокирует пользователя, если API нет', async () => {
    // Старый браузер: проверять нечем — пусть попробует, кроппер
    // покажет ошибку сам.
    vi.stubGlobal('createImageBitmap', undefined)

    await expect(canBrowserDecode(makeFile('a.jpg', 'image/jpeg'))).resolves.toBe(
      true,
    )
  })
})
