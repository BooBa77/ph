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
  CreateGearGroupTemplateDto,
  GearAdminGroupTemplateDto,
  GearAdminGroupTemplateListDto,
  UpdateGearGroupTemplateDto,
} from './dto/gear-group.dto';
import { GearGroupTemplatesService } from './gear-group-templates.service';

/**
 * Админка рекомендуемых групп снаряжения (02.11.2026).
 *
 * Префикс `gear/admin/group-templates` — тот же приём, что
 * `gear/admin/types`: один контроллер и одна проверка прав
 * (`isAdminUser` в сервисе). Личные группы живут под `gear-groups`
 * и доступны любому авторизованному — это его собственный каталог.
 *
 * **Удаление — архив.** `DELETE` отвечает 204 и ставит `is_active = false`;
 * повторный вызов тоже 204. Физического удаления нет: на шаблон ссылаются
 * рекомендуемые группы типов и личные копии. Исключение — «Прочее»: её
 * архив запрещён (409), потому что это умолчание.
 */
@ApiTags('gear')
@Controller('gear/admin/group-templates')
@ApiForbiddenResponse({ description: 'Раздел только для администратора' })
export class GearAdminGroupTemplatesController {
  constructor(
    private readonly templatesService: GearGroupTemplatesService,
  ) {}

  /** Все шаблоны, включая архивные, с числом рекомендованных типов. */
  @Get()
  @ApiOperation({ summary: 'Рекомендуемые группы снаряжения' })
  @ApiOkResponse({ type: GearAdminGroupTemplateListDto })
  async list(
    @CurrentUser() authUser: AuthUser,
  ): Promise<GearAdminGroupTemplateListDto> {
    return this.templatesService.listAdmin(authUser.id);
  }

  /** Новый шаблон. `code` занимается навсегда: в `PATCH` его нет. */
  @Post()
  @ApiOperation({ summary: 'Создать рекомендуемую группу' })
  @ApiCreatedResponse({ type: GearAdminGroupTemplateDto })
  async create(
    @CurrentUser() authUser: AuthUser,
    @Body() dto: CreateGearGroupTemplateDto,
  ): Promise<GearAdminGroupTemplateDto> {
    return this.templatesService.create(authUser.id, dto);
  }

  /** Правка: имя, порядок, активность. `code` не меняется — 400. */
  @Patch(':id')
  @ApiOperation({ summary: 'Изменить рекомендуемую группу' })
  @ApiOkResponse({ type: GearAdminGroupTemplateDto })
  async update(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateGearGroupTemplateDto,
  ): Promise<GearAdminGroupTemplateDto> {
    return this.templatesService.update(authUser.id, id, dto);
  }

  /** В архив: `is_active = false`, ответ 204. «Прочее» — 409. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Убрать рекомендуемую группу в архив' })
  @ApiNoContentResponse({ description: 'Шаблон в архиве' })
  async archive(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.templatesService.archive(authUser.id, id);
  }
}
