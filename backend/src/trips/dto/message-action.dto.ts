import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

import type { MessageAction } from '../entities/message-action.entity';

/** Состояния действия, в которых что-то можно нажимать. */
export const ACTION_STATES = ['pending', 'confirmed', 'disputed'] as const;
export type ActionState = (typeof ACTION_STATES)[number];

/** Чем адресат отвечает на действие. «Отменено» здесь нет: отмена — удаление. */
export const ACTION_ANSWERS = ['confirmed', 'disputed'] as const;
export type ActionAnswer = (typeof ACTION_ANSWERS)[number];

/** Тело `POST /api/message-actions/:id/respond`. */
export class RespondActionDto {
  @ApiProperty({
    description: 'confirmed — деньги дошли, disputed — не дошли',
    enum: ACTION_ANSWERS,
    example: 'confirmed',
  })
  @IsIn(ACTION_ANSWERS, {
    message: 'Ответом может быть только «получено» или «не получено»',
  })
  result: ActionAnswer;
}

/**
 * Действие наружу.
 *
 * `canRespond` и `canRecheck` считаются **для того, кто спрашивает**:
 * кнопки «Да»/«Нет» видны только адресату, а «посмотри ещё раз» и «мой
 * косяк» — только отправителю. Фронт по этим флагам рисует кнопки, но
 * решает всё равно сервис: спрятанная кнопка не запрет.
 */
export class MessageActionDto {
  @ApiProperty({ description: 'Id действия', example: '1' })
  id: string;

  @ApiProperty({
    description: 'Вид действия',
    example: 'money_received',
  })
  kind: string;

  @ApiProperty({
    description: 'Кому отвечать',
    example: '90ca6b06-fb04-4c5e-8c49-36ef5d188c50',
  })
  targetUserId: string;

  @ApiProperty({
    description: 'Состояние',
    enum: ACTION_STATES,
    example: 'pending',
  })
  state: ActionState;

  @ApiProperty({
    description: 'Полезная нагрузка вида: у денег — сумма, поход, кто перевёл',
    example: { amountRub: 1000, tripId: '7', fromUserId: '…' },
  })
  payload: Record<string, unknown>;

  @ApiProperty({ description: 'Может ли текущий человек ответить' })
  canRespond: boolean;

  @ApiProperty({
    description: 'Может ли текущий человек попросить посмотреть ещё раз',
  })
  canRecheck: boolean;

  @ApiProperty({ description: 'Когда действие создано' })
  createdAt: string;

  @ApiProperty({ description: 'Когда адресат ответил в последний раз', nullable: true })
  respondedAt: string | null;

  static from(
    action: MessageAction,
    viewerId: string,
    senderId: string | null,
  ): MessageActionDto {
    return {
      id: action.id,
      kind: action.kind,
      targetUserId: action.targetUserId,
      state: action.state,
      payload: action.payload,
      canRespond:
        action.targetUserId === viewerId &&
        (action.state === 'pending' || action.state === 'disputed'),
      canRecheck: senderId === viewerId && action.state === 'disputed',
      createdAt: action.createdAt.toISOString(),
      respondedAt: action.respondedAt?.toISOString() ?? null,
    };
  }
}

/**
 * Нерешённые действия — для конвертика в шапке.
 *
 * Два списка, потому что роли разные: `toAnswer` — ждут моего ответа,
 * `toSettle` — я отправил, а получатель говорит, что не дошло. Показывать
 * их в одной куче значило бы заставлять человека соображать, кто он здесь.
 */
export class PendingActionsDto {
  @ApiProperty({ type: [MessageActionDto] })
  toAnswer: MessageActionDto[];

  @ApiProperty({ type: [MessageActionDto] })
  toSettle: MessageActionDto[];
}
