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
import {
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import {
  ArchiveNotificationDto,
  NotificationListDto,
  ReadAllNotificationsDto,
  ReadAllNotificationsResultDto,
} from './dto/notification.dto';
import { NotificationsService } from './notifications.service';

/**
 * Уведомления правой панели (24.11.2026, §14 `topics/messages.md`).
 *
 * **Создания здесь нет намеренно** — как у `message-actions`: уведомление
 * вешает система в том коде, который знает контекст (деньги, альманах,
 * чат). Открытый наружу «создай уведомление» позволил бы подсунуть
 * человеку карточку с чужими деньгами.
 *
 * **Права.** Уведомление видит и меняет только получатель. Поэтому
 * в путях нет ни `userId`, ни `tripId`: ключ — id из токена, а чужое
 * уведомление отвечает `404` (не `403`: существование чужой карточки —
 * тоже информация).
 *
 * **Живость.** Отдельного потока нет: после закрытия и архивации уходит
 * кадр `notifications` в существующий `GET /api/conversations/events`.
 */
@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  /** Обе секции панели: системные уведомления и личные сообщения. */
  @Get()
  @ApiOperation({ summary: 'Мои уведомления' })
  @ApiOkResponse({ type: NotificationListDto })
  async list(@CurrentUser() authUser: AuthUser): Promise<NotificationListDto> {
    return this.notificationsService.listMine(authUser.id);
  }

  /**
   * Двойная зелёная галочка в заголовке секции похода (§1.3, §5.3).
   *
   * Закрывает всё, кроме `money_transfer` и `payment_request`; пустая
   * секция после этого исчезает. `tripId` — в теле, а не в пути: это
   * действие над секцией панели, а не над самой карточкой.
   */
  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Закрыть активные уведомления похода' })
  @ApiOkResponse({ type: ReadAllNotificationsResultDto })
  async readAll(
    @CurrentUser() authUser: AuthUser,
    @Body() dto: ReadAllNotificationsDto,
  ): Promise<ReadAllNotificationsResultDto> {
    return this.notificationsService.readAll(authUser.id, dto.tripId);
  }

  /**
   * «ОК» — убрать карточку без архива.
   *
   * `POST`, а не `DELETE`, потому что действие названо в интерфейсе
   * кнопкой «ОК», а не «удалить»: у чатов и альманаха это именно
   * «принято к сведению». Для денег отвечает `400` — их закрывает
   * подтверждение или оплата.
   */
  @Post(':id/close')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Закрыть уведомление без архива' })
  @ApiNoContentResponse({ description: 'Уведомление удалено' })
  async close(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.notificationsService.close(authUser.id, String(id));
  }

  /**
   * Денежное уведомление — в архив.
   *
   * Причина необязательна: сервер берёт ту, что соответствует виду
   * (перевод — `confirmed`, запрос платежа — `paid`). Экрана архива
   * в этом шаге нет, но строки хранятся — §14.2.
   */
  @Post(':id/archive')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Отправить денежное уведомление в архив' })
  @ApiNoContentResponse({ description: 'Уведомление в архиве' })
  async archive(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ArchiveNotificationDto,
  ): Promise<void> {
    return this.notificationsService.archive(authUser.id, String(id), dto.reason);
  }
}
