import { ApiProperty } from '@nestjs/swagger';
import { User } from '../entities/user.entity';
import { USER_GENDERS, type UserGender } from '../gender.types';
import { SportExperienceResponseDto } from './sport-experience-response.dto';

/**
 * Публичное представление пользователя — то, что уходит наружу по API.
 *
 * Отдаётся в:
 *   - GET /api/users/me
 *   - POST /api/auth/verify-code
 *   - POST /api/auth/refresh
 *
 * Отличается от entity User тем, что не содержит служебных полей:
 *   - deletedAt — внутреннее состояние soft delete
 *   - createdAt / updatedAt — аудит, фронту не нужны
 *
 * Если завтра в entity появится новое служебное поле — оно НЕ утечёт
 * в API автоматически. Чтобы поле ушло наружу, его надо явно
 * добавить сюда и в метод from().
 */
export class UserResponseDto {
  @ApiProperty({
    description: 'UUID пользователя',
    example: '90ca6b06-fb04-4c5e-8c49-36ef5d188c50',
  })
  id: string;

  @ApiProperty({
    description:
      'Отображаемое имя (заполняется при регистрации из email, можно менять)',
    example: 'booba',
  })
  displayName: string;

  @ApiProperty({
    description: 'Место проживания',
    example: 'Иркутск',
    nullable: true,
  })
  location: string | null;

  /**
   * Пол — в своём профиле, но **не** в публичном.
   *
   * Отдаётся владельцу, потому что он его и меняет; в чужие руки уходит
   * только через состав похода (`TripParticipantDto`), где нужен расчёту
   * веса, — и это не то же самое, что «случайный гость на странице
   * контактов».
   */
  @ApiProperty({
    description: 'Пол: m — мужской, f — женский',
    enum: USER_GENDERS,
    example: 'm',
  })
  gender: UserGender;

  @ApiProperty({
    description: 'URL аватарки',
    example: 'https://example.com/avatar.jpg',
    nullable: true,
  })
  avatarUrl: string | null;

  @ApiProperty({
    description: 'Вегетарианство (пищевое ограничение)',
    example: false,
  })
  isVegetarian: boolean;

  @ApiProperty({
    description: 'Аллергии: свободный текст пользователя',
    example: 'Орехи, цитрусовые',
    nullable: true,
  })
  allergies: string | null;

  @ApiProperty({
    description:
      'Спортивный опыт (альпинизм, скайраннинг, спортивный туризм). null — не заполнен.',
    type: () => SportExperienceResponseDto,
    nullable: true,
  })
  sportExperience: SportExperienceResponseDto | null;

  /**
   * Собрать DTO из entity User.
   *
   * Явный маппинг: перечисляем каждое поле руками.
   * Если в entity появится новое поле, которое нужно фронту —
   * добавляем его здесь. Если не нужно — оно и не попадёт в DTO.
   */
  static from(user: User): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = user.id;
    dto.displayName = user.displayName;
    dto.location = user.location;
    dto.gender = user.gender;
    dto.avatarUrl = user.avatarUrl;
    dto.isVegetarian = user.isVegetarian;
    dto.allergies = user.allergies;
    dto.sportExperience = SportExperienceResponseDto.from(
      user.sportExperience ?? null,
    );
    return dto;
  }
}
