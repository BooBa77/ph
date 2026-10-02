import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Patch,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { UserResponseDto } from './dto/user-response.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * Профиль текущего пользователя.
   * Защищён глобальным JwtAuthGuard (не помечен @Public).
   */
  @Get('me')
  @ApiOperation({ summary: 'Профиль текущего пользователя' })
  @ApiOkResponse({ type: UserResponseDto })
  async getMe(@CurrentUser() authUser: AuthUser): Promise<UserResponseDto> {
    const user = await this.usersService.findById(authUser.id);
    if (!user) {
      throw new NotFoundException('Пользователь не найден');
    }
    return UserResponseDto.from(user);
  }

  /**
   * Обновить профиль текущего пользователя.
   *
   * Все поля в теле опциональны. Переданные — обновляются.
   * Непереданные — не трогаются.
   *
   * Если displayName меняется — в display_name_history пишется
   * аудит-запись (см. UsersService.update).
   */
  @Patch('me')
  @ApiOperation({ summary: 'Обновить профиль текущего пользователя' })
  @ApiOkResponse({ type: UserResponseDto })
  async updateMe(
    @CurrentUser() authUser: AuthUser,
    @Body() dto: UpdateUserDto,
  ): Promise<UserResponseDto> {
    const user = await this.usersService.update(authUser.id, dto);
    if (!user) {
      throw new NotFoundException('Пользователь не найден');
    }
    return UserResponseDto.from(user);
  }
}