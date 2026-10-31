import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  IsNull,
  Repository,
} from 'typeorm';
import { User } from './entities/user.entity';
import { SportExperience } from './entities/sport-experience.entity';
import { DisplayNameHistory } from './entities/display-name-history.entity';
import { TripParticipant } from '../trips/entities/trip-participant.entity';
import type { UserGender } from './gender.types';
import type { SportExperienceData } from './sport-experience.types';
import {
  VirtualUserDto,
  type CreateVirtualUserDto,
  type UpdateVirtualUserDto,
} from './dto/virtual-user.dto';

/** Сколько людей отдавать в поиске: список выбора, а не справочник. */
const SEARCH_LIMIT = 20;

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
  /** Пол — коэффициент распределения веса рюкзака; по умолчанию `m`. */
  gender?: UserGender;
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
   * Найти людей по подстроке имени — для приглашения в поход.
   *
   * `%` и `_` экранируются: иначе «%» пользователя превратился бы
   * в «показать всех», а это не поиск, а его отсутствие.
   *
   * Себя из выдачи убираем: пригласить себя в поход нельзя, и человек
   * в собственном списке выбора — это шум. Уже приглашённых отсеивает
   * интерфейс: он один знает, кого в этом походе ещё нет.
   *
   * **Люди без аккаунта не находятся** (30.10.2026): их заводит организатор
   * для своего похода, и «позвать» такого человека через поиск нельзя —
   * приглашение ему всё равно некуда приходит. Отсекаем здесь, а не в
   * фильтре контроллера: поиск людей — одно правило и одно место.
   */
  async search(
    search: string | undefined,
    excludeUserId?: string,
  ): Promise<User[]> {
    const text = search?.trim();
    if (!text) return [];

    const escaped = text.replace(/[%_\\]/g, '\\$&');

    const qb = this.usersRepository
      .createQueryBuilder('user')
      .where('user.displayName ILIKE :search', { search: `%${escaped}%` })
      .andWhere('user.is_virtual = false')
      .orderBy('user.displayName', 'ASC')
      .take(SEARCH_LIMIT);

    if (excludeUserId) {
      qb.andWhere('user.id <> :excludeUserId', { excludeUserId });
    }

    return qb.getMany();
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

  // ─── люди без аккаунта (30.10.2026) ───

  /**
   * Мои люди без аккаунта — для «быстрого добавления» в следующий поход.
   *
   * Человек, которого убрали из личного списка (`deleted_at`), здесь
   * не показывается. Удалённых физически виртуальных не бывает: строка
   * `users` одна на человека, и походы ссылаются на неё.
   */
  async listVirtual(ownerUserId: string): Promise<VirtualUserDto[]> {
    const users = await this.usersRepository.find({
      where: {
        isVirtual: true,
        virtualOwnerUserId: ownerUserId,
        deletedAt: IsNull(),
      },
      order: { displayName: 'ASC' },
    });

    return users.map((user) => VirtualUserDto.from(user));
  }

  /**
   * Завести человека без аккаунта.
   *
   * `manager` — когда создание идёт вместе с добавлением в поход
   * (`POST /api/trips/:id/participants/virtual`): «завёл, но в состав
   * не попал» — это поломка данных, а не полшага.
   *
   * `is_virtual` и создатель пишутся вместе: правило базы
   * (`chk_users_virtual_owner`) не даёт одного без другого, и обходить
   * его из кода незачем.
   */
  async createVirtual(
    ownerUserId: string,
    dto: CreateVirtualUserDto,
    manager?: EntityManager,
  ): Promise<User> {
    const repo = manager ? manager.getRepository(User) : this.usersRepository;
    const displayName = dto.displayName.trim();
    if (displayName.length === 0) {
      throw new BadRequestException('У человека должно быть имя');
    }

    return repo.save(
      repo.create({
        displayName,
        gender: dto.gender ?? 'm',
        isVirtual: true,
        virtualOwnerUserId: ownerUserId,
      }),
    );
  }

  /**
   * Переименовать или поменять пол.
   *
   * История имён (`display_name_history`) для виртуальных не пишется:
   * это аудит профиля человека, а здесь организатор правит свою запись.
   * Переименование всё равно видно везде сразу — строка `users` одна,
   * и походы ссылаются на неё, а не хранят копию имени.
   */
  async updateVirtual(
    ownerUserId: string,
    userId: string,
    dto: UpdateVirtualUserDto,
  ): Promise<User> {
    const user = await this.findOwnedVirtual(ownerUserId, userId);

    if (dto.displayName !== undefined) {
      const displayName = dto.displayName.trim();
      if (displayName.length === 0) {
        throw new BadRequestException('У человека должно быть имя');
      }
      user.displayName = displayName;
    }
    if (dto.gender !== undefined) user.gender = dto.gender;

    return this.usersRepository.save(user);
  }

  /**
   * Убрать из личного списка — мягко (`deleted_at`), как удаляется обычный
   * пользователь.
   *
   * Пока человек участвует хоть в одном походе, убрать его нельзя (409,
   * как у вещи, которая уже едет в походе): пропал бы участник состава,
   * и в палатках, трансфере и питании остались бы ссылки на него.
   */
  async removeVirtual(ownerUserId: string, userId: string): Promise<void> {
    await this.findOwnedVirtual(ownerUserId, userId);

    const trips = await this.dataSource.manager.count(TripParticipant, {
      where: { userId },
    });
    if (trips > 0) {
      throw new ConflictException(
        'Человек без аккаунта ещё участвует в походе — сначала уберите его из состава',
      );
    }

    await this.setDeletedAt(userId);
  }

  /**
   * Мой виртуальный по id — или 404.
   *
   * 404, а не 403: чужой виртуальный для этого человека не существует,
   * и перебирать id чужих людей без аккаунта нечего (та же логика, что
   * у чужого снаряжения в каталоге). Публичный метод — им пользуется
   * `TripsService`, когда добавляет существующего виртуального в поход.
   */
  async findOwnedVirtual(
    ownerUserId: string,
    userId: string,
    manager?: EntityManager,
  ): Promise<User> {
    const repo = manager ? manager.getRepository(User) : this.usersRepository;
    const user = await repo.findOne({
      where: {
        id: userId,
        isVirtual: true,
        virtualOwnerUserId: ownerUserId,
        deletedAt: IsNull(),
      },
    });

    if (!user) throw new NotFoundException('Человек без аккаунта не найден');

    return user;
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
    if (data.gender !== undefined) user.gender = data.gender;
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
      if (alpinism.rescueToken !== undefined) {
        row.alpinismRescueToken = alpinism.rescueToken;
      }
      if (alpinism.instructorMethodist !== undefined) {
        row.alpinismInstructorMethodist = alpinism.instructorMethodist;
      }
      if (alpinism.instructorGuide !== undefined) {
        row.alpinismInstructorGuide = alpinism.instructorGuide;
      }
      // Ссылку на лицензию не сбрасываем вместе с категорией: форма
      // показывает её только при выбранной категории, а если человек
      // вернёт категорию, ссылка окажется на месте. Строка при этом
      // не пустеет — ссылка считается значением.
      if (alpinism.instructorGuideLicense !== undefined) {
        row.alpinismInstructorGuideLicense = alpinism.instructorGuideLicense;
      }
      if (alpinism.youthTourismOrganizer !== undefined) {
        row.alpinismYouthTourismOrganizer = alpinism.youthTourismOrganizer;
      }
      if (alpinism.youthTourismInstructor !== undefined) {
        row.alpinismYouthTourismInstructor = alpinism.youthTourismInstructor;
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
 * Пуст ли спортивный опыт: все колонки NULL, а галочка-жетон снята.
 *
 * Список колонок перечислен руками намеренно: новую колонку сюда надо
 * добавить, иначе строка с одним только новым значением будет считаться
 * пустой и удалится. Это заметно сразу — значение просто не сохранится.
 */
function isSportExperienceEmpty(row: SportExperience): boolean {
  const values: (string | boolean | null | undefined)[] = [
    row.alpinismRank,
    row.alpinismMaxParticipation,
    row.alpinismMaxLeadership,
    // Снятая галочка — пустое значение: строка с одной только снятой
    // галочкой не должна оставаться в базе.
    row.alpinismRescueToken ? true : null,
    row.alpinismInstructorMethodist,
    row.alpinismInstructorGuide,
    row.alpinismInstructorGuideLicense,
    row.alpinismYouthTourismOrganizer ? true : null,
    row.alpinismYouthTourismInstructor ? true : null,
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
