import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { SportExperienceDto } from './sport-experience.dto';

/**
 * Тело PATCH /api/users/me.
 *
 * Все поля опциональны — обновляем только то, что пришло.
 * Если поле не передано в теле — не трогаем.
 * Если передано (в т.ч. null) — обновляем.
 *
 * displayName НЕЛЬЗЯ очистить: если передано — валидация требует
 * 2–50 символов по регулярке. Пустая строка не пройдёт. Отсутствие
 * поля в теле — «не менять», не «очистить».
 *
 * avatarUrl здесь намеренно отсутствует: аватарка — это файл, и меняется
 * она только через POST/DELETE /api/users/me/avatar. Пока поле было тут,
 * в базу можно было записать произвольную строку — например, чужой URL.
 * Так как ValidationPipe включён с forbidNonWhitelisted, попытка прислать
 * avatarUrl сюда теперь честно вернёт 400, а не молча ничего не сделает.
 */
export class UpdateUserDto {
  @ApiProperty({
    description:
      'Отображаемое имя. Буквы (рус/лат), цифры, пробел, дефис, подчёркивание. 2–50 символов.',
    example: 'Байкальский волк',
    minLength: 2,
    maxLength: 50,
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50, { message: 'Имя не должно превышать 50 символов' })
  @Matches(/^[a-zA-Zа-яА-ЯёЁ0-9 _-]{2,50}$/, {
    message:
      'Имя: 2–50 символов, допустимы буквы, цифры, пробел, дефис и подчёркивание',
  })
  displayName?: string;

  @ApiProperty({
    description: 'Место проживания. null — очистить.',
    example: 'Иркутск',
    maxLength: 100,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Город не должен превышать 100 символов' })
  location?: string | null;

  @ApiProperty({
    description: 'Вегетарианство (пищевое ограничение)',
    example: false,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  isVegetarian?: boolean;

  @ApiProperty({
    description: 'Аллергии: свободный текст пользователя. null — очистить.',
    example: 'Орехи, цитрусовые',
    maxLength: 500,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500, {
    message: 'Список аллергий не должен превышать 500 символов',
  })
  allergies?: string | null;

  /**
   * Спортивный опыт. Приходит одним вложенным объектом: так фронт может
   * прислать сразу и альпинизм, и туризм, а может — одну строку выпадающего
   * списка, и остальное останется как было.
   *
   * `null` — очистить опыт целиком (строка в user_sport_experience удаляется).
   */
  @ApiProperty({
    description:
      'Спортивный опыт: альпинизм, скайраннинг, спортивный туризм. null — очистить целиком.',
    type: () => SportExperienceDto,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => SportExperienceDto)
  sportExperience?: SportExperienceDto | null;
}
