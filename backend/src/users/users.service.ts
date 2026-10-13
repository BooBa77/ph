import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { SportExperience } from './entities/sport-experience.entity';
import { DisplayNameHistory } from './entities/display-name-history.entity';
import type { SportExperienceData } from './sport-experience.types';

/**
 * Данные для создания пользователя.
 * Email/пароль сюда НЕ входят — они идут в auth_identities через AuthService.
 */
export interface CreateUserData {
  displayName: string;
  location?: string | null;
  avatarUrl?: string | null;
}

/**
 * Данные для обновления профиля.
 * Все поля опциональны — обновляем только то, что пришло.
 *
 * Про avatarUrl здесь намеренно ничего нет: аватарка меняется не через
 * PATCH /users/me, а эндпоинтами POST/DELETE /users/me/avatar, где файл
 * обрабатывается и проверяется. Прямая запись строки в поле позволила бы
 * подставить в него чужой URL, поэтому пути для неё нет.
 */
export interface UpdateUserData {
  displayName?: string;
  location?: string | null;
  isVegetarian?: boolean;
  allergies?: string | null;
  /** undefined — не трогать, null — очистить весь спортивный опыт. */
  sportExperience?: SportExperienceData | null;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Найти пользователя по id.
   */
  async findById(id: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { id } });
  }

  /**
   * Создать пользователя.
   *
   * @param data — данные профиля
   * @param manager — если передан, работаем в чужой транзакции
   *                  (например, из AuthService.verifyCode).
   *                  Если не передан — работаем через свой репозиторий.
   */
  async create(data: CreateUserData, manager?: EntityManager): Promise<User> {
    const repo = manager ? manager.getRepository(User) : this.usersRepository;

    const user = repo.create({
      displayName: data.displayName,
      location: data.location ?? null,
      avatarUrl: data.avatarUrl ?? null,
    });

    return repo.save(user);
  }

  /**
   * Обновить профиль пользователя.
   *
   * Если передан manager — работаем в его транзакции.
   * Если нет — оборачиваем всё в свою транзакцию.
   *
   * Зачем транзакция: изменение displayName пишется в display_name_history.
   * Нужно, чтобы «UPDATE users» и «INSERT в историю» были атомарны:
   * либо оба действия прошли, либо ни одного. Иначе получим рассинхрон
   * (имя изменилось, а в истории записи нет).
   */
  async update(
    id: string,
    data: UpdateUserData,
    manager?: EntityManager,
  ): Promise<User | null> {
    if (manager) {
      return this.updateInternal(manager, id, data);
    }

    return this.dataSource.transaction((m) => this.updateInternal(m, id, data));
  }

  /**
   * Пометить пользователя удалённым (soft delete).
   */
  async setDeletedAt(id: string, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(User) : this.usersRepository;
    await repo.update({ id }, { deletedAt: new Date() });
  }

  /**
   * Снять soft delete (реанимация пользователя).
   *
   * Используем repo.update(), а не save() — один UPDATE без SELECT.
   * Но @UpdateDateColumn не срабатывает на update(), поэтому
   * updated_at проставляем руками.
   */
  async clearDeletedAt(id: string, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(User) : this.usersRepository;
    await repo.update({ id }, { deletedAt: null, updatedAt: new Date() });
  }

  // ─── private ───

  /**
   * Внутренняя реализация update. Всегда работает через переданный
   * manager — не решает, в какой транзакции работать. Это решает
   * публичный update.
   *
   * Логика:
   *   1. Найти пользователя.
   *   2. Если displayName меняется — записать в историю.
   *   3. Обновить поля.
   *   4. Сохранить.
   */
  private async updateInternal(
    manager: EntityManager,
    id: string,
    data: UpdateUserData,
  ): Promise<User | null> {
    const userRepo = manager.getRepository(User);
    const historyRepo = manager.getRepository(DisplayNameHistory);

    const user = await userRepo.findOne({ where: { id } });
    if (!user) return null;

    // Если displayName передан и отличается от текущего — пишем в историю.
    // Не пишем, если пришло то же значение («booba → booba» замусорит).
    if (
      data.displayName !== undefined &&
      data.displayName !== user.displayName
    ) {
      const record = historyRepo.create({
        userId: user.id,
        oldName: user.displayName,
        newName: data.displayName,
        changedAt: new Date(),
      });
      await historyRepo.save(record);

      user.displayName = data.displayName;
    }

    if (data.location !== undefined) user.location = data.location;
    if (data.isVegetarian !== undefined) user.isVegetarian = data.isVegetarian;
    if (data.allergies !== undefined) user.allergies = data.allergies;

    const saved = await userRepo.save(user);

    // Спортивный опыт живёт в отдельной таблице, поэтому сохраняется
    // после пользователя — но в той же транзакции: если строка опыта
    // не запишется, профиль тоже не должен измениться.
    if (data.sportExperience !== undefined) {
      await this.saveSportExperience(manager, user.id, data.sportExperience);
    }

    // Перечитываем: eager-связь подтянет сохранённый опыт, и ответ
    // будет тем же, что отдаёт GET /users/me.
    return userRepo.findOne({ where: { id: saved.id } });
  }

  /**
   * Сохранить спортивный опыт — частично, как PATCH.
   *
   * Логика:
   *   1. `null` — очистить: строка удаляется целиком.
   *   2. Пришли отдельные поля — переносим только их; остальные
   *      колонки остаются как были.
   *   3. Если после переноса все колонки пусты (пользователь поснимал
   *      все выпадающие списки) — строку удаляем, а не держим пустышку:
   *      «опыт не заполнен» и «заполнен, но всё пусто» — одно состояние.
   */
  private async saveSportExperience(
    manager: EntityManager,
    userId: string,
    data: SportExperienceData | null,
  ): Promise<void> {
    const repo = manager.getRepository(SportExperience);
    const existing = await repo.findOne({ where: { userId } });

    if (data === null) {
      if (existing) await repo.delete({ userId });
      return;
    }

    const row = existing ?? repo.create({ userId });

    const alpinism = data.alpinism;
    if (alpinism) {
      if (alpinism.rank !== undefined) row.alpinismRank = alpinism.rank;
      if (alpinism.maxParticipation !== undefined) {
        row.alpinismMaxParticipation = alpinism.maxParticipation;
      }
      if (alpinism.maxLeadership !== undefined) {
        row.alpinismMaxLeadership = alpinism.maxLeadership;
      }
    }

    if (data.skyrunning?.rank !== undefined) {
      row.skyrunningRank = data.skyrunning.rank;
    }

    const tourism = data.sportTourism;
    if (tourism) {
      if (tourism.rank !== undefined) row.tourismRank = tourism.rank;

      const categories = tourism.maxCategories;
      if (categories) {
        if (categories.hiking !== undefined)
          row.tourismMaxHiking = categories.hiking;
        if (categories.mountain !== undefined) {
          row.tourismMaxMountain = categories.mountain;
        }
        if (categories.ski !== undefined) row.tourismMaxSki = categories.ski;
        if (categories.water !== undefined)
          row.tourismMaxWater = categories.water;
        if (categories.caving !== undefined)
          row.tourismMaxCaving = categories.caving;
        if (categories.bicycle !== undefined) {
          row.tourismMaxBicycle = categories.bicycle;
        }
        if (categories.horse !== undefined)
          row.tourismMaxHorse = categories.horse;
        if (categories.sailing !== undefined) {
          row.tourismMaxSailing = categories.sailing;
        }
        if (categories.autoMoto !== undefined) {
          row.tourismMaxAutoMoto = categories.autoMoto;
        }
      }

      const disciplines = tourism.disciplines;
      if (disciplines) {
        if (disciplines.nordicWalking !== undefined) {
          row.tourismNormNordicWalking = disciplines.nordicWalking;
        }
        if (disciplines.distanceHiking !== undefined) {
          row.tourismNormDistanceHiking = disciplines.distanceHiking;
        }
        if (disciplines.distanceSki !== undefined) {
          row.tourismNormDistanceSki = disciplines.distanceSki;
        }
        if (disciplines.distanceWater !== undefined) {
          row.tourismNormDistanceWater = disciplines.distanceWater;
        }
        if (disciplines.distanceCaving !== undefined) {
          row.tourismNormDistanceCaving = disciplines.distanceCaving;
        }
      }
    }

    if (isSportExperienceEmpty(row)) {
      if (existing) await repo.delete({ userId });
      return;
    }

    await repo.save(row);
  }

  /**
   * Записать в профиль новый URL аватарки.
   *
   * Отдельный метод, а не update(): тот пишет аудит-запись в историю
   * имён и оборачивает всё в транзакцию — для одной колонки это лишнее.
   *
   * @returns обновлённого пользователя или null, если его нет
   */
  async setAvatarUrl(
    id: string,
    avatarUrl: string | null,
  ): Promise<User | null> {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) return null;

    user.avatarUrl = avatarUrl;
    return this.usersRepository.save(user);
  }
}

/**
 * Пуст ли спортивный опыт: все колонки NULL.
 *
 * Список колонок перечислен руками намеренно: новую колонку сюда надо
 * добавить, иначе строка с одним только новым значением будет считаться
 * пустой и удалится. Это заметно сразу — значение просто не сохранится.
 */
function isSportExperienceEmpty(row: SportExperience): boolean {
  const values: (string | null | undefined)[] = [
    row.alpinismRank,
    row.alpinismMaxParticipation,
    row.alpinismMaxLeadership,
    row.skyrunningRank,
    row.tourismRank,
    row.tourismMaxHiking,
    row.tourismMaxMountain,
    row.tourismMaxSki,
    row.tourismMaxWater,
    row.tourismMaxCaving,
    row.tourismMaxBicycle,
    row.tourismMaxHorse,
    row.tourismMaxSailing,
    row.tourismMaxAutoMoto,
    row.tourismNormNordicWalking,
    row.tourismNormDistanceHiking,
    row.tourismNormDistanceSki,
    row.tourismNormDistanceWater,
    row.tourismNormDistanceCaving,
  ];

  return values.every((value) => value === null || value === undefined);
}
