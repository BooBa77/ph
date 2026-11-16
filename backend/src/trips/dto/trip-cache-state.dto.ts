import { ApiProperty } from '@nestjs/swagger';

/**
 * Курсор свежести одного чата: id последнего сообщения.
 *
 * Чаты в счётчик похода намеренно не входят (`lifecycle.md` §2.2): одно
 * сообщение заставляло бы перечитывать все вкладки. Поэтому у каждого чата
 * свой курсор, и клиент обновляет только те, где он сдвинулся.
 */
export class TripChatCursorDto {
  @ApiProperty({ description: 'Вид чата', example: 'trip_members' })
  kind: string;

  @ApiProperty({
    description: 'Id последнего сообщения. null — чат пуст',
    example: '128',
    nullable: true,
  })
  lastMessageId: string | null;
}

/**
 * «Насколько свежа копия похода на устройстве».
 *
 * Это не данные похода, а отметка для сверки кэша: клиент помнит значения
 * на момент сохранения и сравнивает с серверными при открытии и при
 * возврате связи. Разошлись — перечитывает.
 *
 * `contentRevision` — строка: в базе `bigint`, и Node отдаёт его строкой.
 * Сравнивать два `bigint` как числа в JS значило бы терять точность
 * на больших значениях; строка сравнивается точно.
 */
export class TripCacheStateDto {
  @ApiProperty({
    description: 'Счётчик правок содержимого похода',
    example: '42',
  })
  contentRevision: string;

  @ApiProperty({
    description: 'Когда содержимое правили последний раз',
    example: '2026-11-16T12:32:00.000Z',
  })
  contentUpdatedAt: string;

  @ApiProperty({
    description: 'Курсоры чатов похода: по одному на чат',
    type: [TripChatCursorDto],
  })
  chats: TripChatCursorDto[];
}
