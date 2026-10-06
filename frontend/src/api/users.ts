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
 * null для location — «очистить».
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

/**
 * POST /api/users/me/avatar
 *
 * Загрузить аватарку. Файл уходит как multipart/form-data, поле `file`.
 *
 * Content-Type здесь НЕ ставим: FormData сам выставляет
 * multipart/form-data с корректным boundary, а apiFetch его не трогает
 * (см. client.ts). Если поставить заголовок руками, boundary потеряется
 * и multer не разберёт тело.
 *
 * Бэкенд всё равно приводит картинку к 150×150 WebP — даже если сюда
 * попал не квадрат. Но фронт перед отправкой режет квадрат сам, чтобы
 * пользователь видел, что именно попадёт в аватарку.
 *
 * Возвращает обновлённый профиль: отдельный GET /users/me не нужен.
 */
export async function uploadAvatar(file: Blob): Promise<User> {
  const formData = new FormData()
  // Имя файла бэкенд не использует (на диске имя по UUID), но FormData
  // без него отправит часть без filename, и некоторые парсеры
  // воспринимают это как поле, а не файл. Ставим осмысленное.
  formData.append('file', file, 'avatar.jpg')

  return apiFetch<User>('/users/me/avatar', {
    method: 'POST',
    body: formData,
  })
}

/**
 * DELETE /api/users/me/avatar
 *
 * Сбросить аватарку: в базе avatar_url станет null, файл удалится.
 * Возвращает обновлённый профиль.
 *
 * Идемпотентно: повторный вызов, когда аватарки уже нет, — тоже 200.
 */
export async function deleteAvatar(): Promise<User> {
  return apiFetch<User>('/users/me/avatar', { method: 'DELETE' })
}
