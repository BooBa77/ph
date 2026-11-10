import { InternalServerErrorException } from '@nestjs/common';
import { In, type EntityManager } from 'typeorm';

import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';
import { TripMembershipRequest } from './entities/trip-membership-request.entity';
import { TripParticipant } from './entities/trip-participant.entity';
import { TripTransferLeg } from './entities/trip-transfer-leg.entity';
import { TripTransferPassenger } from './entities/trip-transfer-passenger.entity';
import type { ChatKind } from './trip.types';
import { GearItem } from '../gear/entities/gear-item.entity';
import { TripGear } from '../gear/entities/trip-gear.entity';

/**
 * Убрать человека из похода вместе со следами его участия (10.11.2026).
 *
 * Логика вынесена из `TripsService.removeParticipant` в отдельный файл,
 * потому что понадобилась второму месту: «Контакты» удаляют человека без
 * аккаунта, и если он ещё в походе на стадии подготовки, его надо убрать
 * из этого похода. Двух копий этой уборки быть не должно — однажды они
 * разойдутся, и один из путей начнёт оставлять висящие вещи.
 *
 * Ничего про права здесь нет: их проверяет вызывающий (организатор похода
 * либо владелец человека без аккаунта). Здесь — только чистая уборка.
 *
 * ## Что уносим
 *
 * - **Строку состава** — каскад от неё снимает роли, вещи похода, места
 *   в палатках и остальные ссылки на участие.
 * - **Тикет**, если он был: «убрали из состава» без удаления тикета
 *   оставило бы висящее приглашение.
 * - **Одноразовые вещи** этого похода: строку `trip_gear` уносит каскад,
 *   а строку `gear_items` — нет, и она осталась бы невидимой никому
 *   (каталог одноразовые не отдаёт). Берём только вещи **этого** похода:
 *   у настоящего человека такие же могут быть в другом.
 * - **Рейсы**: пассажир, который не идёт, не должен числиться в машине;
 *   собственные рейсы уходят целиком.
 * - **Системное сообщение** в чат участников: состав — общее дело, и
 *   «ушёл» не должен растворяться.
 */
export async function detachTripParticipant(
  manager: EntityManager,
  tripId: string,
  userId: string,
  displayName: string,
): Promise<void> {
  // Запрос идёт **до** удаления участника: строки `trip_gear` исчезают
  // каскадом вместе с ним, и после удаления искать было бы нечего.
  const tripOnlyItems = await manager
    .createQueryBuilder(TripGear, 'gear')
    .innerJoin(GearItem, 'item', 'item.id = gear.gearItemId')
    .select('item.id', 'id')
    .where('gear.tripId = :tripId', { tripId })
    .andWhere('gear.ownerUserId = :ownerUserId', { ownerUserId: userId })
    .andWhere('item.isTripOnly = true')
    .getRawMany<{ id: string }>();

  await manager.delete(TripParticipant, { tripId, userId });
  await manager.delete(TripMembershipRequest, { tripId, userId });

  if (tripOnlyItems.length > 0) {
    await manager.delete(GearItem, {
      id: In(tripOnlyItems.map((row) => row.id)),
    });
  }

  await releaseTripTransfers(manager, tripId, userId);

  await postTripSystemMessage(
    manager,
    tripId,
    'trip_members',
    `${displayName} больше не в составе`,
  );
}

/**
 * Снять человека с рейсов похода.
 *
 * Заказчик 28.10.2026: «сменили готовность со 100% — выпиливаются
 * с трансфера, вместе с личным авто. Снимаем с рейсов, машина
 * освобождается». Поэтому:
 *
 * - его строки-пассажиры уходят из всех рейсов — «принятый пассажир»,
 *   который в поход не идёт, это ложь в списке мест;
 * - его собственные рейсы («наше ТС») удаляются целиком: машина не едет,
 *   а ссылка на неё в походе держала бы каталог занятым. Пассажиры его
 *   машины после этого снова видны в «Не распределены» — их надо
 *   рассаживать заново, и это видно.
 *
 * Вернулся в состав — ничего восстанавливать не нужно: он просто
 * появляется среди нераспределённых.
 */
export async function releaseTripTransfers(
  manager: EntityManager,
  tripId: string,
  userId: string,
): Promise<void> {
  await manager.delete(TripTransferPassenger, { tripId, userId });
  await manager.delete(TripTransferLeg, { tripId, ownerUserId: userId });
}

/**
 * Системное сообщение в чат похода.
 *
 * `sender_id = NULL` — так помечены системные сообщения, отдельного флага
 * для этого нет. Пишутся они здесь: история обработки тикетов и изменений
 * состава живёт в чатах.
 *
 * Отсутствие чата — не «молча пропустить», а поломка данных: чаты
 * создаются вместе с походом. Проглотить это значило бы потерять
 * сообщение и не сказать никому.
 */
export async function postTripSystemMessage(
  manager: EntityManager,
  tripId: string,
  kind: ChatKind,
  body: string,
): Promise<void> {
  const chat = await manager.findOne(Conversation, {
    where: { tripId, kind },
  });
  if (!chat) {
    throw new InternalServerErrorException(
      `У похода нет чата «${kind}» — данные похода повреждены`,
    );
  }

  await manager.insert(Message, {
    conversationId: chat.id,
    senderId: null,
    body,
  });
}
