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
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import {
  AddManualTripGearDto,
  AddTripGearPersonalDto,
  AssignTripGearPackageDto,
  CreateTripGearSectionDto,
  ProposeTripGearDto,
  TripGearItemDto,
  TripGearListDto,
  TripGearLoadDto,
  TripGearPersonalDto,
  TripGearSectionDto,
  UpdateTripGearDto,
  UpdateTripGearPersonalDto,
  UpdateTripGearSectionDto,
} from './dto/trip-gear.dto';
import { TripGearService } from './trip-gear.service';

/**
 * Снаряжение похода: что берём и кто понесёт.
 *
 * Отдельный контроллер, а не методы в `TripsController`: походы не должны
 * знать, как устроено снаряжение (та же причина, что у чек-листов похода).
 * Проверка «виден ли поход» при этом одна на всех — `TripsService`,
 * а права на вкладку спрашиваются у него же (`canEditTab`), а не
 * собираются здесь из матрицы ролей.
 *
 * Личный каталог живёт рядом, в `GearController` (`/api/gear`): предложить
 * в поход можно только предмет оттуда, и владельца в теле запроса нет.
 */
@ApiTags('trip-gear')
@Controller('trips')
export class TripGearController {
  constructor(private readonly tripGearService: TripGearService) {}

  /** Вещи похода и вес утверждённых. Видят участники. */
  @Get(':id/gear')
  @ApiOperation({ summary: 'Общественное снаряжение похода' })
  @ApiOkResponse({ type: TripGearListDto })
  async list(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<TripGearListDto> {
    return this.tripGearService.list(authUser.id, id);
  }

  /** Предложить предмет из своего каталога. */
  @Post(':id/gear')
  @ApiOperation({ summary: 'Предложить снаряжение в поход' })
  @ApiCreatedResponse({ type: TripGearItemDto })
  async propose(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ProposeTripGearDto,
  ): Promise<TripGearItemDto> {
    return this.tripGearService.propose(authUser.id, id, dto);
  }

  /**
   * Добавить вещь в поход вручную — второй путь заполнения снаряжения
   * (30.10.2026): тип, характеристики, название, вес, хозяин.
   *
   * Обычный участник добавляет себе одноразовую вещь («бутылка бензина
   * на розжиг»): она живёт только в этом походе и в каталог не попадает.
   * Флаг «в список для регулярного использования» заводит её ещё и в
   * каталоге настоящего хозяина. Организатор может выбрать хозяином
   * человека без аккаунта — у того каталога нет, поэтому вещь всегда
   * одноразовая.
   */
  @Post(':id/gear/manual')
  @ApiOperation({ summary: 'Добавить вещь в поход вручную' })
  @ApiCreatedResponse({ type: TripGearItemDto })
  async addManual(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddManualTripGearDto,
  ): Promise<TripGearItemDto> {
    return this.tripGearService.addManual(authUser.id, id, dto);
  }

  /**
   * Разделы «Берём» и «Взял» (05.11.2026). Ручки стоят **до**
   * `PATCH :id/gear/:gearId`: `sections` — статический сегмент, но Nest
   * матчит маршруты в порядке объявления, и `ParseIntPipe` у `:gearId`
   * иначе ответил бы 400 на «sections».
   */
  @Post(':id/gear/sections')
  @ApiOperation({ summary: 'Создать раздел «Берём» или «Взял»' })
  @ApiCreatedResponse({ type: TripGearSectionDto })
  async createSection(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateTripGearSectionDto,
  ): Promise<TripGearSectionDto> {
    return this.tripGearService.createSection(authUser.id, id, dto);
  }

  @Patch(':id/gear/sections/:sectionId')
  @ApiOperation({ summary: 'Переименовать, переставить или переложить раздел' })
  @ApiOkResponse({ type: TripGearSectionDto })
  async updateSection(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('sectionId', ParseIntPipe) sectionId: number,
    @Body() dto: UpdateTripGearSectionDto,
  ): Promise<TripGearSectionDto> {
    return this.tripGearService.updateSection(authUser.id, id, sectionId, dto);
  }

  @Delete(':id/gear/sections/:sectionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить раздел — вещи остаются в корне' })
  @ApiNoContentResponse({ description: 'Раздел удалён, вещи высыпались в корень' })
  async removeSection(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('sectionId', ParseIntPipe) sectionId: number,
  ): Promise<void> {
    return this.tripGearService.removeSection(authUser.id, id, sectionId);
  }

  /**
   * Раскладка груза: рюкзаки, доли, пакеты еды из «Питания» (06.11.2026).
   *
   * Отдельная ручка, а не поле в `GET /gear`: вес пакета выводится
   * из раскладки «Питания», и вкладка не должна платить за это при каждом
   * открытии. Экран грузит раскладку тогда, когда показывает
   * «Распределение».
   */
  @Get(':id/gear/load')
  @ApiOperation({ summary: 'Раскладка груза по рюкзакам' })
  @ApiOkResponse({ type: TripGearLoadDto })
  async load(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<TripGearLoadDto> {
    return this.tripGearService.load(authUser.id, id);
  }

  /**
   * «Автоматически распределить груз» — полный сброс и раскладка заново.
   *
   * Право — у того, кому роль дала вкладку «Снаряжение». Ответ — та же
   * раскладка, что у `GET /gear/load`: экран не пересчитывает веса сам.
   */
  @Post(':id/gear/auto-distribute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Разложить весь груз по рюкзакам автоматически' })
  @ApiOkResponse({ type: TripGearLoadDto })
  async autoDistribute(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<TripGearLoadDto> {
    return this.tripGearService.autoDistribute(authUser.id, id);
  }

  /**
   * Кто несёт пакет еды. Доступно любому участнику, как перетаскивание
   * вещи: договариваются сами (`docs/ph/gear-distribution.md` §5).
   */
  @Patch(':id/gear/packages/:packageId')
  @ApiOperation({ summary: 'Назначить несущего пакета еды' })
  @ApiOkResponse({ type: TripGearLoadDto })
  async assignPackage(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('packageId', ParseIntPipe) packageId: number,
    @Body() dto: AssignTripGearPackageDto,
  ): Promise<TripGearLoadDto> {
    return this.tripGearService.assignPackage(
      authUser.id,
      id,
      packageId,
      dto,
    );
  }

  /**
   * Личные вещи раздела «Взял» (06.11.2026): одежда, каска, палки.
   *
   * Своя таблица и свои ручки: общественное снаряжение (`trip_gear`)
   * в «Распределение» и в доли веса, личное — «твоя проблема» и чужим
   * не показывается. Ручки стоят **до** `PATCH :id/gear/:gearId` по той же
   * причине, что `sections`: Nest матчит маршруты в порядке объявления,
   * и `ParseIntPipe` у `:gearId` иначе ответил бы 400 на «personal».
   */
  @Post(':id/gear/personal')
  @ApiOperation({ summary: 'Добавить свою вещь в раздел «Взял»' })
  @ApiCreatedResponse({ type: TripGearPersonalDto })
  async addPersonal(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddTripGearPersonalDto,
  ): Promise<TripGearPersonalDto> {
    return this.tripGearService.addPersonal(authUser.id, id, dto);
  }

  @Patch(':id/gear/personal/:personalId')
  @ApiOperation({ summary: 'Перенести личную вещь в другой раздел «Взял»' })
  @ApiOkResponse({ type: TripGearPersonalDto })
  async updatePersonal(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('personalId', ParseIntPipe) personalId: number,
    @Body() dto: UpdateTripGearPersonalDto,
  ): Promise<TripGearPersonalDto> {
    return this.tripGearService.updatePersonal(authUser.id, id, personalId, dto);
  }

  @Delete(':id/gear/personal/:personalId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Убрать свою личную вещь из похода' })
  @ApiNoContentResponse({ description: 'Личная вещь убрана, каталог цел' })
  async removePersonal(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('personalId', ParseIntPipe) personalId: number,
  ): Promise<void> {
    return this.tripGearService.removePersonal(authUser.id, id, personalId);
  }

  /**
   * Статус («берём / не берём») и несущий.
   *
   * Два поля — два разных права: статус — тому, кто ведёт снаряжение,
   * несущий — любому участнику (перетаскивание вещи между рюкзаками).
   */
  @Patch(':id/gear/:gearId')
  @ApiOperation({ summary: 'Изменить вещь снаряжения в походе' })
  @ApiOkResponse({ type: TripGearItemDto })
  async update(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('gearId', ParseIntPipe) gearId: number,
    @Body() dto: UpdateTripGearDto,
  ): Promise<TripGearItemDto> {
    return this.tripGearService.update(authUser.id, id, gearId, dto);
  }

  /** Убрать вещь из похода: владелец или тот, кто ведёт снаряжение. */
  @Delete(':id/gear/:gearId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Убрать вещь из снаряжения похода' })
  @ApiNoContentResponse({ description: 'Вещь убрана из похода' })
  async remove(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('gearId', ParseIntPipe) gearId: number,
  ): Promise<void> {
    return this.tripGearService.remove(authUser.id, id, gearId);
  }
}
