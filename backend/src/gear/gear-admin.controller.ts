import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import {
  CreateGearAttributeOptionDto,
  CreateGearTypeAttributeDto,
  CreateGearTypeDto,
  GearAdminAttributeOptionDto,
  GearAdminTypeAttributeDto,
  GearAdminTypeDto,
  GearAdminTypeListDto,
  UpdateGearAttributeOptionDto,
  UpdateGearTypeAttributeDto,
  UpdateGearTypeDto,
} from './dto/gear-type.dto';
import { GearTypesService } from './gear-types.service';

/**
 * Админка справочника типов снаряжения.
 *
 * Префикс `gear/admin` — приём из календаря (`calendar/admin/...`): один
 * контроллер и одна проверка прав, публичный `gear-types` остаётся только
 * чтением. Права проверяет сервис (`isAdminUser`, захардкоженный UUID):
 * не-админ получает 403 «Раздел только для администратора», без токена —
 * 401 от глобального guard-а.
 *
 * **Удаление — архив.** `DELETE` отвечает 204 и ставит `is_active = false`;
 * повторный вызов тоже 204. Физического удаления нет: в Stage B на тип
 * будут ссылаться вещи, а на характеристику и её вариант — значения.
 *
 * **Три уровня вложенности:** тип → характеристика → вариант списка.
 * Пути повторяют модель (`/types/:id/attributes/:attributeId/options`),
 * потому что каждый уровень проверяет принадлежность верхнему: чужой id
 * отвечает 404, а не правит строку соседа.
 */
@ApiTags('gear')
@Controller('gear/admin/types')
@ApiForbiddenResponse({ description: 'Раздел только для администратора' })
export class GearAdminTypesController {
  constructor(private readonly gearTypesService: GearTypesService) {}

  /** Все типы, включая архивные, со всеми характеристиками. */
  @Get()
  @ApiOperation({ summary: 'Типы снаряжения для админки' })
  @ApiOkResponse({ type: GearAdminTypeListDto })
  async list(
    @CurrentUser() authUser: AuthUser,
  ): Promise<GearAdminTypeListDto> {
    return this.gearTypesService.listAdmin(authUser.id);
  }

  /** Новый тип. `code` занимается навсегда: в `PATCH` его нет. */
  @Post()
  @ApiOperation({ summary: 'Создать тип снаряжения' })
  @ApiCreatedResponse({ type: GearAdminTypeDto })
  async create(
    @CurrentUser() authUser: AuthUser,
    @Body() dto: CreateGearTypeDto,
  ): Promise<GearAdminTypeDto> {
    return this.gearTypesService.createType(authUser.id, dto);
  }

  /** Правка типа: имя, порядок, активность. `code` не меняется — 400. */
  @Patch(':id')
  @ApiOperation({ summary: 'Изменить тип снаряжения' })
  @ApiOkResponse({ type: GearAdminTypeDto })
  async update(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateGearTypeDto,
  ): Promise<GearAdminTypeDto> {
    return this.gearTypesService.updateType(authUser.id, id, dto);
  }

  /** В архив: `is_active = false`, ответ 204. Повторный вызов идемпотентен. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Убрать тип в архив' })
  @ApiNoContentResponse({ description: 'Тип в архиве' })
  async archive(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.gearTypesService.archiveType(authUser.id, id);
  }

  /**
   * Новая характеристика типа.
   *
   * `fillMissing` принимается и валидируется по виду значения, но в Stage A
   * никуда не пишется — таблицы значений ещё нет. `options` позволяет завести
   * список вариантов сразу, одной транзакцией с характеристикой.
   */
  @Post(':id/attributes')
  @ApiOperation({ summary: 'Добавить характеристику типа' })
  @ApiCreatedResponse({ type: GearAdminTypeAttributeDto })
  async createAttribute(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateGearTypeAttributeDto,
  ): Promise<GearAdminTypeAttributeDto> {
    return this.gearTypesService.createAttribute(authUser.id, id, dto);
  }

  /** Правка характеристики. `code` — 400, `valueKind` — 409. */
  @Patch(':id/attributes/:attributeId')
  @ApiOperation({ summary: 'Изменить характеристику типа' })
  @ApiOkResponse({ type: GearAdminTypeAttributeDto })
  async updateAttribute(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('attributeId', ParseIntPipe) attributeId: number,
    @Body() dto: UpdateGearTypeAttributeDto,
  ): Promise<GearAdminTypeAttributeDto> {
    return this.gearTypesService.updateAttribute(
      authUser.id,
      id,
      attributeId,
      dto,
    );
  }

  /** В архив: `is_active = false`, ответ 204. Повторный вызов идемпотентен. */
  @Delete(':id/attributes/:attributeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Убрать характеристику в архив' })
  @ApiNoContentResponse({ description: 'Характеристика в архиве' })
  async archiveAttribute(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('attributeId', ParseIntPipe) attributeId: number,
  ): Promise<void> {
    return this.gearTypesService.archiveAttribute(
      authUser.id,
      id,
      attributeId,
    );
  }

  // ─────────────────── варианты характеристики-списка ───────────────────

  /**
   * Новый вариант списка.
   *
   * Второй способ завести варианты: первый — сразу в `POST attributes`
   * (`options` в теле). Отдельная ручка нужна, чтобы добавлять варианты
   * к уже существующей характеристике, не пересоздавая её.
   */
  @Post(':id/attributes/:attributeId/options')
  @ApiOperation({ summary: 'Добавить вариант списка' })
  @ApiCreatedResponse({ type: GearAdminAttributeOptionDto })
  async createOption(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('attributeId', ParseIntPipe) attributeId: number,
    @Body() dto: CreateGearAttributeOptionDto,
  ): Promise<GearAdminAttributeOptionDto> {
    return this.gearTypesService.createOption(
      authUser.id,
      id,
      attributeId,
      dto,
    );
  }

  /** Переименование и порядок варианта. `code` — 400. */
  @Patch(':id/attributes/:attributeId/options/:optionId')
  @ApiOperation({ summary: 'Изменить вариант списка' })
  @ApiOkResponse({ type: GearAdminAttributeOptionDto })
  async updateOption(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('attributeId', ParseIntPipe) attributeId: number,
    @Param('optionId', ParseIntPipe) optionId: number,
    @Body() dto: UpdateGearAttributeOptionDto,
  ): Promise<GearAdminAttributeOptionDto> {
    return this.gearTypesService.updateOption(
      authUser.id,
      id,
      attributeId,
      optionId,
      dto,
    );
  }

  /**
   * В архив: `is_active = false`, ответ 204.
   *
   * Последний вариант списка без разрешённого своего значения убрать
   * нельзя — 409: характеристика осталась бы «выбирать не из чего».
   */
  @Delete(':id/attributes/:attributeId/options/:optionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Убрать вариант в архив' })
  @ApiNoContentResponse({ description: 'Вариант в архиве' })
  async archiveOption(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('attributeId', ParseIntPipe) attributeId: number,
    @Param('optionId', ParseIntPipe) optionId: number,
  ): Promise<void> {
    return this.gearTypesService.archiveOption(
      authUser.id,
      id,
      attributeId,
      optionId,
    );
  }
}
