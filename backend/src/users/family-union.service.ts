import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, type Repository } from 'typeorm';

import { FamilyLink } from './entities/family-link.entity';
import { FamilyUnion } from './entities/family-union.entity';
import { FamilyUnionMember } from './entities/family-union-member.entity';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';
import { crossPairs, sameMembers } from './family-union';
import { mergeClones } from '../gear/gear-clone';
import type { FamilyPerson } from './family.types';
import {
  FamilyUnionDto,
  type FamilyUnionMemberDto,
  FamilyUnionPreviewDto,
  FamilyUnionResultDto,
} from './dto/family.dto';

/** Что даёт сбор обеих семей: кого спрашивать и нужна ли заявка. */
interface UnionPlan {
  /** Живые люди обеих компонент — их согласие и понадобится. */
  members: FamilyPerson[];
  /** Цель — свой человек без аккаунта: подтверждать ему нечем. */
  virtualTarget: boolean;
}

/**
 * Объединение семей: заявка, согласия и слияние каталогов (11.11.2026).
 *
 * Заказчик: «строгие пары, без сущности „семья“… Новый родственник тянет
 * всю свою компоненту: заявка на объединение собирает обе стороны, и семья
 * создаётся только после согласия всех». Отсюда три части:
 *
 * 1. **Сбор состава** (`plan`). Семья — компонента связей
 *    (`UsersService.familyComponent`), поэтому «добавить Ивана» значит
 *    «позвать Ивана со всей его семьёй» и «спросить всю свою». Людей
 *    без аккаунта в участники не берём: согласиться им нечем, а их
 *    создатель и так в составе.
 * 2. **Согласия** (`create`, `accept`, `decline`, `cancel`). Инициатор
 *    согласен сразу; остальные отвечают в «Контактах». Встречная заявка
 *    того же состава — не второй запрос, а согласие (решение заказчика).
 * 3. **Слияние** (`finalize`). Когда согласны все: полный граф парных
 *    связей и клоны вещей по `gear_uid` каждому участнику (`mergeClones`).
 *    До этого шага клоны получали только прямые родные, и `A–B–C` не
 *    видели вещей друг друга — теперь видят.
 *
 * Чего здесь нет и почему:
 * - **уведомлений** (письма, пуша) — личных сообщений на фронте нет;
 *   заявка видна в «Контактах» (`people.md` §2.3);
 * - **SSE**: экран перечитывает список после каждого ответа, а чужие
 *   действия человек увидит при следующем открытии — как и раньше;
 * - **ролей** «сын/мать»: текст нейтральный (решение заказчика).
 */
@Injectable()
export class FamilyUnionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly users: UsersService,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(FamilyUnion)
    private readonly unionsRepository: Repository<FamilyUnion>,
    @InjectRepository(FamilyUnionMember)
    private readonly unionMembersRepository: Repository<FamilyUnionMember>,
  ) {}

  /**
   * Что будет, если добавить этого человека.
   *
   * Экран показывает состав обеих семей до подтверждения: человек должен
   * видеть, кого именно впускает, а не нажимать «Добавить» вслепую.
   */
  async preview(
    initiatorId: string,
    targetUserId: string,
  ): Promise<FamilyUnionPreviewDto> {
    const plan = await this.plan(initiatorId, targetUserId);
    const target = await this.usersRepository.findOne({
      where: { id: targetUserId.toLowerCase() },
    });
    if (!target) throw new NotFoundException('Пользователь не найден');

    const mine = await this.myComponentIds(initiatorId);
    const memberIds = plan.virtualTarget
      ? [target.id]
      : plan.members.map((member) => member.id);

    const people = memberIds.length
      ? await this.usersRepository.find({ where: { id: In(memberIds) } })
      : [];
    const byId = new Map(people.map((person) => [person.id, person]));

    return {
      targetUserId: target.id,
      targetName: target.displayName,
      pending: plan.virtualTarget
        ? false
        : (await this.pendingUnionWithSet(initiatorId, memberIds)) !== null,
      members: memberIds.map((id) => {
        const person = byId.get(id);
        const member = plan.members.find((row) => row.id === id);

        return {
          userId: id,
          displayName: person?.displayName ?? member?.displayName ?? '',
          avatarUrl: person?.avatarUrl ?? null,
          isVirtual: person?.isVirtual ?? false,
          mine: mine.has(id),
        };
      }),
    };
  }

  /**
   * Добавить человека в родные: заявка на объединение семей.
   *
   * Свой человек без аккаунта становится родным сразу — единственная
   * пара, где подтверждать некому (`family_links`, 10.11.2026).
   */
  async create(
    initiatorId: string,
    targetUserId: string,
  ): Promise<FamilyUnionResultDto> {
    const plan = await this.plan(initiatorId, targetUserId);

    return this.dataSource.transaction(async (manager) => {
      if (plan.virtualTarget) {
        await this.ensureLinks(manager, crossPairs([initiatorId, targetUserId]));

        return { unionId: null, status: 'accepted' as const };
      }

      const memberIds = plan.members.map((member) => member.id);
      const existing = await this.pendingUnionWithSet(
        initiatorId,
        memberIds,
        manager,
      );

      if (existing) {
        const me = await manager.findOne(FamilyUnionMember, {
          where: { unionId: existing.id, userId: initiatorId },
        });
        if (!me) throw new NotFoundException('Заявка не найдена');

        // «Встречная инициатива того же состава = согласие» (решение
        // заказчика): второй запрос не создаётся, мой ответ засчитан.
        if (me.consent === 'pending') {
          me.consent = 'accepted';
          me.respondedAt = new Date();
          await manager.save(me);

          const accepted = await this.finalize(manager, existing);

          return {
            unionId: existing.id,
            status: accepted ? ('accepted' as const) : ('pending' as const),
          };
        }

        throw new ConflictException(
          'Такая заявка уже отправлена — ждём ответа остальных',
        );
      }

      const union = await manager.save(
        manager.create(FamilyUnion, {
          initiatorUserId: initiatorId,
          status: 'pending',
        }),
      );

      for (const member of plan.members) {
        const isInitiator = member.id === initiatorId;

        await manager.insert(FamilyUnionMember, {
          unionId: union.id,
          userId: member.id,
          consent: isInitiator ? 'accepted' : 'pending',
          respondedAt: isInitiator ? new Date() : null,
        });
      }

      return { unionId: union.id, status: 'pending' as const };
    });
  }

  /**
   * Заявки, в которых я участвую: входящие (ждут моего ответа)
   * и исходящие (ждут ответа остальных).
   *
   * Разделение — по **моему** согласию, а не по тому, кто завёл заявку:
   * инициатор уже согласен и видит её исходящей, а родственник, который
   * ответил «принять», — тоже исходящей, пока не ответили все.
   */
  async listFor(
    userId: string,
  ): Promise<{ incoming: FamilyUnionDto[]; outgoing: FamilyUnionDto[] }> {
    const mineRows = await this.unionMembersRepository.find({
      where: { userId: userId.toLowerCase() },
    });
    if (mineRows.length === 0) return { incoming: [], outgoing: [] };

    const unions = await this.unionsRepository.find({
      where: {
        id: In(mineRows.map((row) => row.unionId)),
        status: 'pending',
      },
      relations: { initiator: true },
      order: { createdAt: 'DESC' },
    });
    if (unions.length === 0) return { incoming: [], outgoing: [] };

    const members = await this.unionMembersRepository.find({
      where: { unionId: In(unions.map((union) => union.id)) },
    });
    const people = await this.usersRepository.find({
      where: { id: In([...new Set(members.map((row) => row.userId))]) },
    });
    const peopleById = new Map(people.map((person) => [person.id, person]));
    const myComponent = await this.myComponentIds(userId);

    const incoming: FamilyUnionDto[] = [];
    const outgoing: FamilyUnionDto[] = [];

    for (const union of unions) {
      const myRow = mineRows.find((row) => row.unionId === union.id);
      if (!myRow) continue;

      const rows: FamilyUnionMemberDto[] = members
        .filter(
          (row) => row.unionId === union.id && peopleById.has(row.userId),
        )
        .map((row) => {
          const person = peopleById.get(row.userId) as User;

          return {
            userId: row.userId,
            displayName: person.displayName,
            avatarUrl: person.avatarUrl,
            isVirtual: person.isVirtual,
            consent: row.consent,
            isInitiator: row.userId === union.initiatorUserId,
            mine: myComponent.has(row.userId),
          };
        })
        .sort((left, right) => {
          // Свои первыми, автор заявки — во главе списка.
          if (left.mine !== right.mine) return left.mine ? -1 : 1;
          if (left.isInitiator !== right.isInitiator) {
            return left.isInitiator ? -1 : 1;
          }

          return left.displayName.localeCompare(right.displayName, 'ru');
        });

      const dto: FamilyUnionDto = {
        id: union.id,
        status: union.status,
        initiatorUserId: union.initiatorUserId,
        initiatorName:
          peopleById.get(union.initiatorUserId)?.displayName ??
          union.initiator?.displayName ??
          '',
        createdAt: union.createdAt.toISOString(),
        myConsent: myRow.consent,
        isInitiator: union.initiatorUserId === userId.toLowerCase(),
        members: rows,
      };

      if (myRow.consent === 'pending') {
        incoming.push(dto);
      } else {
        outgoing.push(dto);
      }
    }

    return { incoming, outgoing };
  }

  /**
   * Ответ на входящую заявку.
   *
   * Отказ закрывает заявку целиком (`declined`): одна семья не может
   * втянуть другую без слова каждого. Согласие — моя строка `accepted`;
   * когда согласны все, здесь же проходит слияние.
   */
  async respond(
    userId: string,
    unionId: string,
    accept: boolean,
  ): Promise<{ status: 'pending' | 'accepted' | 'declined' }> {
    return this.dataSource.transaction(async (manager) => {
      const union = await this.openUnion(manager, unionId);
      const member = await manager.findOne(FamilyUnionMember, {
        where: { unionId: union.id, userId: userId.toLowerCase() },
      });
      if (!member) throw new NotFoundException('Заявка не найдена');
      if (member.consent !== 'pending') {
        throw new ConflictException('Вы уже ответили на эту заявку');
      }

      member.consent = accept ? 'accepted' : 'declined';
      member.respondedAt = new Date();
      await manager.save(member);

      if (!accept) {
        await manager.update(
          FamilyUnion,
          { id: union.id },
          { status: 'declined', closedAt: new Date() },
        );

        return { status: 'declined' as const };
      }

      const accepted = await this.finalize(manager, union);

      return { status: accepted ? ('accepted' as const) : ('pending' as const) };
    });
  }

  /**
   * Отменить заявку — **только её автору**.
   *
   * Ответивший родственник отозвать своё согласие не может: отменить
   * заявку целиком — решение того, кто её завёл, а «передумать» одному
   * из пяти значило бы показать остальным другую заявку, чем та, на
   * которую они отвечали. Уйти из семьи можно всегда — и это закроет
   * висящие заявки (`UsersService.leaveFamily`).
   */
  async cancel(userId: string, unionId: string): Promise<void> {
    const union = await this.openUnion(this.dataSource.manager, unionId);
    if (union.initiatorUserId !== userId.toLowerCase()) {
      throw new ForbiddenException(
        'Отменить заявку может только тот, кто её создал',
      );
    }

    await this.unionsRepository.update(
      { id: union.id },
      { status: 'cancelled', closedAt: new Date() },
    );
  }

  /**
   * Выйти из семьи: все связи человека и все висящие заявки с его
   * участием. Каталог не трогается — у каждого остаётся своя копия вещи.
   */
  async leaveFamily(userId: string): Promise<void> {
    const id = userId.toLowerCase();

    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `
        UPDATE family_unions
           SET status = 'cancelled', closed_at = now()
         WHERE status = 'pending'
           AND id IN (
             SELECT union_id FROM family_union_members WHERE user_id = $1
           )
        `,
        [id],
      );

      await manager.query(
        'DELETE FROM family_links WHERE user_a_id = $1 OR user_b_id = $1',
        [id],
      );
    });
  }

  // ─────────────────────────────── внутреннее ───────────────────────────────

  /**
   * Кого спрашивать, если добавить этого человека.
   *
   * Проверки — человеческие тексты и коды, как у прежней пары: себя — 400,
   * несуществующего — 404, своего не найдём — 404, уже родных — 409.
   */
  private async plan(
    initiatorId: string,
    targetUserId: string,
  ): Promise<UnionPlan> {
    const targetId = targetUserId.toLowerCase();
    if (initiatorId.toLowerCase() === targetId) {
      throw new BadRequestException('Себя в родные добавить нельзя');
    }

    const target = await this.usersRepository.findOne({
      where: { id: targetId },
    });
    if (!target || target.deletedAt !== null) {
      throw new NotFoundException('Пользователь не найден');
    }

    if (target.isVirtual) {
      if (target.virtualOwnerUserId !== initiatorId.toLowerCase()) {
        // Чужой человек без аккаунта для этого человека не существует.
        throw new NotFoundException('Человек без аккаунта не найден');
      }

      return { members: [], virtualTarget: true };
    }

    const mine = await this.users.familyComponent(initiatorId);
    if (mine.some((person) => person.id === targetId)) {
      throw new ConflictException('Вы уже родные');
    }

    const theirs = await this.users.familyComponent(targetId);
    const members = new Map<string, FamilyPerson>();
    for (const person of [...mine, ...theirs]) {
      if (person.isVirtual) continue;
      members.set(person.id, person);
    }

    return { members: [...members.values()], virtualTarget: false };
  }

  /** Компонента связей: кого считать «своими» при показе состава. */
  private async myComponentIds(userId: string): Promise<Set<string>> {
    const component = await this.users.familyComponent(userId);

    return new Set(component.map((person) => person.id));
  }

  /**
   * Висящая заявка с ровно тем же составом.
   *
   * Ищем только среди заявок, где я участник: «встречная инициатива» —
   * это моя же заявка или заявка моей семьи, а не чья-то параллельная
   * с теми же людьми (её создаст тот, кто её завёл).
   */
  private async pendingUnionWithSet(
    userId: string,
    memberIds: string[],
    manager: EntityManager = this.dataSource.manager,
  ): Promise<FamilyUnion | null> {
    const rows = (await manager.query(
      `
      SELECT u.id::text AS id
        FROM family_unions u
       WHERE u.status = 'pending'
         AND EXISTS (
           SELECT 1 FROM family_union_members m
            WHERE m.union_id = u.id AND m.user_id = $1
         )
      `,
      [userId.toLowerCase()],
    )) as Array<{ id: string }>;

    for (const row of rows) {
      const members = await manager.find(FamilyUnionMember, {
        where: { unionId: row.id },
      });
      if (sameMembers(members.map((member) => member.userId), memberIds)) {
        return manager.findOne(FamilyUnion, { where: { id: row.id } });
      }
    }

    return null;
  }

  /** Открытая заявка или человеческая ошибка. */
  private async openUnion(
    manager: EntityManager,
    unionId: string,
  ): Promise<FamilyUnion> {
    const union = await manager.findOne(FamilyUnion, {
      where: { id: unionId },
    });
    if (!union) throw new NotFoundException('Заявка не найдена');
    if (union.status !== 'pending') {
      throw new ConflictException('Заявка уже закрыта');
    }

    return union;
  }

  /** Связи по парам: существующие не трогаем — их не бывает «полусозданных». */
  private async ensureLinks(
    manager: EntityManager,
    pairs: Array<[string, string]>,
  ): Promise<void> {
    for (const [userAId, userBId] of pairs) {
      const exists = await manager.findOne(FamilyLink, {
        where: { userAId, userBId },
      });
      if (exists) continue;

      await manager.insert(FamilyLink, {
        userAId,
        userBId,
        acceptedAt: new Date(),
      });
    }
  }

  /**
   * Слить семьи, если согласны все.
   *
   * Возвращает `true`, когда заявка закрыта согласием. Удалённые (мягко)
   * участники не считаются: их каталога и ответа больше нет, и держать
   * из-за них заявку открытой бессмысленно.
   *
   * Слияние идёт **в одной транзакции** с ответом на заявку: половина
   * семьи с новыми связями и без клонов — состояние, из которого потом
   * не понять, что именно произошло.
   */
  private async finalize(
    manager: EntityManager,
    union: FamilyUnion,
  ): Promise<boolean> {
    const members = await manager.find(FamilyUnionMember, {
      where: { unionId: union.id },
    });
    const people = await manager.find(User, {
      where: { id: In(members.map((member) => member.userId)) },
    });
    const alive = new Set(
      people
        .filter((person) => person.deletedAt === null && !person.isVirtual)
        .map((person) => person.id),
    );
    const required = members.filter((member) => alive.has(member.userId));

    if (required.length < 2) return false;
    if (required.some((member) => member.consent !== 'accepted')) return false;

    const memberIds = required.map((member) => member.userId);
    await this.ensureLinks(manager, crossPairs(memberIds));
    await mergeClones(manager, memberIds);

    await manager.update(
      FamilyUnion,
      { id: union.id },
      { status: 'accepted', closedAt: new Date() },
    );

    return true;
  }
}
