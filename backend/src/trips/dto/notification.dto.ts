import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

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

  @ApiProperty({
    description:
      'Анонс свёрнутой карточки (26.11.2026). Отдельное поле: у половины ' +
      'видов анонс — не начало содержимого; клиент обрезает до 75 символов',
  })
  announce: string;

  @ApiProperty({ description: 'Содержимое раскрытой карточки' })
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
    description:
      'Получатель карточки вышел из похода: «Бухгалтерия» ему закрыта, ' +
      'подтвердить перевод он может только из карточки. Только у перевода, ' +
      'иначе null',
    nullable: true,
  })
  viewerDeclined: boolean | null;

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
 * Секция похода: заголовок, дата и карточки одного похода (§6).
 *
 * `tripName` — уже готовое имя (`tripNameOf`: цель, иначе «поход #N»);
 * префикс «поход» клиент добавляет сам. `startsAt` нужен мобильной панели
 * и сортировке, хотя порядок секций уже задан сервером.
 */
export class NotificationSectionDto {
  @ApiProperty({ description: 'Поход секции' })
  tripId: string;

  @ApiProperty({ description: 'Имя похода: цель, иначе «поход #N»' })
  tripName: string;

  @ApiProperty({ description: 'Дата начала похода', nullable: true })
  startsAt: string | null;

  @ApiProperty({ type: [NotificationDto] })
  items: NotificationDto[];
}

/**
 * Ответ панели: секции походов, «Сообщения» и счётчики (26.11.2026).
 *
 * **Почему `sections` вместо `system`.** Спецификация §1.1: панель — не
 * две секции, а отдельные блоки по походам плюс «Сообщения» последней.
 * Порядок секций и карточек задаёт сервер, клиент его не пересортировывает.
 *
 * **Легаси `system` живёт до переезда фронта.** Панель части 2 переедет
 * на `sections`, а dev-панель этой сессии ещё читает плоский `system`
 * и поле `section` у карточки. Оба поля удаляются вместе с фронтом —
 * это осознанная временная совместимость, а не второй контракт.
 */
export class NotificationListDto {
  @ApiProperty({ type: [NotificationSectionDto] })
  sections: NotificationSectionDto[];

  @ApiProperty({ type: [NotificationDto] })
  personal: NotificationDto[];

  @ApiProperty({ description: 'Сколько секций походов с карточками' })
  tripCount: number;

  @ApiProperty({ description: 'Счётчик личных уведомлений' })
  personalCount: number;

  @ApiProperty({ description: 'Активных карточек всего' })
  total: number;

  @ApiProperty({
    type: [NotificationDto],
    description:
      'Легаси плоский список системных карточек для старого фронта. ' +
      'Удаляется вместе с полем `section` после переезда панели',
  })
  system: NotificationDto[];

  @ApiProperty({ description: 'Легаси счётчик плоского списка' })
  systemCount: number;
}

/** Тело `POST /api/notifications/read-all` — §5.3. */
export class ReadAllNotificationsDto {
  @ApiProperty({
    description:
      'Поход, в котором закрыть активные карточки, кроме money_transfer ' +
      'и payment_request',
  })
  @IsString()
  @Matches(/^\d+$/, { message: 'Поход должен быть числовым идентификатором' })
  tripId: string;
}

/** Ответ «прочитать все»: сколько закрыто и сколько осталось активным. */
export class ReadAllNotificationsResultDto {
  @ApiProperty({ description: 'Сколько карточек удалено' })
  closed: number;

  @ApiProperty({
    description: 'Сколько активных карточек в этом походе осталось',
  })
  left: number;
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
