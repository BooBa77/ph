import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TripsModule } from '../trips/trips.module';
import { GearAttributeOption } from './entities/gear-attribute-option.entity';
import { GearGroupTemplate } from './entities/gear-group-template.entity';
import { GearGroup } from './entities/gear-group.entity';
import { GearItem } from './entities/gear-item.entity';
import { GearItemAttribute } from './entities/gear-item-attribute.entity';
import { GearTypeGroup } from './entities/gear-type-group.entity';
import { GearType } from './entities/gear-type.entity';
import { GearTypeAttribute } from './entities/gear-type-attribute.entity';
import { TripGearSection } from './entities/trip-gear-section.entity';
import { TripGear } from './entities/trip-gear.entity';
import { GearAdminGroupTemplatesController } from './gear-admin-groups.controller';
import { GearAdminTypesController } from './gear-admin.controller';
import { GearController } from './gear.controller';
import { GearGroupTemplatesService } from './gear-group-templates.service';
import { GearGroupsController } from './gear-groups.controller';
import { GearGroupsService } from './gear-groups.service';
import { GearService } from './gear.service';
import { GearTypesController } from './gear-types.controller';
import { GearTypesService } from './gear-types.service';
import { TripGearController } from './trip-gear.controller';
import { TripGearService } from './trip-gear.service';

/**
 * Снаряжение: личный каталог предметов и общественное снаряжение похода.
 *
 * Свой модуль, а не методы в `UsersModule`: каталог снаряжения — отдельный
 * домен со своими правилами (вес, типы, личные группы), и держать его
 * рядом с профилем значило бы растить `UsersService`, который и так
 * делает много.
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
 * **Две пары «шаблон — копия» (02.11.2026):** `GearGroupTemplatesService`
 * ведёт рекомендуемые группы админа, `GearGroupsService` — личные группы
 * человека и раскладку типов. `GearService` спрашивает у второго
 * `ensure()`: без него новая вещь не знала бы, в какую секцию каталога
 * встать.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      GearItem,
      GearItemAttribute,
      TripGear,
      TripGearSection,
      GearType,
      GearTypeAttribute,
      GearAttributeOption,
      GearGroupTemplate,
      GearGroup,
      GearTypeGroup,
    ]),
    TripsModule,
  ],
  controllers: [
    GearController,
    TripGearController,
    GearTypesController,
    GearAdminTypesController,
    GearGroupsController,
    GearAdminGroupTemplatesController,
  ],
  providers: [
    GearService,
    TripGearService,
    GearTypesService,
    GearGroupsService,
    GearGroupTemplatesService,
  ],
  exports: [
    GearService,
    TripGearService,
    GearTypesService,
    GearGroupsService,
    GearGroupTemplatesService,
  ],
})
export class GearModule {}
