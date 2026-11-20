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
  SyncTripExpensesDto,
  TransferTripDepositDto,
  TripDepartureDto,
  TripFinanceDto,
  TripFinanceSyncDto,
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

  /**
   * Уведомление при выходе (20.11.2026): что задействовано и что с деньгами.
   *
   * Отдельная ручка, а не кусок `GET /finance`: уйти из похода вправе любой
   * участник, а «Бухгалтерия» ушедшему уже закрыта. Отдаём только то, что
   * нужно для текста подтверждения, — ни балансов, ни чужих сумм.
   */
  @Get(':id/finance/departure')
  @ApiOperation({ summary: 'Что человек видит перед выходом: снаряжение и деньги' })
  @ApiOkResponse({ type: TripDepartureDto })
  async departure(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<TripDepartureDto> {
    return this.finance.departureInfo(authUser.id, id);
  }

  @Post(':id/finance/expenses')  @ApiOperation({ summary: 'Добавить расход' })
  @ApiOkResponse({ type: TripFinanceDto })
  async createExpense(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveTripExpenseDto,
  ): Promise<TripFinanceDto> {
    return this.finance.createExpense(authUser.id, id, dto);
  }

  /**
   * Пачка чеков из очереди устройства (19.11.2026).
   *
   * Отдельная ручка, а не N вызовов создания: без связи чеков может
   * накопиться несколько, и каждый лишний запрос в поле — лишний шанс
   * не доехать. Ответ — вкладка целиком плюс `results` по каждому ключу:
   * принятый чек снимается с устройства, отклонённый остаётся с причиной.
   *
   * `200`, а не `201`: пачка может не создать ничего — все чеки уже
   * доехали прошлым заходом, и это успех, а не новая запись.
   */
  @Post(':id/finance/expenses/sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Принять офлайн-чеки из очереди устройства' })
  @ApiOkResponse({ type: TripFinanceSyncDto })
  async syncExpenses(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SyncTripExpensesDto,
  ): Promise<TripFinanceSyncDto> {
    return this.finance.syncExpenses(authUser.id, id, dto);
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
   * Решение по залогу вышедшего: вернуть, удержать или снять.
   *
   * Ставит организатор или соорганизатор — тот, кто держит кассу.
   * Отдельная ручка, а не `PATCH` похода: сумма залога одна на поход
   * и правится в «Правке похода», а здесь решается судьба одного человека,
   * и ответ — вся вкладка, как у остальных денежных действий.
   *
   * «Сдал» руками больше нет: сдачу подтверждает получатель перевода
   * (`confirmCompensation`), как у компенсации.
   */
  @Put(':id/finance/deposit/:userId')
  @ApiOperation({
    summary: 'Решить судьбу залога вышедшего: вернуть, удержать или снять',
  })
  @ApiOkResponse({ type: TripFinanceDto })
  async setDepositStatus(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Body() dto: SaveTripDepositDto,
  ): Promise<TripFinanceDto> {
    return this.finance.setDepositStatus(authUser.id, id, targetUserId, dto.status);
  }

  /**
   * «Перевести залог» — участник переводит его организатору (18.11.2026, v3).
   *
   * Создаёт ожидающий перевод `kind: 'deposit'`: подтверждает получатель,
   * и только тогда балансы двигаются — у отправителя плюс, у организатора
   * минус. Сумма произвольная: по умолчанию недостача, но её можно менять,
   * в том числе в бо́льшую сторону; излишек при подтверждении станет
   * обычным переводом. `fromUserId` — за человека без аккаунта, которого
   * ведёт смотрящий. Ответ — вся вкладка, как у остальных денежных действий.
   */
  @Post(':id/finance/deposit/transfer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Перевести залог организатору (участник или ведущий)' })
  @ApiOkResponse({ type: TripFinanceDto })
  async transferDeposit(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: TransferTripDepositDto,
  ): Promise<TripFinanceDto> {
    return this.finance.transferDeposit(
      authUser.id,
      id,
      dto.recipientUserId,
      dto.amountRub,
      dto.fromUserId,
    );
  }
}
