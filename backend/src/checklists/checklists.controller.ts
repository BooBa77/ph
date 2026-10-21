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
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { ChecklistsService } from './checklists.service';
import {
  ChecklistDto,
  ChecklistItemDto,
  ChecklistListDto,
  CreateChecklistDto,
  CreateChecklistItemDto,
  UpdateChecklistDto,
  UpdateChecklistItemDto,
} from './dto/checklist.dto';

/**
 * Чек-листы: шаблоны пользователя и пункты любого списка.
 *
 * Пути разделены по смыслу: `/api/checklists` — «мои списки и пункты»,
 * `/api/trips/:id/checklists` (`TripChecklistsController`) — «списки
 * в походе». Так интерфейсу не нужно знать, что шаблон и общий список
 * лежат в одной таблице: он ходит по разным адресам за разными вещами.
 *
 * Пункты правятся **одними и теми же** роутами независимо от того, к какому
 * списку они относятся: правила («отмечает участник, правит организатор»)
 * проверяет сервис по самому списку. Иначе появилось бы три набора
 * одинаковых обработчиков, различающихся одной проверкой.
 */
@ApiTags('checklists')
@Controller('checklists')
export class ChecklistsController {
  constructor(private readonly checklistsService: ChecklistsService) {}

  /** Мои шаблоны — списком, с пунктами. */
  @Get()
  @ApiOperation({ summary: 'Мои шаблоны чек-листов' })
  @ApiOkResponse({ type: ChecklistListDto })
  async list(@CurrentUser() authUser: AuthUser): Promise<ChecklistListDto> {
    return this.checklistsService.listTemplates(authUser.id);
  }

  /** Новый шаблон. Пункты добавляются отдельно. */
  @Post()
  @ApiOperation({ summary: 'Создать шаблон чек-листа' })
  @ApiCreatedResponse({ type: ChecklistDto })
  async create(
    @CurrentUser() authUser: AuthUser,
    @Body() dto: CreateChecklistDto,
  ): Promise<ChecklistDto> {
    return this.checklistsService.createTemplate(authUser.id, dto);
  }

  /** Один список с пунктами. */
  @Get(':id')
  @ApiOperation({ summary: 'Чек-лист по id' })
  @ApiOkResponse({ type: ChecklistDto })
  async findOne(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ChecklistDto> {
    return this.checklistsService.findOne(authUser.id, id);
  }

  /** Переименовать список. */
  @Patch(':id')
  @ApiOperation({ summary: 'Переименовать чек-лист' })
  @ApiOkResponse({ type: ChecklistDto })
  async rename(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateChecklistDto,
  ): Promise<ChecklistDto> {
    return this.checklistsService.renameChecklist(authUser.id, id, dto);
  }

  /** Удалить список вместе с пунктами. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить чек-лист' })
  @ApiNoContentResponse({ description: 'Список удалён' })
  async remove(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.checklistsService.deleteChecklist(authUser.id, id);
  }

  /** Добавить пункт в список. */
  @Post(':id/items')
  @ApiOperation({ summary: 'Добавить пункт' })
  @ApiCreatedResponse({ type: ChecklistItemDto })
  async addItem(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateChecklistItemDto,
  ): Promise<ChecklistItemDto> {
    return this.checklistsService.addItem(authUser.id, id, dto);
  }

  /**
   * Изменить пункт: текст, отметку или то и другое.
   *
   * Отметка и текст — разные права, поэтому проверяются оба: в общем списке
   * похода отметить может участник, переименовать — только организатор.
   */
  @Patch('items/:itemId')
  @ApiOperation({ summary: 'Изменить пункт' })
  @ApiOkResponse({ type: ChecklistItemDto })
  async updateItem(
    @CurrentUser() authUser: AuthUser,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() dto: UpdateChecklistItemDto,
  ): Promise<ChecklistItemDto> {
    return this.checklistsService.updateItem(authUser.id, itemId, dto);
  }

  /** Удалить пункт. */
  @Delete('items/:itemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить пункт' })
  @ApiNoContentResponse({ description: 'Пункт удалён' })
  async removeItem(
    @CurrentUser() authUser: AuthUser,
    @Param('itemId', ParseIntPipe) itemId: number,
  ): Promise<void> {
    return this.checklistsService.deleteItem(authUser.id, itemId);
  }
}
