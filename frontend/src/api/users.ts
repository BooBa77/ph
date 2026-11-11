// frontend/src/api/users.ts

import { apiFetch } from '@/api/client'
import type { Gender, UpdateUserRequest, User } from '@/api/types'

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

/** Человек в результатах поиска: только публичная часть профиля. */
export interface UserSearchResult {
  id: string
  displayName: string
  avatarUrl: string | null
}

/**
 * Публичный профиль человека — то, что видно кому угодно.
 *
 * Не путать с `User` (`/users/me`): там свои аллергии и спортивный опыт,
 * здесь — имя, аватарка, город и «на сайте с». Личное человек показывает
 * сам, и в чужой профиль оно не попадает.
 */
export interface PublicUser {
  id: string
  displayName: string
  avatarUrl: string | null
  location: string | null
  createdAt: string
  /** Это профиль того, кто смотрит: считает сервер по токену. */
  isSelf: boolean
}

/**
 * GET /api/users/:id
 *
 * Публичный профиль человека. Нужен странице «Контакты»: поиск даёт имя,
 * а «кто это» — уже здесь. Удалённый человек отвечает 404.
 */
export async function getPublicUser(id: string): Promise<PublicUser> {
  return apiFetch<PublicUser>(`/users/${id}`)
}

/**
 * GET /api/users?search=
 *
 * Найти людей по имени — для приглашения в поход. Без строки поиска (или
 * короче двух символов) возвращает пустой список: список выбора не должен
 * открываться простынёй из всех пользователей. Себя бэкенд из выдачи убирает.
 */
export async function searchUsers(search: string): Promise<UserSearchResult[]> {
  const response = await apiFetch<{ users: UserSearchResult[] }>(
    `/users?search=${encodeURIComponent(search)}`,
  )
  return response.users
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

// ─────────────────────── люди без аккаунта (31.10.2026) ───────────────────────

/**
 * Человек без аккаунта, которого завёл организатор.
 *
 * Живёт в походе как обычный участник (состав, палатки, трансфер, питание),
 * но войти на сайт не может: логина у него нет. Пол нужен распределению
 * веса рюкзака, профиля и аватарки у такого человека не бывает.
 */
export interface VirtualUser {
  id: string
  displayName: string
  gender: Gender
  createdAt: string
  /** В скольких походах человек участвует — для подписи в «Контактах». */
  tripsCount: number
  /**
   * Можно ли его удалить. `false` — он уже был в начавшемся или прошедшем
   * походе: такая запись нужна истории похода. На стадии подготовки
   * удаление разрешено, и из этих походов человек уйдёт.
   */
  canDelete: boolean
  /**
   * Поход, который закрывает удаление (10.11.2026, вечер).
   *
   * `canDelete: false` отвечает «нельзя», но не отвечает «почему»:
   * подпись «уже был в походе» путала — человек не «был», а поход уже
   * начался. Здесь название и дата начала того похода, по датам которого
   * сервер и запретил удаление. `null` — удалять можно.
   */
  blockedByTrip: { id: string; title: string; startedAt: string } | null
}

/**
 * POST /api/users/me/virtual — завести человека без аккаунта.
 *
 * Заводится отдельно от похода: в «Контактах» есть секция «Люди без
 * аккаунта, под моим управлением», откуда человек потом попадает в
 * «Походы → Участники». Раньше единственным путём было «завести и сразу
 * в поход».
 */
export async function createVirtual(data: {
  displayName: string
  gender?: Gender
}): Promise<VirtualUser> {
  return apiFetch<VirtualUser>('/users/me/virtual', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

/**
 * GET /api/users/me/virtual — мои люди без аккаунта.
 *
 * Личная записная книжка организатора: одна строка на человека, а не на
 * поход. По ней человек добавляется в следующий поход одним нажатием.
 */
export async function listMyVirtual(): Promise<VirtualUser[]> {
  const response = await apiFetch<{ users: VirtualUser[] }>('/users/me/virtual')

  return response.users
}

/**
 * PATCH /api/users/me/virtual/:userId — переименовать или поменять пол.
 *
 * Только своё: чужой виртуальный не существует (бэкенд отвечает 404).
 * Переименование видно везде сразу — строка `users` одна на человека.
 */
export async function updateVirtual(
  userId: string,
  patch: { displayName?: string; gender?: Gender },
): Promise<VirtualUser> {
  return apiFetch<VirtualUser>(`/users/me/virtual/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

/**
 * DELETE /api/users/me/virtual/:userId — убрать из личного списка.
 *
 * Из походов человек при этом не исчезает: если он ещё где-то участник,
 * бэкенд отвечает 409 и говорит словами, что сначала надо убрать его
 * из состава.
 */
export async function removeVirtual(userId: string): Promise<void> {
  await apiFetch<void>(`/users/me/virtual/${userId}`, { method: 'DELETE' })
}

// ──────────────────────────── родные (10.11.2026) ────────────────────────────

/**
 * Родной человек: член семьи, с которым общий бюджет и снаряжение.
 *
 * Подтверждённые родные и виртуальные, которых завёл сам человек, —
 * один список: разница только в подписи «без аккаунта» и в том, что
 * виртуального нельзя открыть как профиль.
 */
export interface FamilyMember {
  userId: string
  displayName: string
  avatarUrl: string | null
  isVirtual: boolean
  /** Когда родство возникло (у виртуального — когда завели). */
  since: string
}

/** Согласие участника заявки: не ответил, согласен, отказался. */
export type FamilyUnionConsent = 'pending' | 'accepted' | 'declined'

/** Участник заявки на объединение семей — обе семьи целиком. */
export interface FamilyUnionMember {
  userId: string
  displayName: string
  avatarUrl: string | null
  isVirtual: boolean
  consent: FamilyUnionConsent
  /** Автор заявки: у него согласие не спрашивают. */
  isInitiator: boolean
  /** Из моей семьи, а не из присоединяющейся. */
  mine: boolean
}

/**
 * Заявка на объединение семей (11.11.2026).
 *
 * Одна заявка — не пара «кто кого добавил», а состав из двух семей:
 * новый родственник тянет всю свою компоненту, поэтому подтверждать
 * приходится каждому (`people.md` §2).
 */
export interface FamilyUnion {
  id: string
  status: 'pending' | 'accepted' | 'declined' | 'cancelled'
  initiatorUserId: string
  initiatorName: string
  createdAt: string
  myConsent: FamilyUnionConsent
  isInitiator: boolean
  members: FamilyUnionMember[]
}

/** Три списка «Родных» — ровно как их отдаёт сервер. */
export interface FamilyList {
  family: FamilyMember[]
  incoming: FamilyUnion[]
  outgoing: FamilyUnion[]
}

/** Что ответила ручка добавления: заявка или родство сразу. */
export interface FamilyUnionResult {
  unionId: string | null
  status: 'pending' | 'accepted'
}

/** Человек в предварительном составе объединения. */
export interface FamilyPreviewMember {
  userId: string
  displayName: string
  avatarUrl: string | null
  isVirtual: boolean
  mine: boolean
}

/** Состав обеих семей до подтверждения: кого именно впускаем. */
export interface FamilyUnionPreview {
  targetUserId: string
  targetName: string
  /** Заявка с этим составом уже ждёт ответа. */
  pending: boolean
  members: FamilyPreviewMember[]
}

/**
 * GET /api/users/me/family — мои родные и заявки на объединение семей.
 *
 * Родство взаимно, поэтому сервер ищет его по обеим сторонам пары: вторая
 * сторона видит человека без второго запроса. Заявки приходят сюда же —
 * отдельного экрана уведомлений пока нет.
 */
export async function getMyFamily(): Promise<FamilyList> {
  return apiFetch<FamilyList>('/users/me/family')
}

/**
 * GET /api/users/me/family/preview/:userId — что будет, если добавить.
 *
 * Нужен до создания заявки: заказчик попросил показывать список людей
 * и предупреждение «снаряжение станет общим», а не добавлять вслепую.
 */
export async function getFamilyUnionPreview(userId: string): Promise<FamilyUnionPreview> {
  return apiFetch<FamilyUnionPreview>(`/users/me/family/preview/${userId}`)
}

/**
 * POST /api/users/me/family — добавить в родные.
 *
 * Настоящему человеку создаётся заявка на объединение **обеих семей**
 * (`pending`); свой человек без аккаунта становится родным сразу
 * (`accepted`) — подтверждать ему нечем.
 */
export async function addFamilyMember(userId: string): Promise<FamilyUnionResult> {
  return apiFetch<FamilyUnionResult>('/users/me/family', {
    method: 'POST',
    body: JSON.stringify({ userId }),
  })
}

/** Принять входящую заявку: когда согласны все, семьи сливаются. */
export async function acceptFamilyUnion(unionId: string): Promise<FamilyUnionResult> {
  return apiFetch<FamilyUnionResult>(`/users/me/family/unions/${unionId}/accept`, {
    method: 'POST',
  })
}

/** Отклонить заявку: заявка закрывается, связей не появляется. */
export async function declineFamilyUnion(unionId: string): Promise<void> {
  await apiFetch<void>(`/users/me/family/unions/${unionId}/decline`, { method: 'POST' })
}

/**
 * DELETE /api/users/me/family/unions/:unionId — отменить **свою** заявку.
 *
 * Отменить может только автор заявки: ответивший родственник не «передумывает»
 * за остальных. Принятую связь эта ручка не рвёт — выйти из семьи можно
 * только целиком (`leaveFamily`).
 */
export async function cancelFamilyUnion(unionId: string): Promise<void> {
  await apiFetch<void>(`/users/me/family/unions/${unionId}`, { method: 'DELETE' })
}

/**
 * DELETE /api/users/me/family — выйти из семьи целиком (11.11.2026).
 *
 * Заказчик: «Выход из семьи — разрыв всех связей. `A` разрывает с `B` —
 * уходят все связи `A`, компонента распадается». Каталог не трогается:
 * у каждого остаётся его копия вещи, просто правки перестают зеркалиться.
 * Висящие заявки с участием человека закрываются.
 */
export async function leaveFamily(): Promise<void> {
  await apiFetch<void>('/users/me/family', { method: 'DELETE' })
}
