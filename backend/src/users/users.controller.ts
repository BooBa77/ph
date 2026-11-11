import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { UsersService } from './users.service';
import { FamilyUnionService } from './family-union.service';
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
import {
  AddFamilyMemberDto,
  FamilyListDto,
  FamilyUnionPreviewDto,
  FamilyUnionResultDto,
} from './dto/family.dto';
import {
  CreateVirtualUserDto,
  UpdateVirtualUserDto,
  VirtualUserDto,
  VirtualUserListDto,
} from './dto/virtual-user.dto';
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
    private readonly familyUnions: FamilyUnionService,
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
   * о нём нечего рассказывать. **Человек без аккаунта — тоже 404**
   * (30.10.2026): у него нет профиля, он живёт только в походе, и страница
   * «Контакты» про него ничего не знает — ровно как про удалённого.
   */
  @Get(':id')
  @ApiOperation({ summary: 'Публичный профиль человека' })
  @ApiOkResponse({ type: UserPublicProfileDto })
  async getPublicProfile(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserPublicProfileDto> {
    const user = await this.usersService.findById(id);
    if (!user || user.deletedAt !== null || user.isVirtual) {
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

  // ─────────────────── люди без аккаунта (30.10.2026) ───────────────────

  /**
   * Завести человека без аккаунта отдельно от похода (10.11.2026).
   *
   * Раньше единственным путём было «завести и сразу в поход». Заказчик
   * попросил обратное: в «Контактах» есть секция «Люди без аккаунта, под
   * моим управлением», где человек заводится сам по себе, а уже потом
   * добавляется в поход («может в поле Люди_без_аккаунта/Имя?»).
   *
   * Модель та же — строка `users` без входа, одна на человека. Создание
   * подчиняется тем же правилам, что и в походе: имя проверяет общий DTO,
   * пол по умолчанию `m`.
   */
  @Post('me/virtual')
  @ApiOperation({ summary: 'Завести человека без аккаунта' })
  @ApiCreatedResponse({ type: VirtualUserDto })
  async createVirtual(
    @CurrentUser() authUser: AuthUser,
    @Body() dto: CreateVirtualUserDto,
  ): Promise<VirtualUserDto> {
    const user = await this.usersService.createVirtual(authUser.id, dto);

    return VirtualUserDto.from(user);
  }

  /**
   * Мои люди без аккаунта — для «быстрого добавления» в следующий поход.
   *
   * Список личный: у каждого организатора свой, и чужой не виден.
   * Заводит их `POST /api/trips/:id/participants/virtual` — человек
   * без аккаунта появляется вместе с походом, а не сам по себе.
   */
  @Get('me/virtual')
  @ApiOperation({ summary: 'Мои люди без аккаунта' })
  @ApiOkResponse({ type: VirtualUserListDto })
  async listVirtual(
    @CurrentUser() authUser: AuthUser,
  ): Promise<VirtualUserListDto> {
    return { users: await this.usersService.listVirtual(authUser.id) };
  }

  /**
   * Переименовать или поменять пол. Только своего: чужой — 404.
   *
   * Пол нужен распределению веса рюкзака (доля женщины 0,8), поэтому
   * правится отдельным полем, а не спрашивается один раз при создании.
   */
  @Patch('me/virtual/:userId')
  @ApiOperation({ summary: 'Изменить человека без аккаунта' })
  @ApiOkResponse({ type: VirtualUserDto })
  async updateVirtual(
    @CurrentUser() authUser: AuthUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateVirtualUserDto,
  ): Promise<VirtualUserDto> {
    const user = await this.usersService.updateVirtual(
      authUser.id,
      userId,
      dto,
    );

    return VirtualUserDto.from(user);
  }

  /**
   * Убрать из личного списка. Мягко (`deleted_at`), 409 если он ещё
   * участвует в походе: сначала убирают из состава.
   */
  @Delete('me/virtual/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Убрать человека без аккаунта из списка' })
  @ApiNoContentResponse({ description: 'Человек убран из списка' })
  async removeVirtual(
    @CurrentUser() authUser: AuthUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    return this.usersService.removeVirtual(authUser.id, userId);
  }

  // ────────────────────── родные и объединение семей (10–11.11.2026) ──────────────────────

  /**
   * Мои родные, входящие и исходящие заявки на объединение семей.
   *
   * С 11.11.2026 запрос — не пара «кто кого позвал», а состав из **двух
   * семей целиком** (`FamilyUnionService`). Поэтому ответ собирается из
   * двух источников: родные — `UsersService.familyOf`, заявки —
   * `FamilyUnionService.listFor`. Так «ждём ответа» не смешивается
   * с «уже родные» ни в DTO, ни в запросах к базе.
   */
  @Get('me/family')
  @ApiOperation({ summary: 'Мои родные и заявки на объединение семей' })
  @ApiOkResponse({ type: FamilyListDto })
  async listFamily(
    @CurrentUser() authUser: AuthUser,
  ): Promise<FamilyListDto> {
    const [family, unions] = await Promise.all([
      this.usersService.familyOf(authUser.id),
      this.familyUnions.listFor(authUser.id),
    ]);

    return { family, incoming: unions.incoming, outgoing: unions.outgoing };
  }

  /**
   * Что будет, если добавить этого человека.
   *
   * Заказчик: «Инициатор собирает обе компоненты; показывает список людей
   * и предупреждение „снаряжение станет общим“; подтверждает — заявка
   * создана». Предпросмотр показывает состав до нажатия «Добавить».
   */
  @Get('me/family/preview/:userId')
  @ApiOperation({ summary: 'Состав объединения семей до подтверждения' })
  @ApiOkResponse({ type: FamilyUnionPreviewDto })
  async previewFamilyUnion(
    @CurrentUser() authUser: AuthUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<FamilyUnionPreviewDto> {
    return this.familyUnions.preview(authUser.id, userId);
  }

  /**
   * Добавить человека в родные.
   *
   * Настоящему человеку создаётся заявка на объединение **обеих семей**;
   * свой человек без аккаунта становится родным сразу. Повтор, встреча
   * и «уже родные» описаны в `FamilyUnionService.create`.
   */
  @Post('me/family')
  @ApiOperation({ summary: 'Добавить человека в родные' })
  @ApiCreatedResponse({ type: FamilyUnionResultDto })
  async addFamilyMember(
    @CurrentUser() authUser: AuthUser,
    @Body() dto: AddFamilyMemberDto,
  ): Promise<FamilyUnionResultDto> {
    return this.familyUnions.create(authUser.id, dto.userId);
  }

  /** Принять входящую заявку: моё согласие, а когда согласны все — слияние. */
  @Post('me/family/unions/:unionId/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Принять заявку на объединение семей' })
  @ApiOkResponse({ type: FamilyUnionResultDto })
  async acceptFamilyUnion(
    @CurrentUser() authUser: AuthUser,
    @Param('unionId', ParseUUIDPipe) unionId: string,
  ): Promise<FamilyUnionResultDto> {
    const result = await this.familyUnions.respond(authUser.id, unionId, true);

    return { unionId, status: result.status === 'accepted' ? 'accepted' : 'pending' };
  }

  /** Отклонить заявку: заявка закрывается, ни одной связи не появляется. */
  @Post('me/family/unions/:unionId/decline')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Отклонить заявку на объединение семей' })
  @ApiNoContentResponse({ description: 'Заявка отклонена' })
  async declineFamilyUnion(
    @CurrentUser() authUser: AuthUser,
    @Param('unionId', ParseUUIDPipe) unionId: string,
  ): Promise<void> {
    await this.familyUnions.respond(authUser.id, unionId, false);
  }

  /**
   * Отменить свою заявку — то есть заявку, которую я же и завёл.
   *
   * Принятую связь эта ручка не разрывает: выйти из семьи можно только
   * целиком (`DELETE me/family`). Отказ на входящую — `…/decline`.
   */
  @Delete('me/family/unions/:unionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Отменить заявку на объединение семей' })
  @ApiNoContentResponse({ description: 'Заявка отменена' })
  async cancelFamilyUnion(
    @CurrentUser() authUser: AuthUser,
    @Param('unionId', ParseUUIDPipe) unionId: string,
  ): Promise<void> {
    return this.familyUnions.cancel(authUser.id, unionId);
  }

  /**
   * Выйти из семьи — разорвать все семейные связи.
   *
   * Отдельная ручка без `:userId` намеренно: разрыв одной пары внутри
   * компоненты оставил бы «полу-связи», а заказчик решил, что выход —
   * всегда целиком (11.11.2026). Каталог не трогается: у каждого остаётся
   * его копия вещи. Висящие заявки с участием человека закрываются.
   */
  @Delete('me/family')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Выйти из семьи — все связи' })
  @ApiNoContentResponse({ description: 'Семейных связей больше нет' })
  async leaveFamily(@CurrentUser() authUser: AuthUser): Promise<void> {
    return this.familyUnions.leaveFamily(authUser.id);
  }
}
