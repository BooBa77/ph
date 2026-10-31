import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

import { USER_GENDERS, type UserGender } from '../gender.types';
import type { User } from '../entities/user.entity';

/**
 * Человек без аккаунта, как его видит организатор.
 *
 * Отдаётся только своему создателю (`GET /api/users/me/virtual`) — для
 * «быстрого добавления» в следующий поход. Чужой список не виден: это
 * не справочник людей, а личная записная книжка организатора.
 *
 * Полей профиля здесь нет намеренно: у виртуального только имя и пол
 * (пол нужен распределению веса рюкзака), аватарки и «личных качеств»
 * у него не бывает — решение `virtual-participants.md` §7.
 */
export class VirtualUserDto {
  @ApiProperty({
    description: 'Id пользователя — он же участник походов',
    example: '90ca6b06-fb04-4c5e-8c49-36ef5d188c50',
  })
  id: string;

  @ApiProperty({ description: 'Имя', example: 'Дядя Витя' })
  displayName: string;

  @ApiProperty({
    description: 'Пол: m — мужской, f — женский',
    enum: USER_GENDERS,
    example: 'm',
  })
  gender: UserGender;

  @ApiProperty({ description: 'Когда человек заведён' })
  createdAt: string;

  static from(user: User): VirtualUserDto {
    return {
      id: user.id,
      displayName: user.displayName,
      gender: user.gender,
      createdAt: user.createdAt.toISOString(),
    };
  }
}

export class VirtualUserListDto {
  @ApiProperty({
    description: 'Мои люди без аккаунта',
    type: [VirtualUserDto],
  })
  users: VirtualUserDto[];
}

/**
 * Тело `POST /api/trips/:id/participants/virtual` — завести человека
 * без аккаунта и сразу добавить в поход.
 *
 * Имя проверяется той же регуляркой, что и профиль настоящего
 * пользователя (`UpdateUserDto.displayName`): это одно и то же поле
 * в одной и той же таблице, и разные правила для него означали бы, что
 * виртуального можно назвать так, как себя назвать нельзя.
 *
 * Пол необязателен: по умолчанию `m`, как у обычного пользователя.
 * Спрашивать его при создании незачем — «распределение веса» сойдётся
 * и на умолчании, а организатор поправит, если захочет.
 */
export class CreateVirtualUserDto {
  @ApiProperty({
    description: 'Имя человека. Буквы (рус/лат), цифры, пробел, дефис, подчёркивание. 2–50 символов.',
    example: 'Дядя Витя',
    minLength: 2,
    maxLength: 50,
  })
  @IsString({ message: 'Имя должно быть строкой' })
  @MaxLength(50, { message: 'Имя не должно превышать 50 символов' })
  @Matches(/^[a-zA-Zа-яА-ЯёЁ0-9 _-]{2,50}$/, {
    message:
      'Имя: 2–50 символов, допустимы буквы, цифры, пробел, дефис и подчёркивание',
  })
  displayName: string;

  @ApiProperty({
    description: 'Пол: m — мужской, f — женский. По умолчанию m',
    enum: USER_GENDERS,
    example: 'f',
    required: false,
  })
  @IsOptional()
  @IsIn(USER_GENDERS, { message: 'Пол: m — мужской, f — женский' })
  gender?: UserGender;
}

/**
 * Тело `PATCH /api/users/me/virtual/:userId` — переименовать или поменять
 * пол. Только своё: чужой виртуальный не существует (404).
 *
 * Переименование видно везде сразу: строка `users` одна на человека,
 * и походы ссылаются на неё, а не хранят копию имени.
 */
export class UpdateVirtualUserDto {
  @ApiProperty({
    description: 'Новое имя. Не передано — не трогаем',
    example: 'Дядя Витя',
    minLength: 2,
    maxLength: 50,
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'Имя должно быть строкой' })
  @MaxLength(50, { message: 'Имя не должно превышать 50 символов' })
  @Matches(/^[a-zA-Zа-яА-ЯёЁ0-9 _-]{2,50}$/, {
    message:
      'Имя: 2–50 символов, допустимы буквы, цифры, пробел, дефис и подчёркивание',
  })
  displayName?: string;

  @ApiProperty({
    description: 'Новый пол: m — мужской, f — женский',
    enum: USER_GENDERS,
    example: 'm',
    required: false,
  })
  @IsOptional()
  @IsIn(USER_GENDERS, { message: 'Пол: m — мужской, f — женский' })
  gender?: UserGender;
}
