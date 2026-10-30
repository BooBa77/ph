import { describe, expect, it } from 'vitest';

import { adminUserIds } from '../../calendar/admin';
import type { User } from '../entities/user.entity';
import { UserResponseDto } from './user-response.dto';

/**
 * Тесты флага админа в своём профиле.
 *
 * Флаг `isAdmin` появился 30.10.2026 ради пункта «Админка» в меню: фронту
 * не нужно ни знать UUID админа, ни спрашивать календарь, чтобы показать
 * ссылку. Считается он тем же `isAdminUser`, что и доступ к админским ручкам,
 * поэтому проверять «выдуманного админа» через HTTP нельзя: `/users/me`
 * ищет пользователя в базе, а админского UUID там нет. Здесь проверяется
 * ровно отображение списка в DTO — без базы и без HTTP.
 *
 * Само правило доступа (`isAdminUser`) живёт в `calendar/admin.ts` и покрыто
 * e2e модерации; тут — только то, что оно доходит до ответа API.
 */
function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: '90ca6b06-fb04-4c5e-8c49-36ef5d188c50',
    displayName: 'Тест',
    location: null,
    gender: 'm',
    avatarUrl: null,
    calendarMode: null,
    isVegetarian: false,
    allergies: null,
    sportExperience: null,
    deletedAt: null,
    createdAt: new Date('2026-10-30T10:00:00Z'),
    updatedAt: new Date('2026-10-30T10:00:00Z'),
    ...overrides,
  };
}

describe('UserResponseDto: флаг админа', () => {
  it('обычному пользователю флаг не ставит', () => {
    const dto = UserResponseDto.from(makeUser());

    expect(dto.isAdmin).toBe(false);
  });

  it('админский UUID получает флаг', () => {
    const adminId = adminUserIds()[0] as string;

    const dto = UserResponseDto.from(makeUser({ id: adminId }));

    expect(dto.isAdmin).toBe(true);
  });

  it('остальные поля профиля уходят как раньше', () => {
    const dto = UserResponseDto.from(
      makeUser({ displayName: 'Анна', location: 'Иркутск', gender: 'f' }),
    );

    // Флаг не должен был изменить сборку профиля: те же поля, что и до него.
    expect(dto).toMatchObject({
      displayName: 'Анна',
      location: 'Иркутск',
      gender: 'f',
      isVegetarian: false,
      allergies: null,
      sportExperience: null,
      isAdmin: false,
    });
  });
});
