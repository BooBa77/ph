import { ApiProperty } from '@nestjs/swagger';

import type { User } from '../entities/user.entity';

/**
 * Публичный профиль человека — то, что видит **кто угодно**, а не владелец.
 *
 * Повод: страница «Контакты» (`docs/ph/trip-tabs.md`, Ф5) — поиск людей
 * и профиль найденного. Без неё приглашение в поход упирается в имя,
 * а «кто это вообще» узнать негде.
 *
 * **Чего здесь намеренно нет.** `UserResponseDto` (свой профиль) отдаёт
 * пищевые ограничения, аллергии и спортивный опыт — это личное, и человек
 * показывает его сам, когда захочет. Здесь только то, что и так видно
 * в походах и чатах: имя, аватарка, город и «на сайте с».
 *
 * Город — потому что имена повторяются, и «Иван из Иркутска» отличается
 * от «Ивана из Ангарска» без открытия профиля. `createdAt` — «на сайте
 * с марта 2026»: это дешёвый признак «человек не вчера пришёл» и ничего
 * личного не раскрывает.
 */
export class UserPublicProfileDto {
  @ApiProperty({
    description: 'Id пользователя',
    example: '90ca6b06-fb04-4c5e-8c49-36ef5d188c50',
  })
  id: string;

  @ApiProperty({ description: 'Отображаемое имя', example: 'booba' })
  displayName: string;

  @ApiProperty({ description: 'URL аватарки', nullable: true })
  avatarUrl: string | null;

  @ApiProperty({
    description: 'Город',
    example: 'Иркутск',
    nullable: true,
  })
  location: string | null;

  @ApiProperty({
    description: 'Когда человек появился на сайте',
    example: '2026-03-01T10:00:00.000Z',
  })
  createdAt: string;

  /**
   * Это я? Нужно интерфейсу, чтобы на своей странице не предлагать
   * «написать себе» и показать «это вы». Считается по токену, а не
   * сравнением на клиенте: клиент сравнивает id, а сервер знает точно.
   */
  @ApiProperty({ description: 'Это профиль того, кто смотрит', example: false })
  isSelf: boolean;

  static from(user: User, isSelf: boolean): UserPublicProfileDto {
    return {
      id: user.id,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      location: user.location,
      createdAt: user.createdAt.toISOString(),
      isSelf,
    };
  }
}
