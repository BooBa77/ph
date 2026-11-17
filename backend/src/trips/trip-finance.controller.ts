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
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import {
  CreateTripCompensationDto,
  SaveTripDepositDto,
  SaveTripExpenseDto,
  TripFinanceDto,
} from './dto/trip-finance.dto';
import { TripFinanceService } from './trip-finance.service';

/**
 * Вкладка «Бухгалтерия» похода (11.11.2026).
 *
 * Семь ручек — ровно те действия, которые есть на экране: прочитать
 * вкладку, добавить/поправить/удалить расход, добавить/подтвердить/
 * отменить компенсацию. Все возвращают вкладку целиком: баланс и
 * подсказки считаются из всех записей, и отдавать одну строку значило бы
 * заставлять фронт повторять арифметику.
 *
 * Проверки прав — в сервисе, а не в контроллере: «кнопка спрятана» не
 * запрет, а правила одни и для HTTP, и для будущих вызовов.
 */
@ApiTags('trip-finance')
@Controller('trips')
export class TripFinanceController {
  constructor(private readonly finance: TripFinanceService) {}

  @Get(':id/finance')
  @ApiOperation({ summary: 'Бухгалтерия похода: записи, балансы, подсказки' })
  @ApiOkResponse({ type: TripFinanceDto })
  async get(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<TripFinanceDto> {
    return this.finance.getView(authUser.id, id);
  }

  @Post(':id/finance/expenses')
  @ApiOperation({ summary: 'Добавить расход' })
  @ApiOkResponse({ type: TripFinanceDto })
  async createExpense(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveTripExpenseDto,
  ): Promise<TripFinanceDto> {
    return this.finance.createExpense(authUser.id, id, dto);
  }

  @Patch(':id/finance/expenses/:expenseId')
  @ApiOperation({ summary: 'Поправить расход (только автор)' })
  @ApiOkResponse({ type: TripFinanceDto })
  async updateExpense(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('expenseId', ParseIntPipe) expenseId: number,
    @Body() dto: SaveTripExpenseDto,
  ): Promise<TripFinanceDto> {
    return this.finance.updateExpense(authUser.id, id, expenseId, dto);
  }

  @Delete(':id/finance/expenses/:expenseId')
  @ApiOperation({ summary: 'Удалить расход (только автор)' })
  @ApiOkResponse({ type: TripFinanceDto })
  async deleteExpense(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('expenseId', ParseIntPipe) expenseId: number,
  ): Promise<TripFinanceDto> {
    return this.finance.deleteExpense(authUser.id, id, expenseId);
  }

  @Post(':id/finance/compensations')
  @ApiOperation({ summary: 'Создать ожидающую компенсацию' })
  @ApiOkResponse({ type: TripFinanceDto })
  async createCompensation(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateTripCompensationDto,
  ): Promise<TripFinanceDto> {
    return this.finance.createCompensation(
      authUser.id,
      id,
      dto.toUserId,
      dto.amountRub,
      dto.fromUserId,
    );
  }

  @Post(':id/finance/compensations/:compensationId/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Подтвердить получение (только получатель)' })
  @ApiOkResponse({ type: TripFinanceDto })
  async confirmCompensation(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('compensationId', ParseIntPipe) compensationId: number,
  ): Promise<TripFinanceDto> {
    return this.finance.confirmCompensation(authUser.id, id, compensationId);
  }

  @Delete(':id/finance/compensations/:compensationId')
  @ApiOperation({ summary: 'Отменить ожидающую компенсацию (только отправитель)' })
  @ApiOkResponse({ type: TripFinanceDto })
  async deleteCompensation(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('compensationId', ParseIntPipe) compensationId: number,
  ): Promise<TripFinanceDto> {
    return this.finance.deleteCompensation(authUser.id, id, compensationId);
  }

  /**
   * Отметка о залоге: «сдал», «вернул», «удержал».
   *
   * Ставит организатор — тот, кому отдают деньги. Отдельная ручка, а не
   * `PATCH` похода: масса залога одна на поход и правится в «Правке похода»,
   * а здесь меняется состояние одного человека, и ответ — вся вкладка,
   * как у остальных денежных действий.
   */
  @Put(':id/finance/deposit/:userId')
  @ApiOperation({ summary: 'Отметить состояние залога участника (только организатор)' })
  @ApiOkResponse({ type: TripFinanceDto })
  async setDepositStatus(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Body() dto: SaveTripDepositDto,
  ): Promise<TripFinanceDto> {
    return this.finance.setDepositStatus(authUser.id, id, targetUserId, dto.status);
  }
}
