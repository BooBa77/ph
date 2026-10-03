// frontend/src/api/users.ts

import { apiFetch } from '@/api/client'
import type { UpdateUserRequest, User } from '@/api/types'

/**
 * GET /api/users/me
 *
 * Профиль текущего пользователя. Требует access-токен.
 * Используется, если нужно обновить данные профиля (после login
 * они уже в store, но при некоторых сценариях может понадобиться
 * перезапросить).
 *
 * Идёт через apiFetch — защищённый эндпоинт, нужен Bearer-токен.
 * apiFetch сам подставит токен и обновит его при 401.
 */
export async function getMe(): Promise<User> {
  return apiFetch<User>('/users/me')
}

/**
 * PATCH /api/users/me
 *
 * Обновить профиль текущего пользователя.
 * Принимает частичный объект — только изменяемые поля.
 * null для location/avatarUrl — «очистить».
 *
 * Возвращает обновлённый User (полный, как его видит бэк).
 *
 * Идёт через apiFetch — защищённый эндпоинт.
 */
export async function updateMe(data: UpdateUserRequest): Promise<User> {
  return apiFetch<User>('/users/me', {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}