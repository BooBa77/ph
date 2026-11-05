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
  CreateTripGearSectionDto,
  ProposeTripGearDto,
  TripGearItemDto,
  TripGearListDto,
  TripGearSectionDto,
  UpdateTripGearDto,
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
