/**
 * Офлайн-сессия: кто был в аккаунте, когда связи нет.
 *
 * **Зачем.** При старте PWA в офлайне `POST /auth/refresh` не проходит,
 * и обычный `bootstrap` считает человека незалогиненным. Получается абсурд:
 * в поле человек открывает приложение, а оно показывает форму входа, которую
 * без сети всё равно не пройти.
 *
 * Поэтому профиль последнего успешного входа лежит в localStorage, и в
 * офлайне он поднимает сессию. **Токена здесь нет** — хранится только то,
 * что нужно интерфейсу, чтобы узнать человека. Секретов (реквизитов,
 * телефона, карты) в офлайн-копии нет намеренно: они нужны только серверу.
 */

import type { User } from '@/api/types'

/** Ключ localStorage. Отдельный от UI-настроек, чтобы было видно, что это. */
export const OFFLINE_USER_KEY = 'ph.offline.user'

/**
 * Копия профиля для офлайна.
 *
 * Реквизиты и спортивный опыт обнулены: во-первых, в поле они не нужны,
 * во-вторых, это ровно те поля, которые не хочется оставлять в localStorage
 * дольше нужного.
 */
function toStoredUser(user: User): User {
  return {
    id: user.id,
    displayName: user.displayName,
    location: user.location,
    avatarUrl: user.avatarUrl,
    gender: user.gender,
    isVegetarian: user.isVegetarian,
    allergies: user.allergies,
    paymentDetails: null,
    paymentBank: null,
    sportExperience: null,
    isAdmin: user.isAdmin,
  }
}

/** Сохранить профиль после входа или обновления данных. */
export function saveOfflineUser(user: User): void {
  try {
    localStorage.setItem(OFFLINE_USER_KEY, JSON.stringify(toStoredUser(user)))
  } catch {
    // Приватный режим с запретом хранилища — просто не будет офлайн-сессии.
  }
}

/** Прочитать профиль прошлого входа. Мусор в хранилище — `null`. */
export function readOfflineUser(): User | null {
  try {
    const raw = localStorage.getItem(OFFLINE_USER_KEY)
    if (!raw) return null

    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return null

    const candidate = parsed as Partial<User>
    if (typeof candidate.id !== 'string' || typeof candidate.displayName !== 'string') {
      return null
    }

    return {
      id: candidate.id,
      displayName: candidate.displayName,
      location: candidate.location ?? null,
      avatarUrl: candidate.avatarUrl ?? null,
      gender: candidate.gender === 'f' ? 'f' : 'm',
      isVegetarian: candidate.isVegetarian === true,
      allergies: candidate.allergies ?? null,
      paymentDetails: null,
      paymentBank: null,
      sportExperience: null,
      isAdmin: candidate.isAdmin === true,
    }
  } catch {
    return null
  }
}

/** Удалить офлайн-сессию: выход из аккаунта. */
export function clearOfflineUser(): void {
  try {
    localStorage.removeItem(OFFLINE_USER_KEY)
  } catch {
    // Ничего не поделать — при следующем старте может подняться старая сессия,
    // но связи с сервером всё равно нет, а токена в хранилище не было.
  }
}
