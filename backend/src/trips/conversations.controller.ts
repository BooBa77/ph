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
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { ConversationEventsService } from './conversation-events.service';
import { ConversationsService } from './conversations.service';
import { streamConversationEvents } from './trip-events-stream';
import {
  ConversationDto,
  ConversationListDto,
  ConversationMessageQueryDto,
  EditConversationMessageDto,
  OpenDirectDto,
  SendConversationMessageDto,
} from './dto/conversation.dto';
import { TripMessageDto, TripMessageListDto } from './dto/message.dto';

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
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly events: ConversationEventsService,
  ) {}

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

  /**
   * Поток событий переписки (SSE) — один на человека (24.11.2026).
   *
   * Заказчик: «экран диалога не обновляется вовсе — новое сообщение видно
   * лишь после повторного открытия». Лента при этом жила по фокусу и минуте.
   *
   * **Почему на человека, а не на диалог.** Чатов у человека девять,
   * вкладка одна: девять соединений вместо одного. Кадр несёт
   * `conversationId`, и клиент раскладывает его и по ленте, и по открытому
   * диалогу. Чаты похода едут по этому же потоку: сообщения в них те же.
   *
   * **Почему не `@Sse()`.** Декоратор подписывается на Observable, который
   * возвращает обработчик, а нам нужен один и тот же поток под Node-
   * `Response` (заголовки, `retry`, heartbeat) — общий с вкладками похода.
   *
   * **Права проверять нечего.** Поток личный, ключ — id из токена:
   * подписаться на чужой нечем. Аноним отсекается guard до первого байта,
   * то есть отвечает обычным 401 JSON, а не висящим потоком.
   *
   * **Роут объявлен до `:id`.** `GET /conversations/events` иначе попал бы
   * в `:id` и упал бы в `ParseIntPipe` с 400: Express берёт первый
   * совпавший маршрут в порядке объявления.
   */
  @Get('events')
  @ApiOperation({ summary: 'Поток событий переписки (SSE)' })
  @ApiOkResponse({
    description:
      'text/event-stream: кадры `event: conversation`, данные — JSON ' +
      '{conversationId, kind, actorId, at}',
  })
  stream(
    @CurrentUser() authUser: AuthUser,
    @Req() request: Request,
    @Res() response: Response,
  ): void {
    streamConversationEvents(this.events, authUser.id, request, response);
  }

  /**
   * Один диалог — шапка экрана `/messages/:id`.
   *
   * Экран открывается по прямой ссылке, и о диалоге у него есть только id.
   * Отдаём **ту же** `ConversationDto`, что и список: подпись, собеседник,
   * название похода, непрочитанное и состояние галочки «Уведомлять».
   *
   * Роут стоит после `direct` и `:id/read`: `direct` — литеральный путь,
   * а `:id/messages` и `:id/mute` длиннее, поэтому `:id` их не перехватывает.
   */
  @Get(':id')
  @ApiOperation({ summary: 'Диалог по id' })
  @ApiOkResponse({ type: ConversationDto })
  async getOne(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ConversationDto> {
    return this.conversationsService.getOne(authUser.id, id);
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

  /**
   * Сообщения диалога — страница в хронологическом порядке.
   *
   * Курсор `before` — id самого старого сообщения, которое уже есть
   * у клиента: лента дочитывает историю вверх.
   */
  @Get(':id/messages')
  @ApiOperation({ summary: 'Сообщения диалога' })
  @ApiOkResponse({ type: TripMessageListDto })
  async listMessages(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ConversationMessageQueryDto,
  ): Promise<TripMessageListDto> {
    return this.conversationsService.listMessages(authUser.id, id, query);
  }

  /** Отправить сообщение в диалог. Текст — markdown, санитайз при рендере. */
  @Post(':id/messages')
  @ApiOperation({ summary: 'Отправить сообщение в диалог' })
  @ApiCreatedResponse({ type: TripMessageDto })
  async sendMessage(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SendConversationMessageDto,
  ): Promise<TripMessageDto> {
    return this.conversationsService.sendMessage(authUser.id, id, dto);
  }

  /**
   * Изменить своё сообщение (25.11.2026).
   *
   * Права — на сервере: чужое и системное не правится (403), сообщения
   * с денежным действием тоже — текст уведомления о переводе человеку
   * не принадлежит. Новый текст уезжает в поток `message_updated`, поэтому
   * правку видит и вторая вкладка, и собеседник, без перезагрузки.
   */
  @Patch(':id/messages/:messageId')
  @ApiOperation({ summary: 'Изменить своё сообщение' })
  @ApiOkResponse({ type: TripMessageDto })
  async editMessage(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('messageId', ParseIntPipe) messageId: number,
    @Body() dto: EditConversationMessageDto,
  ): Promise<TripMessageDto> {
    return this.conversationsService.editMessage(
      authUser.id,
      id,
      String(messageId),
      dto,
    );
  }

  /**
   * Удалить своё сообщение (25.11.2026).
   *
   * Физически: строки в `messages` не остаётся, поэтому непрочитанное
   * у собеседника пересчитывается само, а в открытой переписке обоих
   * появляется кадр `message_deleted`. Ответ — 204: возвращать нечего.
   */
  @Delete(':id/messages/:messageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить своё сообщение' })
  async deleteMessage(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('messageId', ParseIntPipe) messageId: number,
  ): Promise<void> {
    return this.conversationsService.deleteMessage(
      authUser.id,
      id,
      String(messageId),
    );
  }

  /**
   * Заглушить уведомления по диалогу.
   *
   * Галочка в ленте и под чатом похода делает одно и то же: диалог
   * перестаёт попадать в ленту. Непрочитанное в самом чате остаётся.
   */
  @Post(':id/mute')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Заглушить уведомления по диалогу' })
  async mute(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.conversationsService.setMuted(authUser.id, id, true);
  }

  /** Вернуть уведомления по диалогу — «возможность вернуть есть». */
  @Delete(':id/mute')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Вернуть уведомления по диалогу' })
  async unmute(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.conversationsService.setMuted(authUser.id, id, false);
  }
}
