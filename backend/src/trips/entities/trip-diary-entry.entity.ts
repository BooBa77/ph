import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';

import { User } from '../../users/entities/user.entity';
import { MAX_DIARY_BODY_LENGTH } from '../trip-diary.types';
import { Trip } from './trip.entity';

/**
 * Запись личного дневника похода (16.11.2026).
 *
 * Заказчик: «Дневник — это личная закладка, выглядит как большой чат,
 * есть кнопки вставки текущего времени, даты, порядкового номера дня похода,
 * указания участника. Дневник ведётся онлайн и оффлайн (синхронизация
 * при возвращении связи)».
 *
 * Отсюда устройство:
 *
 * - **Запись принадлежит паре «поход + человек».** Чужих записей не видит
 *   никто, включая организатора: это личный дневник, а не общий журнал.
 *   Общий альманах похода — отдельный шаг, и он не должен открывать
 *   личные черновики.
 * - **`id` придумывает устройство, а не база.** В поле связи нет, запись
 *   рождается на телефоне и уезжает на сервер позже. Если бы id выдавала
 *   база, офлайн-созданной записи пришлось бы после синхронизации менять
 *   ключ — и правка, сделанная в том же офлайне, потерялась бы. UUID
 *   с устройства делает отправку идемпотентной: повторная отправка той же
 *   записи ничего не дублирует.
 * - **`updated_at` ставит клиент.** По нему разрешается спор двух устройств:
 *   побеждает более поздняя правка (last-write-wins). Часы телефона в поле
 *   обычно точные, а конфликт здесь возможен только у одного человека
 *   на двух устройствах — цена ошибки мала и ограничена одной записью.
 * - **Удаление — мягкое (`deleted_at`).** Твёрдое удаление сломало бы
 *   идемпотентность: старая копия на втором устройстве «воскресила» бы
 *   запись повторной отправкой. Могильник остаётся в таблице, `GET`
 *   его не отдаёт.
 * - **`body` — markdown.** Дневник пишется тем же редактором, что и чаты
 *   вкладок: жирный, списки, упоминания участников `[[user:ID]]`.
 *
 * Таблица новая, `schema:log` должен видеть её без расхождений: имена
 * ограничений здесь буквально совпадают с миграцией `TripDiary`.
 */
@Entity('trip_diary_entries')
@Index('IDX_trip_diary_entries_trip_user', ['tripId', 'userId', 'createdAt'])
@Check(
  'chk_trip_diary_entries_body',
  `char_length(btrim("body")) BETWEEN 1 AND ${MAX_DIARY_BODY_LENGTH}`,
)
@Check(
  'chk_trip_diary_entries_dates',
  `"updated_at" >= "created_at" AND ("deleted_at" IS NULL OR "deleted_at" >= "created_at")`,
)
export class TripDiaryEntry {
  /** UUID, выданный устройством: ключ идемпотентности синхронизации. */
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ name: 'trip_id', type: 'bigint' })
  tripId: string;

  @ManyToOne(() => Trip, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'trip_id',
    foreignKeyConstraintName: 'FK_trip_diary_entries_trip',
  })
  trip: Trip;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_trip_diary_entries_user',
  })
  user: User;

  /** Текст записи — markdown, как в чатах вкладок. */
  @Column({ type: 'text' })
  body: string;

  /** Когда запись написана: время устройства, а не сервера. */
  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  /** Когда запись последний раз правили — по нему решается спор устройств. */
  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  /** Мягкое удаление: могильник не даёт воскресить запись старой копией. */
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  /**
   * Согласие автора на альманах (22.11.2026).
   *
   * Заказчик: «в альманах попадают только записи, помеченные автором
   * „можно в альманах“; по умолчанию пометка включена». Дневник остаётся
   * личным — чужих записей не видит никто, — но помеченные записи после
   * завершения похода собираются в общий текст ([almanac.md] §1).
   *
   * Пометка живёт у записи, а не у дневника целиком: человек пишет в поле
   * то, что не сказал бы в чат, и решает отдельно по каждой строке.
   * `DEFAULT true` — решение заказчика; правка текста пометку не сбрасывает,
   * потому что синхронизация присылает состояние записи целиком.
   */
  @Column({ name: 'shared_with_trip', type: 'boolean', default: true })
  sharedWithTrip: boolean;
}
