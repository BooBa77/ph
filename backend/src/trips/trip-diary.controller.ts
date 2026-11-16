import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { SyncTripDiaryDto, TripDiaryDto } from './dto/trip-diary.dto';
import { TripDiaryService } from './trip-diary.service';

/**
 * «Дневник» похода — личные записи участника (16.11.2026).
 *
 * Две ручки и обе отвечают вкладкой целиком:
 *
 * - `GET /trips/:id/diary` — мои записи; чужих здесь не бывает;
 * - `POST /trips/:id/diary/sync` — пачка изменений с устройства.
 *
 * **Почему синхронизация, а не `POST`/`PATCH`/`DELETE`.** В офлайне
 * на устройстве нет ни id с сервера, ни гарантии порядка: запись могли
 * создать, дважды поправить и удалить, пока связи не было. Отправка
 * «состояние записи целиком» делает очередь простой и повторяемой:
 * тот же пакет можно отправить ещё раз, дублей не будет.
 *
 * `POST` у синхронизации, а не `PUT`: ручка применяет правила сервера
 * (какая версия главнее), а не кладёт присланное как есть.
 */
@ApiTags('trip-diary')
@Controller('trips')
export class TripDiaryController {
  constructor(private readonly diary: TripDiaryService) {}

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
