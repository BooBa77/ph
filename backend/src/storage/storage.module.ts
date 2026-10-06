import { Injectable, Logger, Module, OnModuleInit } from '@nestjs/common';
import { StorageService } from './storage.service';
import { UPLOADS_DIR } from '../config/uploads.config';

/**
 * Готовит хранилище файлов к работе при старте приложения.
 *
 * Почему отдельный провайдер, а не вызов в main.ts:
 *   - создание каталогов должно происходить и в e2e-тестах, которые
 *     поднимают AppModule без bootstrap из main.ts;
 *   - ошибку прав (том смонтирован от root) надо увидеть в логах при
 *     старте, а не в момент, когда пользователь жмёт «Сохранить».
 *
 * Nest дожидается асинхронного onModuleInit до того, как приложение
 * начнёт принимать запросы, — значит, каталоги точно на месте
 * к первому запросу.
 */
@Injectable()
export class StorageInitService implements OnModuleInit {
  private readonly logger = new Logger(StorageInitService.name);

  constructor(private readonly storage: StorageService) {}

  async onModuleInit(): Promise<void> {
    await this.storage.init();
    this.logger.log(`Хранилище файлов готово: ${UPLOADS_DIR}`);
  }
}

/**
 * Хранилище загруженных файлов на диске.
 *
 * Отдельный модуль, а не часть UsersModule: файлы нужны не только
 * аватаркам (дальше будут обложки маршрутов, фото в дневниках),
 * а зависимости у них общие — каталог, права, проверка путей.
 */
@Module({
  providers: [StorageService, StorageInitService],
  exports: [StorageService],
})
export class StorageModule {}
