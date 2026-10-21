import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
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
import { UserPublicProfileDto } from './dto/user-public.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UploadAvatarDto } from './dto/upload-avatar.dto';
import {
  UserSearchListDto,
  UserSearchQueryDto,
  UserSearchResultDto,
} from './dto/user-search.dto';
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
   * Найти людей по имени — для приглашения в поход.
   *
   * Отдаёт только публичную часть: id, имя, аватарку. Ни email, ни города,
   * ни спортивного опыта — чтобы позвать человека в поход, этого хватает,
   * а остальное он показывает сам.
   *
   * Без `search` возвращается пустой список, а не все пользователи: список
   * выбора не должен открываться «простынёй» из сотен имён.
   */
  @Get()
  @ApiOperation({ summary: 'Поиск людей по имени' })
  @ApiOkResponse({ type: UserSearchListDto })
  async search(
    @CurrentUser() authUser: AuthUser,
    @Query() query: UserSearchQueryDto,
  ): Promise<UserSearchListDto> {
    const users = await this.usersService.search(query.search, authUser.id);

    return { users: users.map((user) => UserSearchResultDto.from(user)) };
  }

  /**
   * Публичный профиль человека — для страницы «Контакты».
   *
   * Отдаёт **не** свой профиль: ни пищевых ограничений, ни аллергий,
   * ни спортивного опыта там нет (см. `UserPublicProfileDto`). Это то,
   * что и так видно в походах: имя, аватарка, город, «на сайте с».
   *
   * Роут объявлен **после** `me` и `me/avatar`: `me` — литеральный путь,
   * и если поставить `:id` выше, «me» попал бы в `ParseUUIDPipe` и вернул
   * бы 400 вместо профиля. Удалённый (soft delete) человек — 404:
   * о нём нечего рассказывать.
   */
  @Get(':id')
  @ApiOperation({ summary: 'Публичный профиль человека' })
  @ApiOkResponse({ type: UserPublicProfileDto })
  async getPublicProfile(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserPublicProfileDto> {
    const user = await this.usersService.findById(id);
    if (!user || user.deletedAt !== null) {
      throw new NotFoundException('Пользователь не найден');
    }

    return UserPublicProfileDto.from(user, user.id === authUser.id);
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
