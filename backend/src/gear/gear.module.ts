import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TripsModule } from '../trips/trips.module';
import { GearItem } from './entities/gear-item.entity';
import { TripGear } from './entities/trip-gear.entity';
import { GearController } from './gear.controller';
import { GearService } from './gear.service';
import { TripGearController } from './trip-gear.controller';
import { TripGearService } from './trip-gear.service';

/**
 * Снаряжение: личный каталог предметов и общественное снаряжение похода.
 *
 * Свой модуль, а не методы в `UsersModule`: каталог снаряжения — отдельный
 * домен со своими правилами (вес, виды), и держать его рядом с профилем
 * значило бы растить `UsersService`, который и так делает много.
 *
 * `TripsModule` импортируется ради двух правил похода: «виден ли поход»
 * (`getVisibleTrip`) и «можно ли править вкладку» (`canEditTab`). Копия
 * матрицы прав здесь означала бы, что однажды завхоза назначат иначе,
 * а снаряжение об этом не узнает.
 *
 * `TripGear` в `GearService` нужен для одного запрета: предмет, который
 * уже едет в походе, нельзя удалить из каталога (409 вместо ошибки
 * внешнего ключа).
 */
@Module({
  imports: [TypeOrmModule.forFeature([GearItem, TripGear]), TripsModule],
  controllers: [GearController, TripGearController],
  providers: [GearService, TripGearService],
  exports: [GearService, TripGearService],
})
export class GearModule {}
