import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import {
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import {
  MessageActionDto,
  PendingActionsDto,
  RespondActionDto,
} from './dto/message-action.dto';
import { MessageActionsService } from './message-actions.service';

/**
 * Действия в сообщениях — кнопки «Да» / «Нет».
 *
 * Роуты отдельные от сообщений, потому что действие живёт своей жизнью:
 * оно одно, а сообщений, которые его показывают, может быть два (чат
 * похода и личный диалог). Кто и что может — решает сервис: адресат
 * отвечает, отправитель переспрашивает или отменяет.
 *
 * **Создания здесь нет намеренно.** Действие вешает сервер — тот код,
 * который знает контекст (у денег это Бухгалтерия). Открытый наружу
 * «создай действие» позволил бы вешать кнопки на чужие сообщения.
 */
@ApiTags('message-actions')
@Controller('message-actions')
export class MessageActionsController {
  constructor(private readonly actionsService: MessageActionsService) {}

  /** Что ждёт моего ответа и что ждёт моего внимания — для конвертика. */
  @Get('pending')
  @ApiOperation({ summary: 'Нерешённые действия' })
  @ApiOkResponse({ type: PendingActionsDto })
  async pending(@CurrentUser() authUser: AuthUser): Promise<PendingActionsDto> {
    return this.actionsService.pending(authUser.id);
  }

  /** Ответ адресата: «получено» или «не получено». */
  @Post(':id/respond')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ответить на действие' })
  @ApiOkResponse({ type: MessageActionDto })
  async respond(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RespondActionDto,
  ): Promise<MessageActionDto> {
    return this.actionsService.respond(authUser.id, id, dto.result);
  }

  /** Отправитель просит посмотреть ещё раз. */
  @Post(':id/recheck')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Переспросить получателя' })
  @ApiOkResponse({ type: MessageActionDto })
  async recheck(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<MessageActionDto> {
    return this.actionsService.recheck(authUser.id, id);
  }

  /**
   * «Мой косяк, отменяем» — удаляет действие и его сообщения.
   *
   * DELETE, а не POST с состоянием: отмена не меняет состояние, она
   * убирает запись. Иначе получатель мог бы позже нажать «Да» на отменённом
   * переводе и сломать баланс.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Отменить действие и удалить его сообщения' })
  @ApiNoContentResponse({ description: 'Действие и сообщения удалены' })
  async cancel(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.actionsService.cancel(authUser.id, id);
  }
}
