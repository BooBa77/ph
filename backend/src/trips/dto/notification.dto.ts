import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

import {
  ARCHIVE_REASONS,
  NOTIFICATION_KINDS,
  NOTIFICATION_SECTIONS,
  type ArchiveReason,
  type NotificationKind,
  type NotificationSection,
} from '../entities/notification.entity';

/**
 * Сколько последних сообщений показывает карточка чата (§14.2).
 *
 * 1–3 — требование заказчика: уведомление о чате должно давать
 * «оперативный просмотр», а не пересказ всей переписки.
 */
export const NOTIFICATION_PREVIEW_LIMIT = 3;

/** Сколько символов сообщения видно в карточке — тоже требование §14.2. */
export const NOTIFICATION_PREVIEW_CHARS = 300;

/** Одно сообщение в раскрытии карточки чата. */
export class NotificationPreviewDto {
  @ApiProperty({ description: 'Id сообщения', example: '346' })
  id: string;

  @ApiProperty({ description: 'Текст, обрезанный до 300 символов' })
  body: string;

  @ApiProperty({ description: 'Кто написал', nullable: true })
  senderId: string | null;

  @ApiProperty({ description: 'Имя автора', nullable: true })
  senderName: string | null;

  @ApiProperty({ description: 'Когда написано' })
  createdAt: string;
}

/**
 * Уведомление наружу.
 *
 * `section` сервер считает по `kind`: клиент не должен угадывать, куда
 * карточку положить. `unreadCount` и `preview` заполняются только у чатов —
 * это то, чем карточка чата отличается от денежной и альманаха.
 */
export class NotificationDto {
  @ApiProperty({ description: 'Id уведомления', example: '1' })
  id: string;

  @ApiProperty({ enum: NOTIFICATION_KINDS })
  kind: NotificationKind;

  @ApiProperty({ enum: NOTIFICATION_SECTIONS })
  section: NotificationSection;

  @ApiProperty({ description: 'Заголовок карточки', example: 'Денежный перевод' })
  title: string;

  @ApiProperty({ description: 'Текст карточки' })
  body: string;

  @ApiProperty({ description: 'Диалог, если уведомление про чат', nullable: true })
  conversationId: string | null;

  @ApiProperty({ description: 'Поход, если уведомление про поход', nullable: true })
  tripId: string | null;

  @ApiProperty({ description: 'Перевод, если уведомление про деньги', nullable: true })
  compensationId: string | null;

  @ApiProperty({
    description: 'Сколько непрочитанных в этом чате; только у чатов',
    nullable: true,
  })
  unreadCount: number | null;

  @ApiProperty({
    description: 'Последние сообщения чата (до 3); только у чатов',
    type: [NotificationPreviewDto],
  })
  preview: NotificationPreviewDto[];

  @ApiProperty({ description: 'Когда карточка создана' })
  createdAt: string;

  @ApiProperty({ description: 'Когда карточка обновлена последним событием' })
  updatedAt: string;
}

/**
 * Два раздела панели одним ответом.
 *
 * Счётчики — длины самих списков: они считают **активные уведомления**,
 * а не непрочитанные сообщения, и второй раз клиенту считать нечего.
 */
export class NotificationListDto {
  @ApiProperty({ type: [NotificationDto] })
  system: NotificationDto[];

  @ApiProperty({ type: [NotificationDto] })
  personal: NotificationDto[];

  @ApiProperty({ description: 'Счётчик системных уведомлений' })
  systemCount: number;

  @ApiProperty({ description: 'Счётчик личных уведомлений' })
  personalCount: number;
}

/** Тело `POST /api/notifications/:id/archive`. */
export class ArchiveNotificationDto {
  @ApiProperty({
    description:
      'Почему в архив: confirmed — подтвердил человек, expired72 — вышло ' +
      'время, paid — долг оплачен. По умолчанию — по виду уведомления.',
    enum: ARCHIVE_REASONS,
    required: false,
  })
  @IsOptional()
  @IsIn(ARCHIVE_REASONS, {
    message: 'Причина архивации — confirmed, expired72 или paid',
  })
  reason?: ArchiveReason;
}
