import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { CalendarService } from './calendar.service';
import {
  ActivityDictionaryDto,
  ActivityRequestDto,
  ActivityTypeDto,
  CreateActivityRequestDto,
  DayNotesDto,
  DecideActivityRequestDto,
  SetTypeActiveDto,
  ToggleActivityDto,
  ModerationDto,
} from './dto/activity.dto';
import {
  CalendarDayDto,
  DayRangeQueryDto,
  UpdateDayDto,
  UpdateDaysDto,
} from './dto/day.dto';
import { InitYearDto, YearStateDto } from './dto/year.dto';

/**
 * Календарь пользователя.
 *
 * Все роуты защищены глобальным `JwtAuthGuard` и работают только со своим
 * календарём: `userId` берётся из токена, а не из параметров запроса —
 * чужой календарь через этот контроллер недостижим.
 */
@ApiTags('calendar')
@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  /**
   * Состояние года: создан ли календарь, какой режим, есть ли шаблон
   * государственного календаря. По этому ответу фронт решает, спрашивать
   * ли «работаешь?» и предупреждать ли, что шаблона на год ещё нет.
   */
  @Get('years/:year')
  @ApiOperation({ summary: 'Состояние календаря на год' })
  @ApiOkResponse({ type: YearStateDto })
  async getYear(
    @CurrentUser() authUser: AuthUser,
    @Param('year', ParseIntPipe) year: number,
  ): Promise<YearStateDto> {
    return this.calendarService.getYearState(authUser.id, year);
  }

  /**
   * Создать календарь на год: ответ на вопрос «работаешь?».
   * Повторный вызов — 409, год не перезаписывается.
   */
  @Post('years/:year/init')
  @ApiOperation({ summary: 'Создать календарь на год' })
  @ApiOkResponse({ type: YearStateDto })
  async initYear(
    @CurrentUser() authUser: AuthUser,
    @Param('year', ParseIntPipe) year: number,
    @Body() dto: InitYearDto,
  ): Promise<YearStateDto> {
    return this.calendarService.initYear(authUser.id, year, dto.mode);
  }

  /**
   * Дни диапазона. Фронт запрашивает месяц вместе с хвостами соседних
   * месяцев и кэширует ответ в Pinia.
   */
  @Get('days')
  @ApiOperation({ summary: 'Дни календаря за диапазон' })
  @ApiOkResponse({ type: [CalendarDayDto] })
  async getDays(
    @CurrentUser() authUser: AuthUser,
    @Query() query: DayRangeQueryDto,
  ): Promise<{ days: CalendarDayDto[]; activities: Record<string, number[]> }> {
    const [days, activities] = await Promise.all([
      this.calendarService.getDays(authUser.id, query.from, query.to),
      this.calendarService.getActivitiesByDates(
        authUser.id,
        query.from,
        query.to,
      ),
    ]);
    return { days, activities };
  }

  /**
   * Справочник активностей: группы с типами, избранное и свои запросы.
   * Фронт запрашивает его один раз и держит в Pinia.
   */
  @Get('activities')
  @ApiOperation({ summary: 'Справочник активностей и избранное' })
  @ApiOkResponse({ type: ActivityDictionaryDto })
  async getActivities(
    @CurrentUser() authUser: AuthUser,
  ): Promise<ActivityDictionaryDto> {
    return this.calendarService.getActivityDictionary(authUser.id);
  }

  /** Отметить активность на дне. Повторная отметка — не ошибка. */
  @Post('activities')
  @ApiOperation({ summary: 'Отметить активность' })
  async addActivity(
    @CurrentUser() authUser: AuthUser,
    @Body() dto: ToggleActivityDto,
  ): Promise<{ active: boolean }> {
    return this.calendarService.addActivity(authUser.id, dto);
  }

  /**
   * Снять отметку. Дата и тип — в строке запроса: тело у DELETE
   * поддерживается неповсеместно и живёт хуже параметров.
   */
  @Delete('activities')
  @ApiOperation({ summary: 'Снять отметку активности' })
  async removeActivity(
    @CurrentUser() authUser: AuthUser,
    @Query('date') date: string,
    @Query('activityTypeId', ParseIntPipe) activityTypeId: number,
  ): Promise<{ active: boolean }> {
    return this.calendarService.removeActivity(authUser.id, {
      date,
      activityTypeId,
    });
  }

  /** Заметки дня: обе одним сохранением. */
  @Patch('days/notes')
  @ApiOperation({ summary: 'Сохранить заметки дня' })
  @ApiOkResponse({ type: CalendarDayDto })
  async saveNotes(
    @CurrentUser() authUser: AuthUser,
    @Body() dto: DayNotesDto,
  ): Promise<CalendarDayDto> {
    return this.calendarService.saveNotes(authUser.id, dto);
  }

  /**
   * Запрос новой активности. Пользователь просит у системы: одобренная
   * иконка станет доступна всем, поэтому тип появляется только после
   * решения админа.
   */
  @Post('activity-requests')
  @ApiOperation({ summary: 'Запросить новую активность' })
  @ApiOkResponse({ type: ActivityRequestDto })
  async createActivityRequest(
    @CurrentUser() authUser: AuthUser,
    @Body() dto: CreateActivityRequestDto,
  ): Promise<ActivityRequestDto> {
    return this.calendarService.createActivityRequest(authUser.id, dto);
  }

  // ─────────────────────────── модерация ───────────────────────────

  /** Список вариантов иконок и заявок. Доступен только админу. */
  @Get('admin/moderation')
  @ApiOperation({ summary: 'Модерация иконок: варианты и заявки' })
  @ApiOkResponse({ type: ModerationDto })
  async getModeration(
    @CurrentUser() authUser: AuthUser,
  ): Promise<ModerationDto> {
    return this.calendarService.getModeration(authUser.id);
  }

  /** Решение по заявке: одобрить, отклонить, на доработку. */
  @Patch('admin/requests/:id')
  @ApiOperation({ summary: 'Решение по заявке на иконку' })
  @ApiOkResponse({ type: ActivityRequestDto })
  async decideRequest(
    @CurrentUser() authUser: AuthUser,
    @Param('id') id: string,
    @Body() dto: DecideActivityRequestDto,
  ): Promise<ActivityRequestDto> {
    return this.calendarService.decideRequest(
      authUser.id,
      id,
      dto.status,
      dto.comment,
    );
  }

  /** Показать вариант иконки пользователям или вернуть на рассмотрение. */
  @Patch('admin/types/:id')
  @ApiOperation({ summary: 'Включить или скрыть тип активности' })
  @ApiOkResponse({ type: ActivityTypeDto })
  async setTypeActive(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetTypeActiveDto,
  ): Promise<ActivityTypeDto> {
    return this.calendarService.setTypeActive(authUser.id, id, dto.isActive);
  }

  /** Правка одного дня: статус, метка или оба поля. */
  @Patch('days')
  @ApiOperation({ summary: 'Изменить день календаря' })
  @ApiOkResponse({ type: CalendarDayDto })
  async updateDay(
    @CurrentUser() authUser: AuthUser,
    @Body() dto: UpdateDayDto,
  ): Promise<CalendarDayDto> {
    return this.calendarService.updateDay(authUser.id, dto);
  }

  /**
   * Пачка правок: «Сохранить» в модалке производственного календаря,
   * когда пользователь накопил несколько диапазонов.
   */
  @Put('days')
  @ApiOperation({ summary: 'Изменить несколько дней разом' })
  @ApiOkResponse({
    schema: { properties: { updated: { type: 'number', example: 14 } } },
  })
  async updateDays(
    @CurrentUser() authUser: AuthUser,
    @Body() dto: UpdateDaysDto,
  ): Promise<{ updated: number }> {
    return this.calendarService.updateDays(authUser.id, dto);
  }
}
