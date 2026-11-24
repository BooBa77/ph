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
  MinLength,
} from 'class-validator';

import {
  TRIP_GEAR_ROUTE_SECTIONS,
  TRIP_GEAR_SECTION_SCOPES,
  TRIP_GEAR_STATUSES,
  type TripGearRouteSection,
  type TripGearSectionScope,
  type TripGearStatus,
} from '../trip-gear.types';
import type { GearItem } from '../entities/gear-item.entity';
import type { TripPersonalGear } from '../entities/trip-personal-gear.entity';
import type { TripGear } from '../entities/trip-gear.entity';
import type { TripGearSection } from '../entities/trip-gear-section.entity';
import { GearItemAttributeDto } from './gear.dto';
import { USER_GENDERS, type UserGender } from '../../users/gender.types';

/**
 * Характеристики предмета в порядке справочника — общий кусок двух DTO.
 *
 * У общественной вещи и у личной «Взял» характеристики берутся из одного
 * и того же `gear_items`. Второй сортировки не заводим: разойдясь, они
 * показали бы одни и те же поля в разном порядке на двух вкладках.
 */
function attributeDtos(item: GearItem): GearItemAttributeDto[] {
  const values = [...(item.attributes ?? [])].sort((left, right) => {
    const leftAttribute = left.gearTypeAttribute;
    const rightAttribute = right.gearTypeAttribute;
    if (leftAttribute.sortOrder !== rightAttribute.sortOrder) {
      return leftAttribute.sortOrder - rightAttribute.sortOrder;
    }

    return leftAttribute.id - rightAttribute.id;
  });

  return values.map((value) => GearItemAttributeDto.from(value));
}

/**
 * Держатель клона вещи — «она есть у Анны» (11.11.2026, архив похода).
 *
 * Мягко удалённая вещь остаётся в истории похода: строку не выдернуть, иначе
 * прошедший поход потерял бы снаряжение. Но у бывшего родного копия осталась
 * (заказчик: «владелец — жена, характеристики есть, она знает, что ответить»),
 * поэтому экран не говорит «недоступно», а называет людей, у которых вещь
 * жива, и предлагает спросить у них.
 */
export class GearHolderDto {
  @ApiProperty({ description: 'Кто держит клон', example: '90ca6b06-…' })
  userId: string;

  @ApiProperty({ description: 'Имя держателя', example: 'Анна' })
  name: string;
}

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

  /**
   * Секция «Ночёвок», куда вещь добавили кнопкой «Добавить ещё» (01.11.2026).
   *
   * `null` — обычная вещь, её секция определяется типом. Значение — вещь
   * «незабинденного» типа, и показывать её нужно там, где её добавили
   * («хоть лодку»): заказчик попросил именно так.
   */
  @ApiProperty({
    description:
      'Секция «Ночёвок» для вещи, добавленной кнопкой «Добавить ещё». null — по типу',
    enum: TRIP_GEAR_ROUTE_SECTIONS,
    nullable: true,
    example: null,
  })
  routeSection: TripGearRouteSection | null;

  /**
   * Общественный раздел «Берём» (05.11.2026): «Пешая часть», «Альпинизм».
   * `null` — вещь лежит в корне секции.
   */
  @ApiProperty({
    description: 'Общественный раздел «Берём». null — корень',
    nullable: true,
    example: '12',
  })
  sharedSectionId: string | null;

  /**
   * Личный раздел «Взял» **смотрящего**. У чужой вещи здесь `null`:
   * личный раздел принадлежит человеку, и показывать его id остальным
   * незачем.
   */
  @ApiProperty({
    description: 'Мой личный раздел «Взял» у этой вещи. null — корень или чужая вещь',
    nullable: true,
    example: null,
  })
  personalSectionId: string | null;

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

  /**
   * Вещь удалена из каталога, но осталась в строке похода (11.11.2026).
   *
   * Удаление каталога мягкое, и строки истории никто не вычищает: иначе
   * прошедший поход потерял бы снаряжение. Флаг говорит экрану, что
   * из каталога вещь исчезла, и заменяет «снаряжение недоступно» на
   * человеческий ответ — см. `itemHolders`.
   */
  @ApiProperty({
    description: 'Вещь мягко удалена из каталога, но осталась в походе',
    example: false,
  })
  itemDeleted: boolean;

  /**
   * У кого вещь жива сейчас — по `gear_uid`, среди активных клонов.
   *
   * Пусто — значит вещь удалена у всех: «снаряжение недоступно».
   */
  @ApiProperty({
    description: 'Активные держатели удалённой вещи — «она есть у Анны»',
    type: [GearHolderDto],
  })
  itemHolders: GearHolderDto[];

  /**
   * `viewerId` нужен личному разделу: он виден только своему владельцу,
   * и чужой id в ответе был бы утечкой чужой раскладки. У остальных
   * полей от смотрящего ничего не зависит.
   *
   * `holders` передаются только для мягко удалённой вещи: каталог отвечает
   * ими на вопрос «где она теперь», и считать их для каждой живой строки
   * значило бы делать лишний запрос на весь список.
   */
  static from(
    row: TripGear,
    viewerId?: string,
    holders?: GearHolderDto[],
  ): TripGearItemDto {
    return {
      id: row.id,
      gearItemId: row.gearItemId,
      typeId: row.gearItem.gearTypeId,
      typeCode: row.gearItem.gearType.code,
      typeName: row.gearItem.gearType.name,
      title: row.gearItem.title,
      attributes: attributeDtos(row.gearItem),
      weightGrams: row.gearItem.weightGrams,
      note: row.gearItem.note,
      isTripOnly: row.gearItem.isTripOnly,
      status: row.status,
      routeSection: row.routeSection,
      sharedSectionId: row.sharedSectionId,
      personalSectionId:
        viewerId === undefined || row.assignedUserId === viewerId
          ? row.personalSectionId
          : null,
      ownerUserId: row.ownerUserId,
      assignedUserId: row.assignedUserId,
      createdAt: row.createdAt.toISOString(),
      itemDeleted: row.gearItem.deletedAt !== null,
      itemHolders: row.gearItem.deletedAt === null ? [] : (holders ?? []),
    };
  }
}

/**
 * Личная вещь раздела «Взял» (06.11.2026).
 *
 * Форма **намеренно та же**, что у общественной вещи: экран уже умеет
 * рисовать пилюлю, открывать карточку и раскладывать вещи по разделам.
 * Отличия только по смыслу: `sharedSectionId` всегда `null`, а
 * `personalSectionId` — раздел «Взял», где вещь стоит; `status` всегда
 * `approved` (личную вещь «не берём» не решают — её просто убирают),
 * `assignedUserId` — владелец: нести её может только он.
 *
 * Почему не отдельная форма: дерево разделов «Взял» рисуется тем же
 * компонентом, что и «Берём», и вторая форма заставила бы его знать про
 * два вида пилюль. Карточка личной вещи прячет статус и несущего —
 * это её пропсы, а не новый DTO.
 */
export class TripGearPersonalDto {
  @ApiProperty({ description: 'Id личной вещи', example: '7' })
  id: string;

  @ApiProperty({ description: 'Id предмета личного каталога', example: '5' })
  gearItemId: string;

  @ApiProperty({ description: 'Id типа снаряжения', example: 1 })
  typeId: number;

  @ApiProperty({ description: 'Код типа', example: 'clothes' })
  typeCode: string;

  @ApiProperty({ description: 'Название типа', example: 'Одежда' })
  typeName: string;

  @ApiProperty({ description: 'Название вещи', example: 'Куртка мембранная' })
  title: string;

  @ApiProperty({
    description: 'Значения характеристик в порядке справочника',
    type: [GearItemAttributeDto],
  })
  attributes: GearItemAttributeDto[];

  @ApiProperty({
    description: 'Вес в граммах. null — не указан',
    example: 800,
    nullable: true,
  })
  weightGrams: number | null;

  @ApiProperty({ description: 'Заметка из каталога', nullable: true, example: null })
  note: string | null;

  @ApiProperty({ description: 'Вещь заведена вручную в походе', example: false })
  isTripOnly: boolean;

  @ApiProperty({
    description: 'Статус всегда «берём»: личную вещь не решают, а убирают',
    enum: ['approved'],
    example: 'approved',
  })
  status: TripGearStatus;

  @ApiProperty({ description: 'Секция «Ночёвок». У личной вещи всегда null', nullable: true })
  routeSection: TripGearRouteSection | null;

  @ApiProperty({ description: 'Общественный раздел. У личной вещи всегда null', nullable: true })
  sharedSectionId: string | null;

  @ApiProperty({ description: 'Личный раздел «Взял». null — корень', nullable: true })
  personalSectionId: string | null;

  @ApiProperty({ description: 'Владелец — он же несущий', example: '90ca6b06-…' })
  ownerUserId: string;

  @ApiProperty({ description: 'Несущий — владелец', example: '90ca6b06-…' })
  assignedUserId: string | null;

  @ApiProperty({ description: 'Когда вещь добавили' })
  createdAt: string;

  @ApiProperty({
    description: 'Вещь мягко удалена из каталога, но осталась в походе',
    example: false,
  })
  itemDeleted: boolean;

  @ApiProperty({
    description: 'Активные держатели удалённой вещи — «она есть у Анны»',
    type: [GearHolderDto],
  })
  itemHolders: GearHolderDto[];

  static from(
    row: TripPersonalGear,
    holders?: GearHolderDto[],
  ): TripGearPersonalDto {
    return {
      id: row.id,
      gearItemId: row.gearItemId,
      typeId: row.gearItem.gearTypeId,
      typeCode: row.gearItem.gearType.code,
      typeName: row.gearItem.gearType.name,
      title: row.gearItem.title,
      attributes: attributeDtos(row.gearItem),
      weightGrams: row.gearItem.weightGrams,
      note: row.gearItem.note,
      isTripOnly: row.gearItem.isTripOnly,
      status: 'approved',
      routeSection: null,
      sharedSectionId: null,
      personalSectionId: row.sectionId,
      ownerUserId: row.userId,
      assignedUserId: row.userId,
      createdAt: row.createdAt.toISOString(),
      itemDeleted: row.gearItem.deletedAt !== null,
      itemHolders: row.gearItem.deletedAt === null ? [] : (holders ?? []),
    };
  }
}

/**
 * Раздел «Берём» или «Взял» (05.11.2026).
 *
 * `parentId` — вложенность: «Альпинизм» → «Верёвки». Личные разделы
 * в ответе только свои: `ownerUserId` у них равен смотрящему, чужих
 * в списке нет.
 */
export class TripGearSectionDto {
  @ApiProperty({ description: 'Id раздела', example: '12' })
  id: string;

  @ApiProperty({
    description: 'Вид раздела: общий или личный',
    enum: TRIP_GEAR_SECTION_SCOPES,
    example: 'shared',
  })
  scope: TripGearSectionScope;

  @ApiProperty({
    description: 'Владелец личного раздела. null у общественного',
    nullable: true,
    example: null,
  })
  ownerUserId: string | null;

  @ApiProperty({
    description: 'Родительский раздел. null — корень большой секции',
    nullable: true,
    example: null,
  })
  parentId: string | null;

  @ApiProperty({ description: 'Название раздела', example: 'Альпинизм' })
  title: string;

  /**
   * Код шаблона (06.11.2026): `camp`, `bikes`, `water`, `tent_inside`,
   * `clothes`, `gear`. `null` — раздел заведён руками.
   *
   * Экрану он нужен, чтобы найти раздел, переживший переименование:
   * «в палатку» наполняется вещами из «Ночёвок» автоматически, и имя
   * этого раздела человек вправе поменять.
   */
  @ApiProperty({
    description: 'Код шаблона раздела. null — раздел заведён вручную',
    nullable: true,
    example: 'tent_inside',
  })
  templateCode: string | null;

  @ApiProperty({ description: 'Порядок среди соседей', example: 10 })
  sortOrder: number;

  static from(row: TripGearSection): TripGearSectionDto {
    return {
      id: row.id,
      scope: row.scope,
      ownerUserId: row.ownerUserId,
      parentId: row.parentId,
      title: row.title,
      templateCode: row.templateCode,
      sortOrder: row.sortOrder,
    };
  }
}

/**
 * Личная вещь смотрящего из секции «Спальник» «Ночёвок» (06.11.2026).
 *
 * Живёт в своей таблице `trip_route_sleeping`, а не в `trip_gear`: снаряжение
 * похода собирают, а личные вещи каждый приносит сам. В «Снаряжение» эти
 * строки приходят только для **чтения**: раздел «в палатку» показывает, что
 * человек уже положил себе в ночёвку, и не заводит вторую копию вещи.
 *
 * Название и вес — из каталога: спальник взвешивают один раз, и в ночёвке
 * он весит столько же. Тип нужен пилюле («Спальник», «Коврик»); владельца
 * нет — это та же личная секция, чужих строк сервер не отдаёт.
 */
export class TripGearSleepingDto {
  @ApiProperty({ description: 'Id строки ночёвки', example: '17' })
  id: string;

  @ApiProperty({ description: 'Id предмета каталога', example: '5' })
  gearItemId: string;

  @ApiProperty({ description: 'Код типа', example: 'sleeping_bag' })
  typeCode: string;

  @ApiProperty({ description: 'Название типа', example: 'Спальник' })
  typeName: string;

  @ApiProperty({ description: 'Название вещи', example: 'Спальник зимний' })
  title: string;

  @ApiProperty({
    description: 'Вес в граммах. null — не указан',
    example: 1200,
    nullable: true,
  })
  weightGrams: number | null;

  @ApiProperty({
    description: 'Вещь мягко удалена из каталога, но осталась в походе',
    example: false,
  })
  itemDeleted: boolean;

  @ApiProperty({
    description: 'Активные держатели удалённой вещи — «она есть у Анны»',
    type: [GearHolderDto],
  })
  itemHolders: GearHolderDto[];

  static from(
    row: {
      id: string;
      gear_item_id: string;
      type_code: string;
      type_name: string;
      title: string;
      weight_grams: number | null;
      deleted_at: Date | null;
    },
    holders?: GearHolderDto[],
  ): TripGearSleepingDto {
    return {
      id: row.id,
      gearItemId: row.gear_item_id,
      typeCode: row.type_code,
      typeName: row.type_name,
      title: row.title,
      weightGrams:
        row.weight_grams === null ? null : Number(row.weight_grams),
      itemDeleted: row.deleted_at !== null,
      itemHolders: row.deleted_at === null ? [] : (holders ?? []),
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

  /**
   * Разделы, которые видит смотрящий: все общественные и свои личные.
   * Приходят одним ответом с вещами: разделы без вещей нужны экрану
   * (пустой раздел — законное состояние), а второй запрос ради них
   * означал бы два состояния загрузки на одной секции.
   */
  @ApiProperty({ description: 'Разделы «Берём» и «Взял»', type: [TripGearSectionDto] })
  sections: TripGearSectionDto[];

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

  /**
   * Личные вещи смотрящего из «Ночёвок» (06.11.2026).
   *
   * Раздел «в палатку» в «Взял» показывает их автоматически: заказчик
   * объяснил, что личные вещи — это то, что помимо общественного, и
   * «Спальник» из ночёвок уже личный. Копий в `trip_gear` не заводим:
   * одна вещь живёт в одной таблице, иначе вес задвоится.
   */
  @ApiProperty({
    description: 'Мои личные вещи из «Ночёвок» — раздел «в палатку»',
    type: [TripGearSleepingDto],
  })
  sleeping: TripGearSleepingDto[];

  /**
   * Личные вещи смотрящего в разделе «Взял» (06.11.2026): одежда, каска,
   * палки. Чужих строк в ответе нет — личное не показывается никому,
   * включая организатора.
   */
  @ApiProperty({
    description: 'Мои личные вещи «Взял» — одежда, каска, палки',
    type: [TripGearPersonalDto],
  })
  personalItems: TripGearPersonalDto[];
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

  /**
   * Секция «Ночёвок», где нажали «Добавить ещё» (01.11.2026). Не указана —
   * обычная вещь: секция определяется её типом. С пометкой вещь показывается
   * там, где её добавили, даже если её тип ни к какой секции не привязан.
   */
  @ApiProperty({
    description: 'Секция «Ночёвок» для кнопки «Добавить ещё»',
    enum: TRIP_GEAR_ROUTE_SECTIONS,
    required: false,
    nullable: true,
    example: 'tent',
  })
  @IsOptional()
  @IsIn(TRIP_GEAR_ROUTE_SECTIONS, { message: 'Недопустимая секция снаряжения' })
  routeSection?: TripGearRouteSection | null;
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

  /**
   * Общественный раздел «Берём» (05.11.2026). `null` — вернуть в корень.
   * Право — как у статуса: тот, кому роль дала вкладку. Разложить
   * снаряжение по разделам — часть решения по составу, а не «перетащил
   * и ладно»: несущего и так меняет любой участник.
   */
  @ApiProperty({
    description: 'Общественный раздел «Берём». null — корень',
    nullable: true,
    required: false,
    example: 12,
  })
  @IsOptional()
  @IsInt({ message: 'Раздел должен быть указан числом' })
  @Min(1, { message: 'Некорректный раздел' })
  sharedSectionId?: number | null;

  /**
   * Личный раздел «Взял» (05.11.2026). Меняет только тот, кому вещь
   * назначена: чужой «Взял» — не моя раскладка. `null` — корень.
   */
  @ApiProperty({
    description: 'Мой личный раздел «Взял». null — корень',
    nullable: true,
    required: false,
    example: 15,
  })
  @IsOptional()
  @IsInt({ message: 'Раздел должен быть указан числом' })
  @Min(1, { message: 'Некорректный раздел' })
  personalSectionId?: number | null;
}

/**
 * Тело `POST /api/trips/:id/gear/personal` — своя вещь в раздел «Взял»
 * (06.11.2026).
 *
 * `gearItemId` — предмет **своего** каталога: чужой не найдётся (404), как
 * и в остальных ручках личных вещей. `sectionId` — личный раздел «Взял»;
 * не указан — вещь встанет в корень секции. Раздел обязан быть личным
 * разделом этого же человека — это проверяет и сервис, и триггер в базе.
 */
export class AddTripGearPersonalDto {
  @ApiProperty({ description: 'Id предмета из моего каталога', example: 5 })
  @IsInt({ message: 'Предмет каталога должен быть указан числом' })
  @Min(1, { message: 'Некорректный предмет каталога' })
  gearItemId: number;

  @ApiProperty({
    description: 'Личный раздел «Взял». Не указан — корень секции',
    nullable: true,
    required: false,
    example: 15,
  })
  @IsOptional()
  @IsInt({ message: 'Раздел должен быть указан числом' })
  @Min(1, { message: 'Некорректный раздел' })
  sectionId?: number | null;
}

/**
 * Тело `PATCH /api/trips/:id/gear/personal/:personalId` — перенос личной
 * вещи между разделами «Взял». Путь для телефона, где HTML5-drag не работает.
 * `sectionId: null` — вернуть вещь в корень.
 */
export class UpdateTripGearPersonalDto {
  @ApiProperty({
    description: 'Личный раздел «Взял». null — корень',
    nullable: true,
    required: false,
    example: 15,
  })
  @IsOptional()
  @IsInt({ message: 'Раздел должен быть указан числом' })
  @Min(1, { message: 'Некорректный раздел' })
  sectionId?: number | null;
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

  /**
   * Секция «Ночёвок», где нажали «Добавить ещё» (01.11.2026): вещь
   * «незабинденного» типа показывается там, где её добавили.
   */
  @ApiProperty({
    description: 'Секция «Ночёвок» для кнопки «Добавить ещё»',
    enum: TRIP_GEAR_ROUTE_SECTIONS,
    required: false,
    nullable: true,
    example: 'dishes',
  })
  @IsOptional()
  @IsIn(TRIP_GEAR_ROUTE_SECTIONS, { message: 'Недопустимая секция снаряжения' })
  routeSection?: TripGearRouteSection | null;
}

/**
 * Тело `POST /api/trips/:id/gear/sections` — новый раздел (05.11.2026).
 *
 * `scope` выбирает большую секцию: `shared` — «Берём», `personal` —
 * «Взял» (тогда владельцем становится автор запроса). У общественного
 * раздела права проверяются как у статуса — по вкладке «Снаряжение».
 *
 * `parentId` — вложенный раздел. Не указан — раздел в корне.
 */
export class CreateTripGearSectionDto {
  @ApiProperty({
    description: 'Вид раздела: общий или личный',
    enum: TRIP_GEAR_SECTION_SCOPES,
    example: 'shared',
  })
  @IsIn(TRIP_GEAR_SECTION_SCOPES, {
    message: 'Раздел бывает только общественным или личным',
  })
  scope: TripGearSectionScope;

  @ApiProperty({ description: 'Название раздела', example: 'Альпинизм' })
  @IsString({ message: 'Название раздела должно быть строкой' })
  @MinLength(1, { message: 'Название раздела не может быть пустым' })
  @MaxLength(60, { message: 'Название раздела не должно превышать 60 символов' })
  title: string;

  @ApiProperty({
    description: 'Родительский раздел. Не указан — корень',
    nullable: true,
    required: false,
    example: null,
  })
  @IsOptional()
  @IsInt({ message: 'Родительский раздел должен быть указан числом' })
  @Min(1, { message: 'Некорректный родительский раздел' })
  parentId?: number | null;
}

/**
 * Тело `PATCH /api/trips/:id/gear/sections/:sectionId`.
 *
 * Три поля, и все необязательные: переименовать, переставить среди
 * соседей, перенести в другой родитель. `parentId: null` — вернуть
 * раздел в корень. Вложенность произвольная, цикл («раздел внутри себя»)
 * отбивает сервис — SQL-ом цепочку не проверить.
 */
export class UpdateTripGearSectionDto {
  @ApiProperty({ description: 'Новое название', example: 'Пешка', required: false })
  @IsOptional()
  @IsString({ message: 'Название раздела должно быть строкой' })
  @MinLength(1, { message: 'Название раздела не может быть пустым' })
  @MaxLength(60, { message: 'Название раздела не должно превышать 60 символов' })
  title?: string;

  @ApiProperty({ description: 'Порядок среди соседей', example: 20, required: false })
  @IsOptional()
  @IsInt({ message: 'Порядок должен быть целым числом' })
  @Min(0, { message: 'Порядок не может быть отрицательным' })
  sortOrder?: number;

  @ApiProperty({
    description: 'Новый родитель. null — вернуть в корень',
    nullable: true,
    required: false,
    example: null,
  })
  @IsOptional()
  @IsInt({ message: 'Родительский раздел должен быть указан числом' })
  @Min(1, { message: 'Некорректный родительский раздел' })
  parentId?: number | null;
}

/**
 * Единица груза в раскладке: вещь похода или пакет еды (06.11.2026).
 *
 * Вид разный, а несущий один — поэтому один DTO на оба. Вещь и пакет
 * неделимы: «Пакет 2» либо у человека целиком, либо у другого
 * (`docs/ph/gear-distribution.md` §4).
 */
export class TripGearLoadUnitDto {
  @ApiProperty({
    description: 'Что это: вещь похода, пакет еды или общественная аптечка',
    enum: ['gear', 'package', 'firstAid'],
    example: 'gear',
  })
  kind: 'gear' | 'package' | 'firstAid';

  /**
   * Id строки `trip_gear`, `trip_meal_packages` или `'public'` у аптечки —
   * строками, как везде в API походов: `bigint` в браузер числом не отдаём.
   */
  @ApiProperty({ description: 'Id вещи похода, пакета или аптечки', example: '12' })
  id: string;

  @ApiProperty({
    description: 'Подпись: название вещи или имя пакета',
    example: 'Палатка на четверых',
  })
  title: string;

  @ApiProperty({ description: 'Вес в граммах', example: 2400 })
  weightGrams: number;

  /**
   * Известен ли вес (09.11.2026). У общественной аптечки без веса `false`:
   * в сумму она идёт нулём, но «0 г» на экране читался бы как пустая
   * аптечка, поэтому вес не рисуется вовсе.
   */
  @ApiProperty({
    description: 'Вес известен. false — аптечку ещё не взвесили',
    example: true,
  })
  weightKnown: boolean;

  @ApiProperty({
    description: 'Кто несёт. null — не распределено',
    nullable: true,
    example: '1f0f5a52-6a55-4f4e-9f56-2f4b0b3f5a11',
  })
  assignedUserId: string | null;
}

/**
 * Рюкзак участника: что в нём и сколько это весит.
 *
 * `targetWeightGrams` — доля человека с поправкой на пол
 * (`k_i × T`), `deviationGrams` — насколько он от неё ушёл. Отклонение
 * **показывается, но не запрещается**: правило §4 — «перегруз видно,
 * решают люди». Дробную долю округляем до грамма только на выходе.
 */
export class TripGearLoadBackpackDto {
  @ApiProperty({ description: 'Участник', example: '1f0f5a52-…' })
  userId: string;

  @ApiProperty({ description: 'Пол — от него зависит доля', enum: USER_GENDERS })
  gender: UserGender;

  @ApiProperty({ description: 'Доля человека, граммы', example: 6300 })
  targetWeightGrams: number;

  @ApiProperty({ description: 'Вес общественных вещей, граммы', example: 4200 })
  gearWeightGrams: number;

  @ApiProperty({ description: 'Вес пакетов еды, граммы', example: 2100 })
  packagesWeightGrams: number;

  @ApiProperty({ description: 'Всего груза, граммы', example: 6300 })
  totalWeightGrams: number;

  @ApiProperty({
    description: 'Отклонение от доли: плюс — перегруз, минус — свободно',
    example: 0,
  })
  deviationGrams: number;

  @ApiProperty({ description: 'Вещи в рюкзаке', type: [TripGearLoadUnitDto] })
  gear: TripGearLoadUnitDto[];

  @ApiProperty({ description: 'Пакеты еды в рюкзаке', type: [TripGearLoadUnitDto] })
  packages: TripGearLoadUnitDto[];
}

/**
 * Личная вещь в рюкзаке смотрящего — для секции «Личное» «Моего рюкзака»
 * (06.11.2026).
 *
 * Два источника в одном списке: `personal` — строки новой таблицы
 * `trip_personal_gear` («Взял»), `sleeping` — содержимое «Спальника»
 * «Ночёвок». Экран показывает их одной строкой — для рюкзака это одно
 * и то же личное, — а вид оставлен, чтобы подпись могла сказать, откуда
 * вещь. Вес может быть `null`: неизвестный не прячем, иначе итог выглядел
 * бы точным.
 */
export class TripGearLoadPersonalUnitDto {
  @ApiProperty({
    description: 'Откуда вещь: «Взял», «Спальник» «Ночёвок» или личная аптечка',
    enum: ['personal', 'sleeping', 'firstAid'],
    example: 'personal',
  })
  kind: 'personal' | 'sleeping' | 'firstAid';

  @ApiProperty({ description: 'Id строки', example: '7' })
  id: string;

  @ApiProperty({ description: 'Название вещи', example: 'Куртка мембранная' })
  title: string;

  @ApiProperty({
    description: 'Вес в граммах. null — не указан',
    nullable: true,
    example: 800,
  })
  weightGrams: number | null;

  /**
   * Известен ли вес (24.11.2026). У личной аптечки со списком, но без
   * взвешивания, `false`, а `weightGrams: null` — в рюкзаке она подписана
   * «вес не указан». У остальных строк совпадает с `weightGrams !== null`.
   */
  @ApiProperty({
    description: 'Вес известен. false — личную аптечку ещё не взвесили',
    example: true,
  })
  weightKnown: boolean;
}

/**
 * Пакет личной еды смотрящего из «Питания» (06.11.2026, «Мои продукты» —
 * 09.11.2026).
 *
 * Заказчик: «В „Личном“ отображается личная еда из Походы/Питание,
 * фактический вес, а если нет, то расчётный». Поэтому `isActual` говорит,
 * откуда взялся вес: взвешенный (и состав не менялся) или расчётный.
 * Пакеты автономного питания не назначаются и не распределяются — человек
 * несёт их сам, поэтому у них нет `assignedUserId`.
 *
 * **«Мои продукты»** — строка с id `my-food`: в «Питании» это сводка по
 * личным приёмам, а не пакет из базы, и её расчётный вес сервер отдаёт
 * здесь же. Фактический вес остаётся отметкой человека в браузере
 * (`meals.md` §5.7), поэтому `isActual` у неё всегда `false`, а экран
 * подменяет вес сам, если отметка есть.
 */
export class TripGearLoadPersonalPackageDto {
  @ApiProperty({ description: 'Id пакета «Питания» или `my-food`', example: '9' })
  id: string;

  @ApiProperty({ description: 'Имя пакета', example: 'Пакет 1' })
  name: string;

  @ApiProperty({ description: 'Вес в граммах', example: 1200 })
  weightGrams: number;

  @ApiProperty({
    description: 'Вес фактический (true) или расчётный (false)',
    example: false,
  })
  isActual: boolean;
}

/**
 * Личная половина «Моего рюкзака»: свои вещи и своя еда.
 *
 * В общее распределение не входит и в автораскладку не попадает — правило
 * «личное — твоя проблема» (`gear-distribution.md` §5). Сервер отдаёт этот
 * блок только смотрящему: чужие личные вещи не показываются никому.
 */
export class TripGearLoadPersonalDto {
  @ApiProperty({ description: 'Вес личных вещей, граммы', example: 2400 })
  gearWeightGrams: number;

  @ApiProperty({ description: 'Вес личной еды, граммы', example: 1200 })
  packagesWeightGrams: number;

  @ApiProperty({ description: 'Вес личного целиком, граммы', example: 3600 })
  totalWeightGrams: number;

  @ApiProperty({ description: 'Личные вещи', type: [TripGearLoadPersonalUnitDto] })
  gear: TripGearLoadPersonalUnitDto[];

  @ApiProperty({
    description: 'Пакеты личной еды',
    type: [TripGearLoadPersonalPackageDto],
  })
  packages: TripGearLoadPersonalPackageDto[];
}

/**
 * «Рюкзаки» вкладки «Снаряжение» — ответ `GET /gear/load`
 * и `POST /gear/auto-distribute` (06.11.2026).
 *
 * Один ответ на оба запроса: экрану не нужно второй раз собирать раскладку
 * после кнопки, а расхождение двух сборок однажды показало бы разные числа
 * на одном экране.
 *
 * **Общественное и личное разделены.** `backpacks` — только распределяемый
 * груз; `personal` — свои вещи и своя еда смотрящего для отдельной секции
 * «Личное» «Моего рюкзака». В общее распределение личное не входит
 * (`gear-distribution.md` §5) и в чужих плитках не показывается.
 */
export class TripGearLoadDto {
  @ApiProperty({
    description: 'Суммарный распределяемый вес: вещи и пакеты, граммы',
    example: 18900,
  })
  totalWeightGrams: number;

  @ApiProperty({
    description: 'Рюкзаки участников со статусом «Иду»',
    type: [TripGearLoadBackpackDto],
  })
  backpacks: TripGearLoadBackpackDto[];

  @ApiProperty({
    description: 'Груз без несущего: нераспределённые вещи и пакеты',
    type: [TripGearLoadUnitDto],
  })
  unassigned: TripGearLoadUnitDto[];

  @ApiProperty({
    description: 'Сколько утверждённых вещей без веса — в расчёт не входят',
    example: 2,
  })
  itemsWithoutWeight: number;

  @ApiProperty({
    description: 'Сколько пакетов без веса (пустых) — в расчёт не входят',
    example: 1,
  })
  packagesWithoutWeight: number;

  @ApiProperty({
    description: 'Личное смотрящего: вещи «Взял» и «Спальника», своя еда',
    type: TripGearLoadPersonalDto,
  })
  personal: TripGearLoadPersonalDto;

  /**
   * Медик, которому закреплена аптечка. `null` — медика в походе нет:
   * аптечка распределяется как обычная вещь, и экран говорит об этом
   * прямо (`gear-distribution.md` §4).
   */
  @ApiProperty({
    description: 'Медик, у которого аптечка. null — медика в походе нет',
    nullable: true,
    example: null,
  })
  doctorUserId: string | null;

  @ApiProperty({
    description: 'Аптечка есть, а медика нет — правило закрепления не сработало',
    example: false,
  })
  doctorMissing: boolean;
}

/**
 * Тело `PATCH /api/trips/:id/gear/packages/:packageId` — кто несёт пакет.
 *
 * Назначение доступно **любому участнику** (как перетаскивание вещи):
 * люди взрослые и договариваются сами. `null` — снять назначение.
 * Личные пакеты (автономное питание) так не назначаются: свою еду человек
 * несёт сам.
 */
export class AssignTripGearPackageDto {
  @ApiProperty({
    description: 'Кому едет пакет. null — снять назначение',
    nullable: true,
    example: '1f0f5a52-6a55-4f4e-9f56-2f4b0b3f5a11',
  })
  @IsOptional()
  @IsUUID('4', { message: 'Несущему нужен корректный UUID пользователя' })
  assignedUserId?: string | null;
}
