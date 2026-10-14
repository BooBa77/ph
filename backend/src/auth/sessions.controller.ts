import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { AuthService } from './auth.service';
import { SessionDto } from './dto/session.dto';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthUser } from './decorators/current-user.decorator';

/** Имя cookie с refresh-токеном: по ней определяем текущую сессию. */
const REFRESH_COOKIE = 'refresh_token';

/**
 * Сессии устройств: список и отзыв.
 *
 * Живёт в модуле авторизации, а не в `AuthController`: тот помечен
 * `@Public()` целиком, а эти роуты, наоборот, обязаны требовать токен —
 * глобальный `JwtAuthGuard` защищает их по умолчанию.
 *
 * Путь начинается с `users/me/`, потому что это про свой аккаунт: так же
 * называется профиль (`GET /api/users/me`), и в одном месте видно всё,
 * что пользователь видит про себя.
 */
@ApiTags('sessions')
@Controller('users/me/sessions')
export class SessionsController {
  constructor(private readonly authService: AuthService) {}

  @Get()
  @ApiOperation({ summary: 'Активные сессии текущего пользователя' })
  @ApiOkResponse({ type: [SessionDto] })
  async list(
    @CurrentUser() authUser: AuthUser,
    @Req() req: Request,
  ): Promise<SessionDto[]> {
    // Текущую сессию узнаём по refresh-cookie: она httpOnly, и только
    // сервер может сопоставить её с записью в базе.
    const refreshToken = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    return this.authService.listSessions(authUser.id, refreshToken);
  }

  /**
   * Отозвать сессию: устройство перестаёт обновлять access-токен
   * и вылетает при следующем refresh.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Отозвать сессию устройства' })
  @ApiNoContentResponse({ description: 'Сессия отозвана' })
  async revoke(
    @CurrentUser() authUser: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    const revoked = await this.authService.revokeSession(authUser.id, id);
    if (!revoked) {
      throw new NotFoundException('Сессия не найдена');
    }
  }
}
