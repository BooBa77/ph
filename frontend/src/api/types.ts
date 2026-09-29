/**
 * Пользователь — то, что отдаёт бэк в /api/users/me, /api/auth/verify-code
 * и /api/auth/refresh.
 *
 * Описываем только нужные фронту поля. Лишние (deletedAt и прочее)
 * TypeScript структурно игнорирует — можно не перечислять.
 * Когда на бэке появится UserResponseDto, контракт сузится,
 * и этот интерфейс станет ему точным соответствием.
 */
export interface User {
  id: string
  displayName: string
  nickname: string | null
  firstName: string | null
  lastName: string | null
  location: string | null
  /** 'YYYY-MM-DD', год фиктивный (2000) — на фронте показываем без года */
  birthDate: string | null
  avatarUrl: string | null
  createdAt: string
  updatedAt: string
}

/**
 * POST /api/auth/request-code → 200
 * Ответ на запрос кода. resendAfterSeconds — через сколько секунд
 * можно запросить код повторно (cooldown).
 */
export interface RequestCodeResponse {
  message: string
  resendAfterSeconds: number
}

/**
 * POST /api/auth/verify-code → 200
 * Успешный вход. accessToken — JWT на 30 минут, кладётся в память (Pinia).
 * refresh-токен приходит отдельно, в httpOnly cookie — фронт его не видит.
 *
 * user — полный профиль (не brief): бэк отдаёт entity целиком.
 */
export interface AuthResponse {
  accessToken: string
  user: User
}

/**
 * POST /api/auth/refresh → 200
 *
 * Discriminated union: либо успех (есть accessToken и user),
 * либо «не залогинен» (accessToken === null, user отсутствует).
 *
 * Бэк специально не отдаёт 401 при отсутствии cookie, а возвращает 200
 * с null — чтобы bootstrap не писал шумных ошибок в консоль.
 * Union заставляет TS проверять accessToken перед обращением к user.
 */
export type RefreshResponse =
  | { accessToken: string; user: User }
  | { accessToken: null }