import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { User } from './entities/user.entity';

/**
 * Данные для создания пользователя.
 * Email/пароль сюда НЕ входят — они идут в auth_identities через AuthService.
 */
export interface CreateUserData {
  displayName: string;
  nickname?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  location?: string | null;
  birthDate?: string | null;
  avatarUrl?: string | null;
}

/**
 * Данные для обновления профиля.
 * Все поля опциональны — обновляем только то, что пришло.
 */
export interface UpdateUserData {
  displayName?: string;
  nickname?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  location?: string | null;
  birthDate?: string | null;
  avatarUrl?: string | null;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
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
   * @param manager — если передан, работаем в чужой транзакции (например, из AuthService.register).
   *                  Если не передан — работаем через свой репозиторий.
   */
  async create(data: CreateUserData, manager?: EntityManager): Promise<User> {
    const repo = manager ? manager.getRepository(User) : this.usersRepository;

    const user = repo.create({
      displayName: data.displayName,
      nickname: data.nickname ?? null,
      firstName: data.firstName ?? null,
      lastName: data.lastName ?? null,
      location: data.location ?? null,
      birthDate: data.birthDate ?? null,
      avatarUrl: data.avatarUrl ?? null,
    });

    return repo.save(user);
  }

  /**
   * Обновить профиль пользователя.
   * Позже понадобится для ЛК.
   */
  async update(
    id: string,
    data: UpdateUserData,
    manager?: EntityManager,
  ): Promise<User | null> {
    const repo = manager ? manager.getRepository(User) : this.usersRepository;

    const user = await repo.findOne({ where: { id } });
    if (!user) return null;

    // Обновляем только переданные поля
    if (data.displayName !== undefined) user.displayName = data.displayName;
    if (data.nickname !== undefined) user.nickname = data.nickname;
    if (data.firstName !== undefined) user.firstName = data.firstName;
    if (data.lastName !== undefined) user.lastName = data.lastName;
    if (data.location !== undefined) user.location = data.location;
    if (data.birthDate !== undefined) user.birthDate = data.birthDate;
    if (data.avatarUrl !== undefined) user.avatarUrl = data.avatarUrl;

    return repo.save(user);
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
   */
  async clearDeletedAt(
    id: string,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager ? manager.getRepository(User) : this.usersRepository;
    await repo.update({ id }, { deletedAt: null });
  }  
}