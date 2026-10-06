import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { UsersService } from './users.service';
import { AvatarService } from './avatar.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { UserResponseDto } from './dto/user-response.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UploadAvatarDto } from './dto/upload-avatar.dto';
import { MAX_UPLOAD_BYTES } from '../config/uploads.config';

/**
 * Настройки приёма файла.
 *
 * memoryStorage, а не diskStorage: файл всё равно проходит через sharp,
 * то есть целиком оказывается в памяти. Писать его сначала на диск
 * во временный файл, а потом читать обратно — лишние операции ввода-вывода.
 *
 * `limits.fileSize` — первый рубеж на пути больших файлов: multer
 * обрывает приём и не даёт держать в памяти произвольный объём. Это же
 * ограничение повторно проверяется в AvatarService — там, где о нём
 * пишут сообщение пользователю.
 */
const avatarUploadOptions = {
  storage: memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
  },
};

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly avatarService: AvatarService,
  ) {}

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
   *
   * Аватарки здесь нет: она меняется отдельными эндпоинтами ниже.
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

  /**
   * Загрузить аватарку.
   *
   * Принимает multipart/form-data, поле `file`. Картинка приводится
   * к 150×150 WebP и кладётся в локальное хранилище; в `users.avatar_url`
   * записывается путь вида `/api/uploads/avatars/<id>/<uuid>.webp`,
   * по которому бэкенд её и раздаёт.
   *
   * Возвращает обновлённый профиль — чтобы фронт не делал второй запрос
   * за тем же самым.
   */
  @Post('me/avatar')
  @ApiOperation({ summary: 'Загрузить аватарку текущего пользователя' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadAvatarDto })
  @ApiOkResponse({ type: UserResponseDto })
  @UseInterceptors(FileInterceptor('file', avatarUploadOptions))
  async uploadAvatar(
    @CurrentUser() authUser: AuthUser,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<UserResponseDto> {
    const user = await this.avatarService.upload(authUser.id, file);
    return UserResponseDto.from(user);
  }

  /**
   * Сбросить аватарку: `avatar_url = null`, файл удалить.
   *
   * Возвращает обновлённый профиль по той же причине, что и загрузка.
   * Отдельный DELETE, а не PATCH с `avatarUrl: null`: строку в поле
   * профиля писать снаружи больше нельзя — иначе в неё можно подсунуть
   * чужой URL, а файл останется сиротой.
   */
  @Delete('me/avatar')
  @ApiOperation({ summary: 'Сбросить аватарку текущего пользователя' })
  @ApiOkResponse({ type: UserResponseDto })
  async resetAvatar(
    @CurrentUser() authUser: AuthUser,
  ): Promise<UserResponseDto> {
    const user = await this.avatarService.reset(authUser.id);
    return UserResponseDto.from(user);
  }
}
