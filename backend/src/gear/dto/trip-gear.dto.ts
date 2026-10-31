import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

import { TRIP_GEAR_STATUSES, type TripGearStatus } from '../trip-gear.types';
import type { TripGear } from '../entities/trip-gear.entity';
import { GearItemAttributeDto } from './gear.dto';

/**
 * Вещь в общественном снаряжении похода — как её видит вкладка.
 *
 * Название, вид и вес приходят из каталога владельца: строка похода —
 * это ссылка на предмет (`gear_items`), а не копия. Поэтому одно и то же
 * поле веса правится в профиле и сразу видно в походе.
 *
 * **Одноразовая вещь** (30.10.2026) — исключение только в одном: её
 * `gear_items` заведена в походе и каталогу не принадлежит
 * (`isTripOnly: true`). Название, вес и характеристики у неё свои,
 * в походной строке это обычная вещь.
 *
 * **Тип и его значения (Stage B, 30.10.2026).** Экранам «Ночёвок» нужен
 * не вид старого каталога, а **код типа**: «Палатки» собираются по `tent`
 * и `shelter`, «Костровое» — по `axe`, `saw`, `firestarter`, `tagan`,
 * `stove` и `gas` (заказчик: «в Ночёвках используем забинденные типы»).
 * Вместе с типом отдаются значения характеристик: подпись палатки —
 * «Анна 3-х местная 2400 гр.» — складывается из вместимости и веса,
 * то есть из значения, а не из названия вещи.
 *
 * лежит в каталоге, а каталог с 30.10.2026 живёт на типах: вида старого
 * каталога в ответе нет — экраны перешли на коды типов, и прослойка
 * `kind` удалена вместе с последним потребителем.
 *
 * Имён владельца и назначенного здесь нет: вкладка уже загрузила состав
 * (`GET /api/trips/:id/participants`) с именами и полом, и дублировать
 * их в каждой строке снаряжения значило бы держать два источника правды
 * об одном человеке.
 */
export class TripGearItemDto {
  @ApiProperty({ description: 'Id строки снаряжения похода', example: '12' })
  id: string;

  @ApiProperty({ description: 'Id предмета в каталоге владельца', example: '5' })
  gearItemId: string;

  @ApiProperty({ description: 'Id типа снаряжения', example: 1 })
  typeId: number;

  @ApiProperty({ description: 'Код типа: на него опираются экраны', example: 'tent' })
  typeCode: string;

  @ApiProperty({ description: 'Название типа', example: 'Палатка' })
  typeName: string;

  @ApiProperty({ description: 'Название', example: 'Палатка на четверых' })
  title: string;

  @ApiProperty({
    description: 'Значения характеристик в порядке справочника',
    type: [GearItemAttributeDto],
  })
  attributes: GearItemAttributeDto[];

  @ApiProperty({
    description: 'Вес в граммах. null — не указан и в сумму не входит',
    example: 2400,
    nullable: true,
  })
  weightGrams: number | null;

  @ApiProperty({
    description: 'Комментарий владельца из каталога',
    example: 'проклеена, течёт по шву',
    nullable: true,
  })
  note: string | null;

  /**
   * Вещь заведена **в походе и вручную** (30.10.2026) — «бутылка бензина
   * на розжиг». В личном каталоге владельца её нет: `GET /api/gear`
   * одноразовые вещи не отдаёт.
   *
   * Фронту флаг нужен, чтобы не предлагать «правку в каталоге»: строки
   * в каталоге нет, и запрос по её id ответит 404. В «Палатках»
   * и «Костровом» разницы нет — там это обычная строка снаряжения.
   */
  @ApiProperty({
    description: 'Вещь заведена вручную и в каталог не входит',
    example: false,
  })
  isTripOnly: boolean;

  @ApiProperty({
    description: 'Статус: предложена, берём или не берём',
    enum: TRIP_GEAR_STATUSES,
    example: 'approved',
  })
  status: TripGearStatus;

  @ApiProperty({
    description: 'Владелец предмета — участник похода',
    example: '90ca6b06-fb04-4c5e-8c49-36ef5d188c50',
  })
  ownerUserId: string;

  @ApiProperty({
    description: 'Кто несёт. null — не распределена',
    nullable: true,
    example: '1f0f5a52-6a55-4f4e-9f56-2f4b0b3f5a11',
  })
  assignedUserId: string | null;

  @ApiProperty({ description: 'Когда вещь предложили в поход' })
  createdAt: string;

  static from(row: TripGear): TripGearItemDto {
    const values = [...(row.gearItem.attributes ?? [])].sort((left, right) => {
      const leftAttribute = left.gearTypeAttribute;
      const rightAttribute = right.gearTypeAttribute;
      if (leftAttribute.sortOrder !== rightAttribute.sortOrder) {
        return leftAttribute.sortOrder - rightAttribute.sortOrder;
      }

      return leftAttribute.id - rightAttribute.id;
    });

    return {
      id: row.id,
      gearItemId: row.gearItemId,
      typeId: row.gearItem.gearTypeId,
      typeCode: row.gearItem.gearType.code,
      typeName: row.gearItem.gearType.name,
      title: row.gearItem.title,
      attributes: values.map((value) => GearItemAttributeDto.from(value)),
      weightGrams: row.gearItem.weightGrams,
      note: row.gearItem.note,
      isTripOnly: row.gearItem.isTripOnly,
      status: row.status,
      ownerUserId: row.ownerUserId,
      assignedUserId: row.assignedUserId,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

/**
 * Общественное снаряжение похода и итог по весу.
 *
 * `totalWeightGrams` и `itemsWithoutWeight` считают **только утверждённые**
 * вещи: «не берём» в рюкзак не кладут, и включать её в вес значило бы
 * показать человеку цифру, которой нет. Предложенные ещё не решение —
 * их вес тоже не итог.
 */
export class TripGearListDto {
  @ApiProperty({ description: 'Вещи похода', type: [TripGearItemDto] })
  items: TripGearItemDto[];

  @ApiProperty({
    description: 'Сумма известных весов утверждённых вещей, граммы',
    example: 5400,
  })
  totalWeightGrams: number;

  @ApiProperty({
    description: 'Сколько утверждённых вещей без веса — они в сумму не входят',
    example: 2,
  })
  itemsWithoutWeight: number;
}

/**
 * Тело `POST /api/trips/:id/gear` — предложить предмет из своего каталога.
 *
 * Владельца в теле нет: он тот, кто прислал запрос. Чужой предмет
 * не найдётся (404, как и в каталоге) — предлагать чужое снаряжение
 * в поход нельзя, это решение владельца.
 */
export class ProposeTripGearDto {
  @ApiProperty({
    description: 'Id предмета из моего каталога снаряжения',
    example: 5,
  })
  @IsInt({ message: 'Предмет каталога должен быть указан числом' })
  @Min(1, { message: 'Некорректный предмет каталога' })
  gearItemId: number;
}

/**
 * Тело `PATCH /api/trips/:id/gear/:gearId`.
 *
 * Два поля — два разных права, и это не случайность:
 *
 * - `status` («берём» / «не берём») — тому, кому роль дала вкладку
 *   «Снаряжение» (завхоз, ремонтник, организатор);
 * - `assignedUserId` — **любому участнику**: перетаскивание вещи между
 *   рюкзаками заказчик разрешил всем, «люди взрослые и договорятся сами».
 *
 * `assignedUserId: null` — освободить вещь: «нераспределённая» — законное
 * состояние, мы не подставляем первого попавшегося.
 */
export class UpdateTripGearDto {
  @ApiProperty({
    description: 'Статус вещи: предложена, берём или не берём',
    enum: TRIP_GEAR_STATUSES,
    required: false,
  })
  @IsOptional()
  @IsIn(TRIP_GEAR_STATUSES, { message: 'Недопустимый статус вещи' })
  status?: TripGearStatus;

  @ApiProperty({
    description: 'Кому едет вещь. null — освободить',
    nullable: true,
    required: false,
    example: '1f0f5a52-6a55-4f4e-9f56-2f4b0b3f5a11',
  })
  @IsOptional()
  @IsUUID('4', { message: 'Назначенному нужен корректный UUID пользователя' })
  assignedUserId?: string | null;
}

/**
 * Тело `POST /api/trips/:id/gear/manual` — добавить вещь в поход вручную.
 *
 * Второй путь заполнения снаряжения (30.10.2026), дословно от заказчика:
 * «При добавлении снаряги нужен пункт „Указать вручную“. Для модалки
 * с вводом характеристик и выбором хозяина, доступно только
 * организаторам». И уточнение: участникам нужна возможность добавить
 * в поход что-то одноразовое — «бутылку бензина на розжиг, кусок
 * целлофана на тент».
 *
 * Поэтому хозяина в теле **может не быть**: обычный участник добавляет
 * вещь себе (`ownerUserId` отсутствует). Организатор указывает хозяина —
 * но только виртуального участника этого похода: другому настоящему
 * человеку вещь не добавляют (решение заказчика 31.10.2026), каждый
 * добавляет своё сам.
 *
 * `addToCatalog` — флаг «Добавить в список снаряжения для регулярного
 * использования». Он есть **только у настоящего хозяина**: у виртуального
 * каталога нет, и `true` при нём — 400. Без флага вещь одноразовая
 * (`is_trip_only`) и каталогу не принадлежит.
 *
 * `title` необязателен: пусто — строку подписывает имя типа («Топор»).
 * `weightGrams` — граммы; `attributes` — та же карта «код характеристики →
 * значение», что у каталога (`gear-attribute-values.ts`), включая запятую
 * в числах и обязательные значения.
 */
export class AddManualTripGearDto {
  @ApiProperty({ description: 'Id типа снаряжения', example: 1 })
  @IsInt({ message: 'Тип снаряжения должен быть указан числом' })
  @Min(1, { message: 'Некорректный тип снаряжения' })
  typeId: number;

  @ApiProperty({
    description: 'Значения характеристик: { код: значение }',
    example: { seats: 3 },
    required: false,
  })
  @IsOptional()
  @IsObject({ message: 'Значения характеристик — объект «код: значение»' })
  attributes?: Record<string, unknown>;

  @ApiProperty({
    description: 'Название. Пусто — берём имя типа',
    example: 'Бутылка бензина',
    maxLength: 120,
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString({ message: 'Название должно быть строкой' })
  @MaxLength(120, { message: 'Название не должно превышать 120 символов' })
  title?: string | null;

  @ApiProperty({
    description: 'Вес в граммах. Не указан — не считается',
    example: 800,
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsInt({ message: 'Вес должен быть целым числом граммов' })
  @Min(1, { message: 'Вес должен быть больше нуля' })
  weightGrams?: number | null;

  @ApiProperty({
    description:
      'Хозяин: не указан — я сам. Организатор может указать человека без аккаунта',
    example: '1f0f5a52-6a55-4f4e-9f56-2f4b0b3f5a11',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsUUID('4', { message: 'Хозяину нужен корректный UUID пользователя' })
  ownerUserId?: string | null;

  @ApiProperty({
    description:
      'Добавить в каталог хозяина для регулярного использования. Только при настоящем хозяине',
    example: false,
    required: false,
  })
  @IsOptional()
  @IsBoolean({ message: 'Флаг «в каталог» должен быть true или false' })
  addToCatalog?: boolean;
}
