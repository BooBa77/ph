import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TripParticipant } from '../trips/entities/trip-participant.entity';
import { TripsModule } from '../trips/trips.module';
import { ChecklistsController } from './checklists.controller';
import { ChecklistsService } from './checklists.service';
import { ChecklistItem } from './entities/checklist-item.entity';
import { Checklist } from './entities/checklist.entity';
import { TripChecklistsController } from './trip-checklists.controller';

/**
 * Чек-листы — подсистема, общая для трёх вкладок похода (Снаряжение,
 * Питание, Аптечка) и для профиля (шаблоны).
 *
 * `TripsModule` импортируется ради одного: правило «виден ли поход»
 * (`TripsService.getVisibleTrip`) должно существовать **в одном месте**.
 * Копия проверки приватности здесь означала бы, что однажды поход закроют,
 * а списки останутся видны.
 *
 * `TripParticipant` в `forFeature` — ради ответа «участник ли этот человек»
 * без похода в `TripsService`: это чтение одной строки, а не правило
 * доступа к походу.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Checklist, ChecklistItem, TripParticipant]),
    TripsModule,
  ],
  controllers: [ChecklistsController, TripChecklistsController],
  providers: [ChecklistsService],
  exports: [ChecklistsService],
})
export class ChecklistsModule {}
