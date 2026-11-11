import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { SportExperience } from './entities/sport-experience.entity';
import { DisplayNameHistory } from './entities/display-name-history.entity';
import { FamilyLink } from './entities/family-link.entity';
import { FamilyUnion } from './entities/family-union.entity';
import { FamilyUnionMember } from './entities/family-union-member.entity';
import { UsersService } from './users.service';
import { FamilyUnionService } from './family-union.service';
import { AvatarService } from './avatar.service';
import { UsersController } from './users.controller';
import { StorageModule } from '../storage/storage.module';

/**
 * Люди и родные.
 *
 * `FamilyUnionService` живёт здесь, а не в `GearModule`, хотя слияние
 * каталогов — его побочный эффект: «Контакты» не должны зависеть от
 * снаряжения, а сама операция слияния — чистая функция над
 * `EntityManager` (`gear/gear-clone.ts`). Иначе `UsersModule` и
 * `GearModule` сослались бы друг на друга, а `GearModule` уже импортирует
 * этот модуль ради `UsersService.familyComponent`.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      SportExperience,
      DisplayNameHistory,
      FamilyLink,
      FamilyUnion,
      FamilyUnionMember,
    ]),
    StorageModule,
  ],
  controllers: [UsersController],
  providers: [UsersService, FamilyUnionService, AvatarService],
  exports: [UsersService],
})
export class UsersModule {}
