import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TripsModule } from '../trips/trips.module';
import { GearItem } from './entities/gear-item.entity';
import { GearType } from './entities/gear-type.entity';
import { GearTypeAttribute } from './entities/gear-type-attribute.entity';
import { TripGear } from './entities/trip-gear.entity';
import { GearAdminTypesController } from './gear-admin.controller';
import { GearController } from './gear.controller';
import { GearService } from './gear.service';
import { GearTypesController } from './gear-types.controller';
import { GearTypesService } from './gear-types.service';
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
 *
 * `GearTypesService` — справочник типов и характеристик (Stage A): типы
 * правит админ, и каталог вещей переедет на них в Stage B. Лежит здесь же,
 * потому что это тот же домен снаряжения и та же таблица-сосед; отдельный
 * модуль ради двух таблиц добавил бы импорт без пользы.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      GearItem,
      TripGear,
      GearType,
      GearTypeAttribute,
    ]),
    TripsModule,
  ],
  controllers: [
    GearController,
    TripGearController,
    GearTypesController,
    GearAdminTypesController,
  ],
  providers: [GearService, TripGearService, GearTypesService],
  exports: [GearService, TripGearService, GearTypesService],
})
export class GearModule {}
