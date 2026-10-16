import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

import type { User } from '../entities/user.entity';

/**
 * Поиск людей по имени — для приглашения в поход.
 *
 * **Пустой запрос не отдаёт никого.** Тот же принцип, что у справочника
 * объектов: список всех пользователей — это не выбор, а простыня, и
 * показывать его по пустому полю нечего.
 *
 * Минимальная длина — два символа. Одна буква найдёт пол-сайта, и такое
 * «приглашение» ничего не выбирает; клиент до этого порога просто
 * не делает запрос, а сервер на всякий случай отвечает 400.
 */
export class UserSearchQueryDto {
  @ApiProperty({
    description: 'Подстрока имени: от двух символов',
    example: 'бооб',
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'Поиск должен быть строкой' })
  @MinLength(2, { message: 'Для поиска нужно хотя бы два символа' })
  search?: string;
}

/**
 * Человек в результатах поиска — только публичная часть профиля.
 *
 * Ни email, ни города, ни спортивного опыта: чтобы позвать в поход, нужны
 * имя и лицо. Всё остальное человек показывает сам, в своём профиле.
 */
export class UserSearchResultDto {
  @ApiProperty({ description: 'Id пользователя', example: '90ca6b06-…' })
  id: string;

  @ApiProperty({ description: 'Отображаемое имя', example: 'booba' })
  displayName: string;

  @ApiProperty({ description: 'URL аватарки', nullable: true })
  avatarUrl: string | null;

  static from(user: User): UserSearchResultDto {
    return {
      id: user.id,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
    };
  }
}

export class UserSearchListDto {
  @ApiProperty({ description: 'Найденные люди', type: [UserSearchResultDto] })
  users: UserSearchResultDto[];
}
