import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { ConversationsService } from './conversations.service';
import {
  ConversationDto,
  ConversationListDto,
  OpenDirectDto,
} from './dto/conversation.dto';

/**
 * Диалоги человека: чаты походов и личные в одном списке.
 *
 * Сейчас это обслуживает **конвертик в шапке**: «что новое и где».
 * Полноценного мессенджера в проекте нет и не планируется — общение идёт
 * в чатах вкладок похода, а личные диалоги появляются только для денежных
 * подтверждений.
 *
 * Отправка сообщений в походный чат живёт в `TripsController`: там уже
 * проверяются правила доступа к походу, и дублировать их здесь не надо.
 */
@ApiTags('conversations')
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  /** Мои диалоги: последнее сообщение, непрочитанное, собеседник. */
  @Get()
  @ApiOperation({ summary: 'Мои диалоги' })
  @ApiOkResponse({ type: ConversationListDto })
  async list(@CurrentUser() authUser: AuthUser): Promise<ConversationListDto> {
    return this.conversationsService.listMine(authUser.id);
  }

  /**
   * Открыть личный диалог: существующий или новый.
   *
   * `POST`, а не `GET`: первый запрос создаёт диалог и строки состава.
   * Идемпотентно — пара участников хранится отсортированной, повторный
   * запрос в любую сторону вернёт тот же диалог.
   */
  @Post('direct')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Открыть личный диалог' })
  @ApiCreatedResponse({ type: ConversationDto })
  async openDirect(
    @CurrentUser() authUser: AuthUser,
    @Body() dto: OpenDirectDto,
  ): Promise<ConversationDto> {
    return this.conversationsService.openDirect(authUser.id, dto);
  }

  /** Отметить диалог прочитанным. */
  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Отметить диалог прочитанным' })
  async markRead(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.conversationsService.markRead(authUser.id, id);
  }
}
