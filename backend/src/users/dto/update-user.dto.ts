import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

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
}