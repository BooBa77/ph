import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { DisplayNameHistory } from './entities/display-name-history.entity';
import { UsersService } from './users.service';
import { AvatarService } from './avatar.service';
import { UsersController } from './users.controller';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [TypeOrmModule.forFeature([User, DisplayNameHistory]), StorageModule],
  controllers: [UsersController],
  providers: [UsersService, AvatarService],
  exports: [UsersService],
})
export class UsersModule {}
