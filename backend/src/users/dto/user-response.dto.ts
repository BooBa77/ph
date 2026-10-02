import { ApiProperty } from '@nestjs/swagger';
import { User } from '../entities/user.entity';

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

  @ApiProperty({
    description: 'URL аватарки',
    example: 'https://example.com/avatar.jpg',
    nullable: true,
  })
  avatarUrl: string | null;

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
    dto.avatarUrl = user.avatarUrl;
    return dto;
  }
}