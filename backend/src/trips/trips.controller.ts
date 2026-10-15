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
  Query,
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
import { CreateTripDto } from './dto/create-trip.dto';
import {
  AcceptRequestDto,
  ParticipantListDto,
  TripParticipantDto,
  UpdateMyStatusDto,
} from './dto/participant.dto';
import {
  CreateRequestDto,
  TripRequestDto,
  TripRequestListDto,
} from './dto/request.dto';
import { TripListQueryDto } from './dto/trip-list-query.dto';
import { TripListResponseDto } from './dto/trip-list-response.dto';
import { TripResponseDto } from './dto/trip-response.dto';
import { UpdateTripDto } from './dto/update-trip.dto';
import { TripsService } from './trips.service';

/**
 * Походы.
 *
 * Как и календарь, контроллер работает «от токена»: организатором
 * становится владелец токена, а не тот, кого назвали в теле запроса.
 * Все роуты закрыты глобальным `JwtAuthGuard`.
 *
 * Правка, отмена и работа с составом — только для организатора: это
 * проверяет сервис и отвечает 403 (для публичного похода скрывать нечего,
 * он и так виден). Приватный поход постороннему не виден вовсе — 404.
 */
@ApiTags('trips')
@Controller('trips')
export class TripsController {
  constructor(private readonly tripsService: TripsService) {}

  /**
   * Создать поход. Организатор, его роль в справочнике, оба чата
   * (`trip_guest` и `trip_members`), варианты дат и индекс упоминаний
   * объектов появляются в одной транзакции — поход не может «частично
   * создаться».
   */
  @Post()
  @ApiOperation({ summary: 'Создать поход' })
  @ApiCreatedResponse({ type: TripResponseDto })
  async create(
    @CurrentUser() authUser: AuthUser,
    @Body() dto: CreateTripDto,
  ): Promise<TripResponseDto> {
    return this.tripsService.create(authUser.id, dto);
  }

  /**
   * Лента походов с фильтрами.
   *
   * Приватные походы видны только участникам, отменённые в ленту
   * не попадают — и то и другое без возможности отключить параметром.
   */
  @Get()
  @ApiOperation({ summary: 'Список походов' })
  @ApiOkResponse({ type: TripListResponseDto })
  async list(
    @CurrentUser() authUser: AuthUser,
    @Query() query: TripListQueryDto,
  ): Promise<TripListResponseDto> {
    return this.tripsService.list(authUser.id, query);
  }

  /**
   * Поход по id.
   *
   * Приватный поход для постороннего не существует: ответ — 404, а не 403,
   * чтобы перебором id нельзя было узнать, кто и куда собирается.
   */
  @Get(':id')
  @ApiOperation({ summary: 'Поход по id' })
  @ApiOkResponse({ type: TripResponseDto })
  async findOne(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<TripResponseDto> {
    return this.tripsService.findOne(authUser.id, id);
  }

  /**
   * Изменить поход. Присланные поля перезаписываются, отсутствующие
   * не трогаются, `null` — осознанная очистка. Если меняется маршрут,
   * индекс упоминаний объектов пересобирается.
   */
  @Patch(':id')
  @ApiOperation({ summary: 'Изменить поход' })
  @ApiOkResponse({ type: TripResponseDto })
  async update(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTripDto,
  ): Promise<TripResponseDto> {
    return this.tripsService.update(authUser.id, id, dto);
  }

  /**
   * Отменить поход. Отмена — отдельная ось: статус подготовки она
   * не затирает, поход остаётся в базе для истории.
   */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Отменить поход' })
  @ApiOkResponse({ type: TripResponseDto })
  async cancel(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<TripResponseDto> {
    return this.tripsService.cancel(authUser.id, id);
  }

  /** Снять отмену: «решили всё-таки идти». */
  @Delete(':id/cancel')
  @ApiOperation({ summary: 'Вернуть отменённый поход' })
  @ApiOkResponse({ type: TripResponseDto })
  async restore(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<TripResponseDto> {
    return this.tripsService.restore(authUser.id, id);
  }

  // ───────────────────────────── состав ─────────────────────────────

  /** Состав похода с ролями и статусами. Виден всем, кому виден поход. */
  @Get(':id/participants')
  @ApiOperation({ summary: 'Состав похода' })
  @ApiOkResponse({ type: ParticipantListDto })
  async listParticipants(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ParticipantListDto> {
    return this.tripsService.listParticipants(authUser.id, id);
  }

  /**
   * Свой статус участия: «иду», «пока не решил», «не иду». Организатору
   * тоже доступно — «организую, но сам не иду» законно.
   */
  @Patch(':id/participants/me')
  @ApiOperation({ summary: 'Сменить свой статус участия' })
  @ApiOkResponse({ type: TripParticipantDto })
  async updateMyStatus(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMyStatusDto,
  ): Promise<TripParticipantDto> {
    return this.tripsService.updateMyStatus(authUser.id, id, dto.status);
  }

  /** Убрать человека из состава. Только организатор, и только не себя. */
  @Delete(':id/participants/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Убрать участника из похода' })
  @ApiNoContentResponse({ description: 'Участник убран' })
  async removeParticipant(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('userId') targetUserId: string,
  ): Promise<void> {
    return this.tripsService.removeParticipant(authUser.id, id, targetUserId);
  }

  // ─────────────────────── приглашения и заявки ───────────────────────

  /**
   * Тикеты похода: организатор видит все, остальные — только свои.
   */
  @Get(':id/requests')
  @ApiOperation({ summary: 'Приглашения и заявки' })
  @ApiOkResponse({ type: TripRequestListDto })
  async listRequests(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<TripRequestListDto> {
    return this.tripsService.listRequests(authUser.id, id);
  }

  /**
   * Пригласить (`invite`, только организатор) или подать заявку (`apply`).
   * Приглашение сразу добавляет человека в состав со статусом `invited`.
   */
  @Post(':id/requests')
  @ApiOperation({ summary: 'Пригласить или подать заявку' })
  @ApiCreatedResponse({ type: TripRequestDto })
  async createRequest(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateRequestDto,
  ): Promise<TripRequestDto> {
    return this.tripsService.createRequest(authUser.id, id, dto);
  }

  /**
   * Принять: приглашённый отвечает «иду» или «пока не решил», организатор
   * одобряет заявку. Тикет при этом закрывается.
   */
  @Post(':id/requests/:userId/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Принять приглашение или одобрить заявку' })
  @ApiOkResponse({ type: TripParticipantDto })
  async acceptRequest(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('userId') targetUserId: string,
    @Body() dto: AcceptRequestDto,
  ): Promise<TripParticipantDto> {
    return this.tripsService.acceptRequest(
      authUser.id,
      id,
      targetUserId,
      dto.status,
    );
  }

  /**
   * Закрыть тикет: отказаться от приглашения, отозвать приглашение,
   * отклонить заявку или отозвать свою. Разница — в том, кто делает,
   * и в том, куда уходит системное сообщение.
   */
  @Delete(':id/requests/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Отказаться, отозвать или отклонить' })
  @ApiNoContentResponse({ description: 'Тикет закрыт' })
  async deleteRequest(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('userId') targetUserId: string,
  ): Promise<void> {
    return this.tripsService.deleteRequest(authUser.id, id, targetUserId);
  }
}
