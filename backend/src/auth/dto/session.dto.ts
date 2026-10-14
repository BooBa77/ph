import { ApiProperty } from '@nestjs/swagger';

/**
 * Сессия устройства в списке «Настройки → Сессии».
 *
 * Наружу уходят только безопасные поля: идентификатор, подпись устройства
 * и сроки. Хэш refresh-токена не отдаём никогда — по нему можно было бы
 * отозвать чужую сессию, а показывать его незачем.
 */
export class SessionDto {
  @ApiProperty({
    description: 'Идентификатор сессии (по нему отзываем)',
    example: '90ca6b06-fb04-4c5e-8c49-36ef5d188c50',
  })
  id: string;

  @ApiProperty({
    description: 'Человекочитаемое устройство из User-Agent',
    example: 'Chrome on Windows',
    nullable: true,
  })
  deviceLabel: string | null;

  @ApiProperty({ description: 'Когда сессия началась' })
  createdAt: Date;

  @ApiProperty({ description: 'Когда истечёт сама' })
  expiresAt: Date;

  @ApiProperty({
    description:
      'Это устройство, с которого сделан запрос: ему в списке отдельная пометка',
    example: true,
  })
  isCurrent: boolean;
}
