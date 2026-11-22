import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import {
  CreateAlmanacEntryDto,
  TripAlmanacDto,
  UpdateAlmanacEntryDto,
} from './dto/trip-almanac.dto';
import { SyncTripDiaryDto, TripDiaryDto } from './dto/trip-diary.dto';
import { TripAlmanacService } from './trip-almanac.service';
import { TripDiaryService } from './trip-diary.service';

/**
 * «Дневник» похода — личные записи участника (16.11.2026) и альманах —
 * секция «Гостевой» (22.11.2026).
 *
 * Четыре ручки дневника и альманаха, все отвечают состоянием целиком:
 *
 * - `GET /trips/:id/diary` — мои записи; чужих здесь не бывает;
 * - `POST /trips/:id/diary/sync` — пачка изменений с устройства;
 * - `GET /trips/:id/almanac` — общий текст похода после его завершения.
 *   До завершения — `409`, посторонним вход закрыт правилом видимости
 *   похода (`getVisibleTrip`), а после завершения его видит и гость;
 * - `POST /trips/:id/almanac/entries` — создать воспоминание в слоте
 *   «до похода / день N / в конце»;
 * - `PUT /trips/:id/almanac/entries/:entryId` — дописать своё воспоминание;
 * - `DELETE /trips/:id/almanac/entries/:entryId` — убрать строку (только
 *   организатор).
 *
 * **Почему синхронизация, а не `POST`/`PATCH`/`DELETE`.** В офлайне
 * на устройстве нет ни id с сервера, ни гарантии порядка: запись могли
 * создать, дважды поправить и удалить, пока связи не было. Отправка
 * «состояние записи целиком» делает очередь простой и повторяемой:
 * тот же пакет можно отправить ещё раз, дублей не будет.
 *
 * `POST` у синхронизации, а не `PUT`: ручка применяет правила сервера
 * (какая версия главнее), а не кладёт присланное как есть.
 *
 * **Воспоминания офлайн не пишутся.** Альманах — после возвращения, связи
 * там уже ждут; очередь отправки для него не заводим, и ошибка связи
 * остаётся ошибкой, а не молчаливой потерей.
 */
@ApiTags('trip-diary')
@Controller('trips')
export class TripDiaryController {
  constructor(
    private readonly diary: TripDiaryService,
    private readonly almanac: TripAlmanacService,
  ) {}

  /** Мои записи дневника. Видят только участники, и только свои. */
  @Get(':id/diary')
  @ApiOperation({ summary: 'Дневник похода: мои записи' })
  @ApiOkResponse({ type: TripDiaryDto })
  async getDiary(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<TripDiaryDto> {
    return this.diary.getDiary(authUser.id, id);
  }

  /**
   * Альманах похода: помеченные записи дневников и воспоминания участников.
   *
   * `409` до завершения похода — это не ошибка прав, а порядок: собирать
   * ещё нечего.
   */
  @Get(':id/almanac')
  @ApiOperation({ summary: 'Альманах похода' })
  @ApiOkResponse({ type: TripAlmanacDto })
  async getAlmanac(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<TripAlmanacDto> {
    return this.almanac.getAlmanac(authUser.id, id);
  }

  /** Создать воспоминание: место вставки выбрано, текст — в теле. */
  @Post(':id/almanac/entries')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Создать воспоминание в альманахе' })
  @ApiOkResponse({ type: TripAlmanacDto })
  async createAlmanacEntry(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateAlmanacEntryDto,
  ): Promise<TripAlmanacDto> {
    return this.almanac.createEntry(authUser.id, id, dto);
  }

  /** Дописать своё воспоминание: место вставки не меняется. */
  @Put(':id/almanac/entries/:entryId')
  @ApiOperation({ summary: 'Дописать воспоминание в альманахе' })
  @ApiOkResponse({ type: TripAlmanacDto })
  async updateAlmanacEntry(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('entryId', ParseUUIDPipe) entryId: string,
    @Body() dto: UpdateAlmanacEntryDto,
  ): Promise<TripAlmanacDto> {
    return this.almanac.updateEntry(authUser.id, id, entryId, dto);
  }

  /** Убрать строку альманаха — право организатора. */
  @Delete(':id/almanac/entries/:entryId')
  @ApiOperation({ summary: 'Удалить строку альманаха' })
  @ApiOkResponse({ type: TripAlmanacDto })
  async deleteAlmanacEntry(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('entryId', ParseUUIDPipe) entryId: string,
  ): Promise<TripAlmanacDto> {
    return this.almanac.deleteEntry(authUser.id, id, entryId);
  }

  /**
   * Применить изменения, накопленные на устройстве, и вернуть дневник.
   *
   * Ответ 200, как у остальных вкладок: экран всегда получает состояние
   * целиком, и разбирать 201/204 ему незачем.
   */
  @Post(':id/diary/sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Синхронизировать записи дневника с устройством' })
  @ApiOkResponse({ type: TripDiaryDto })
  async sync(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SyncTripDiaryDto,
  ): Promise<TripDiaryDto> {
    return this.diary.sync(authUser.id, id, dto);
  }
}
