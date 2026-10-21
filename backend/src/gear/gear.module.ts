import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { GearItem } from './entities/gear-item.entity';
import { GearController } from './gear.controller';
import { GearService } from './gear.service';

/**
 * Личное снаряжение (Ф3 карты вкладок).
 *
 * Свой модуль, а не методы в `UsersModule`: каталог снаряжения — отдельный
 * домен со своими правилами (вес, виды), и держать его рядом с профилем
 * значило бы растить `UsersService`, который и так делает много.
 *
 * В поход снаряжение попадёт через вкладку «Снаряжение» (Ф7): она будет
 * читать этот каталог и предлагать предметы в общий список похода.
 */
@Module({
  imports: [TypeOrmModule.forFeature([GearItem])],
  controllers: [GearController],
  providers: [GearService],
  exports: [GearService],
})
export class GearModule {}
