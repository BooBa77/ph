import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from '../../users/dto/user-response.dto';

/**
 * Форма успешного ответа auth-эндпоинтов (verify-code, refresh).
 *
 * ВАЖНО: этот класс существует ЧИСТО ДЛЯ SWAGGER.
 * В рантайме объекты этого класса не создаются через `new` —
 * контроллер возвращает обычный литерал { accessToken, user },
 * который структурно совпадает с этой формой. TypeScript пропускает
 * его, потому что структура совпадает.
 *
 * Класс нужен, чтобы Swagger прочитал @ApiProperty и построил схему
 * ответа. Без него Swagger не знает, что возвращают эти эндпоинты.
 *
 * Описывает только «успешную» ветку. Случай «refresh без cookie»
 * ({ accessToken: null }) не описан — это редкий кейс, смиряемся.
 */
export class AuthResponseDto {
  @ApiProperty({
    description: 'JWT access-токен (30 минут)',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  accessToken: string;

  @ApiProperty({
    description: 'Профиль залогиненного пользователя',
    type: UserResponseDto,
  })
  user: UserResponseDto;
}