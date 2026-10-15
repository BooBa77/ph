import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, QueryFailedError, Repository } from 'typeorm';

import { User } from '../users/entities/user.entity';
import { isAdminUser } from './admin';
import type { CalendarDayType, CalendarMode } from './calendar.types';
import {
  ActivityRequestDto,
  ActivityTypeDto,
  type ActivityDictionaryDto,
  type CreateActivityRequestDto,
  type DayNotesDto,
  type ModerationDto,
  type ToggleActivityDto,
} from './dto/activity.dto';
import { CalendarDayDto, UpdateDayDto, UpdateDaysDto } from './dto/day.dto';
import { YearStateDto } from './dto/year.dto';
import {
  educationBreaksForYear,
  hasEducationCalendar,
} from './education-breaks';
import { CalendarActivity } from './entities/activity.entity';
import { CalendarActivityFavorite } from './entities/activity-favorite.entity';
import { CalendarActivityGroup } from './entities/activity-group.entity';
import { CalendarActivityType } from './entities/activity-type.entity';
import { CalendarActivityTypeRequest } from './entities/activity-type-request.entity';
import type { ActivityRequestStatus } from './entities/activity-type-request.entity';
import { CalendarDay } from './entities/calendar-day.entity';
import { CalendarStateDay } from './entities/calendar-state-day.entity';

/** Границы допустимых годов: мусор отсекаем, историю не ограничиваем. */
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

/**
 * Предел диапазона в одном запросе. Фронт просит месяц с хвостами — 42 дня;
 * год (366) оставлен запасом, больше похоже на попытку выкачать всё сразу.
 */
const MAX_RANGE_DAYS = 366;

/** Код ошибки PostgreSQL «нарушение уникальности». */
const UNIQUE_VIOLATION = '23505';

const WEEKDAY_LONG = new Intl.DateTimeFormat('ru-RU', { weekday: 'long' });

const capitalize = (text: string): string =>
  text.charAt(0).toUpperCase() + text.slice(1);

/** Локальная дата в `YYYY-MM-DD`. `toISOString` тут не годится: он UTC. */
function iso(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Разбор `YYYY-MM-DD` в локальную дату. */
function parseIso(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year as number, (month as number) - 1, day as number);
}

/**
 * Существует ли такая дата на самом деле.
 *
 * Регулярка пропускает `2026-02-30`, а PostgreSQL на таком значении падает
 * пятисоткой. Сравниваем круговорот: у несуществующей даты `Date` уедет
 * на другое число, и строки не совпадут.
 */
function isRealDate(value: string): boolean {
  return iso(parseIso(value)) === value;
}

function assertYear(year: number): void {
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
    throw new BadRequestException(
      `Год должен быть целым числом от ${MIN_YEAR} до ${MAX_YEAR}`,
    );
  }
}

function yearBounds(year: number): { from: string; to: string } {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/** Все дни календарного года по порядку. */
function* datesOfYear(year: number): Generator<Date> {
  for (
    const cursor = new Date(year, 0, 1);
    cursor.getFullYear() === year;
    cursor.setDate(cursor.getDate() + 1)
  ) {
    yield new Date(cursor);
  }
}

function isWeekendDay(date: Date): boolean {
  return date.getDay() === 0 || date.getDay() === 6;
}

/**
 * Календарь пользователя.
 *
 * Два источника данных: шаблон года (`calendar_state_production`, заполняется
 * из постановлений Правительства) и личный календарь (`calendar_production`,
 * 365 строк на год). Личный заполняется один раз при первом обращении к году
 * и дальше принадлежит пользователю: мы его не перезаписываем, поэтому
 * правки не пропадают, когда выходит государственный календарь на новый год.
 *
 * Заполнение года считает сервис, а не фронт: правила («5/2 плюс праздники
 * плюс каникулы», «праздник, совпавший с выходным, уехал») живут в одном
 * месте — здесь и в генераторе шаблона. Два независимых калькулятора
 * календаря рано или поздно разошлись бы.
 */
@Injectable()
export class CalendarService {
  constructor(
    @InjectRepository(CalendarDay)
    private readonly days: Repository<CalendarDay>,
    @InjectRepository(CalendarStateDay)
    private readonly stateDays: Repository<CalendarStateDay>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(CalendarActivityGroup)
    private readonly activityGroups: Repository<CalendarActivityGroup>,
    @InjectRepository(CalendarActivityType)
    private readonly activityTypes: Repository<CalendarActivityType>,
    @InjectRepository(CalendarActivity)
    private readonly activities: Repository<CalendarActivity>,
    @InjectRepository(CalendarActivityFavorite)
    private readonly favorites: Repository<CalendarActivityFavorite>,
    @InjectRepository(CalendarActivityTypeRequest)
    private readonly activityRequests: Repository<CalendarActivityTypeRequest>,
    private readonly dataSource: DataSource,
  ) {}

  /** Состояние года: создан ли календарь, какой режим, есть ли шаблон. */
  async getYearState(userId: string, year: number): Promise<YearStateDto> {
    assertYear(year);
    const { from, to } = yearBounds(year);

    const [user, filledDays, stateDays] = await Promise.all([
      this.users.findOne({
        where: { id: userId },
        select: { id: true, calendarMode: true },
      }),
      this.days.count({ where: { userId, date: Between(from, to) } }),
      this.stateDays.count({ where: { date: Between(from, to) } }),
    ]);

    if (!user) {
      throw new NotFoundException('Пользователь не найден');
    }

    return YearStateDto.from({
      year,
      mode: user.calendarMode,
      filledDays,
      stateAvailable: stateDays > 0,
      educationAvailable: hasEducationCalendar(year),
    });
  }

  /**
   * Создать календарь на год.
   *
   * Режим определяет, чем заполняется год:
   *  - `cycle` — копия государственного шаблона (5/2 плюс праздники);
   *  - `study` — то же плюс каникулы из учебного календаря;
   *  - `free`, `parental`, `retired` — весь год выходными.
   *
   * Если шаблона на год нет (он ещё не утверждён), год всё равно
   * заполняется: 5/2 без праздников. Фронт об этом предупреждает заранее —
   * `stateAvailable` в состоянии года.
   */
  async initYear(
    userId: string,
    year: number,
    mode: CalendarMode,
  ): Promise<YearStateDto> {
    assertYear(year);
    const { from, to } = yearBounds(year);

    const stateRows = await this.stateDays.find({
      where: { date: Between(from, to) },
    });
    const stateByDate = new Map(stateRows.map((row) => [row.date, row]));

    const breaks =
      mode === 'study'
        ? educationBreaksForYear(year)
        : new Map<string, string>();

    const dates: string[] = [];
    const types: CalendarDayType[] = [];
    const labels: (string | null)[] = [];

    for (const date of datesOfYear(year)) {
      const key = iso(date);
      const state = stateByDate.get(key);

      // База: рабочие дни по будням, выходные по субботам и воскресеньям.
      let dayType: CalendarDayType = isWeekendDay(date) ? 'weekend' : 'workday';
      let label: string | null = null;

      if (mode === 'cycle' || mode === 'study') {
        // Государственный календарь перекрывает базу: 9 января 2026
        // выходной, хотя это пятница.
        if (state) {
          dayType = state.dayType;
        }
      } else {
        // Свободный график, декрет и пенсия — весь год выходными.
        dayType = 'weekend';
      }

      if (mode === 'study') {
        const breakLabel = breaks.get(key);
        if (breakLabel) {
          // Каникулы важнее государственного календаря: 27–30 октября 2026
          // по госкалендарю рабочие дни, а школьник отдыхает.
          dayType = 'weekend';
          label = breakLabel;
        }
      }

      // Метка: каникулы, потом шаблон (праздник или перенос), потом день
      // недели — чтобы у дня всегда было человеческое название.
      if (!label) {
        label = state?.label ?? null;
      }
      if (!label) {
        label = capitalize(WEEKDAY_LONG.format(date));
      }

      dates.push(key);
      types.push(dayType);
      labels.push(label);
    }

    try {
      await this.dataSource.transaction(async (manager) => {
        const existing = await manager.count(CalendarDay, {
          where: { userId, date: Between(from, to) },
        });
        if (existing > 0) {
          throw new ConflictException('Календарь на этот год уже создан');
        }

        // Одним запросом, а не 365 вставками: параметры едут массивами,
        // PostgreSQL разворачивает их через unnest.
        await manager.query(
          `INSERT INTO calendar_production (user_id, date, day_type, label)
           SELECT $1, * FROM unnest($2::date[], $3::text[], $4::text[])`,
          [userId, dates, types, labels],
        );

        /**
         * Режим работы — один на пользователя, а не на год, поэтому
         * заполнение старого года не должно его перебивать: человек
         * расписал 2031 как «на пенсии», а потом зашёл в 2026 и ответил
         * «работаю» — текущий режим остаётся пенсионным, иначе вопрос про
         * 2032 внезапно стал бы про работу.
         *
         * Правило: режим обновляем, только если заполняем самый поздний
         * год из уже заполненных (или заполняем впервые).
         */
        const latest = await manager
          .createQueryBuilder(CalendarDay, 'day')
          .select('max(day.date)::text', 'latest')
          .where('day.user_id = :userId', { userId })
          .getRawOne<{ latest: string | null }>();

        const latestYear = latest?.latest
          ? Number(latest.latest.slice(0, 4))
          : null;

        if (latestYear === null || year >= latestYear) {
          const updated = await manager.update(
            User,
            { id: userId },
            { calendarMode: mode },
          );
          if (!updated.affected) {
            throw new NotFoundException('Пользователь не найден');
          }
        }
      });
    } catch (error) {
      // Два одновременных запроса на создание года: второй ловит нарушение
      // первичного ключа. Пользователю это не ошибка сервера, а «уже создан».
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string })?.code === UNIQUE_VIOLATION
      ) {
        throw new ConflictException('Календарь на этот год уже создан');
      }
      throw error;
    }

    return this.getYearState(userId, year);
  }

  /** Дни диапазона — персональный календарь как есть. */
  async getDays(
    userId: string,
    from: string,
    to: string,
  ): Promise<CalendarDayDto[]> {
    if (!isRealDate(from) || !isRealDate(to)) {
      throw new BadRequestException('Некорректная дата в диапазоне');
    }

    const start = parseIso(from);
    const end = parseIso(to);
    const span = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;

    if (span < 1) {
      throw new BadRequestException('Конец диапазона раньше начала');
    }
    if (span > MAX_RANGE_DAYS) {
      throw new BadRequestException(
        `Диапазон не должен превышать ${MAX_RANGE_DAYS} дней`,
      );
    }

    const rows = await this.days.find({
      where: { userId, date: Between(from, to) },
      order: { date: 'ASC' },
    });

    return rows.map((row) => CalendarDayDto.from(row));
  }

  /** Правка одного дня из модалки дня: статус, метка или и то и другое. */
  async updateDay(userId: string, dto: UpdateDayDto): Promise<CalendarDayDto> {
    if (!isRealDate(dto.date)) {
      throw new BadRequestException('Некорректная дата');
    }
    if (dto.dayType === undefined && dto.label === undefined) {
      throw new BadRequestException(
        'Нечего менять: ни статус, ни метка не переданы',
      );
    }

    const day = await this.days.findOne({
      where: { userId, date: dto.date },
    });
    if (!day) {
      throw new ConflictException(
        'Календарь на этот год ещё не создан — сначала создайте его',
      );
    }

    if (dto.dayType !== undefined) {
      day.dayType = dto.dayType;
    }
    if (dto.label !== undefined) {
      day.label = dto.label;
    }

    await this.days.save(day);
    return CalendarDayDto.from(day);
  }

  /**
   * Пачка правок из модалки производственного календаря.
   *
   * Пересечения внутри пачки разрешаем по последней записи: пользователь
   * мог задать диапазон, а потом ткнуть в отдельный день внутри него.
   */
  async updateDays(
    userId: string,
    dto: UpdateDaysDto,
  ): Promise<{ updated: number }> {
    const byDate = new Map<
      string,
      { dayType: CalendarDayType; label: string | null }
    >();

    for (const item of dto.days) {
      if (!isRealDate(item.date)) {
        throw new BadRequestException(`Некорректная дата: ${item.date}`);
      }
      byDate.set(item.date, {
        dayType: item.dayType,
        label: item.label ?? null,
      });
    }

    const dates = [...byDate.keys()].sort();
    const types = dates.map((date) => byDate.get(date)!.dayType);
    const labels = dates.map((date) => byDate.get(date)!.label);

    return this.dataSource.transaction(async (manager) => {
      /**
       * Сначала проверяем, что все дни существуют, и только потом пишем.
       *
       * Почему не по числу обновлённых строк из `UPDATE ... RETURNING`:
       * `EntityManager.query` отдаёт результат драйвера, а не список строк,
       * и опираться на его длину — гадание. Отдельный SELECT возвращает
       * ровно то, что нужно, и заодно даёт понять, каких дат не хватает.
       */
      const existing: { date: string }[] = await manager.query(
        `SELECT date::text AS date FROM calendar_production
          WHERE user_id = $1 AND date = ANY($2::date[])`,
        [userId, dates],
      );

      const found = new Set(existing.map((row) => row.date));
      const missing = dates.filter((date) => !found.has(date));

      if (missing.length > 0) {
        throw new ConflictException(
          `Нет дней вне созданных календарей: ${missing.slice(0, 3).join(', ')}` +
            (missing.length > 3 ? ` и ещё ${missing.length - 3}` : '') +
            '. Сначала создайте календарь на этот год',
        );
      }

      await manager.query(
        `UPDATE calendar_production AS day
            SET day_type = patch.day_type, label = patch.label
           FROM unnest($2::date[], $3::text[], $4::text[])
                AS patch(date, day_type, label)
          WHERE day.user_id = $1 AND day.date = patch.date`,
        [userId, dates, types, labels],
      );

      return { updated: dates.length };
    });
  }

  // ─────────────────────────── активности ───────────────────────────

  /**
   * Справочник активностей: группы с типами, избранное и свои запросы.
   *
   * Отдаём одним ответом: фронт запрашивает его при открытии календаря
   * и держит в Pinia, а не ходит за группами, типами и избранным отдельно.
   */
  async getActivityDictionary(userId: string): Promise<ActivityDictionaryDto> {
    const [groups, types, favorites, requests] = await Promise.all([
      this.activityGroups.find({
        where: { isActive: true },
        order: { id: 'ASC' },
      }),
      this.activityTypes.find({
        where: { isActive: true },
        order: { id: 'ASC' },
      }),
      this.favorites.find({
        where: { userId },
        // Второй ключ — идентификатор: при равных счётчиках порядок
        // должен быть предсказуемым, иначе избранное «дышит» между запросами.
        order: { usageCount: 'DESC', activityTypeId: 'ASC' },
      }),
      this.activityRequests.find({ where: { userId }, order: { id: 'DESC' } }),
    ]);

    return {
      groups: groups.map((group) => ({
        id: group.id,
        code: group.code,
        label: group.label,
        color: group.color,
        types: types
          .filter((type) => type.groupId === group.id)
          .map((type) => ActivityTypeDto.from(type)),
      })),
      favorites: favorites
        // Ноль в счётчике — это «отметил и снял»: в избранном такому типу
        // делать нечего. Строку не удаляем сразу (см. bumpFavorite), поэтому
        // фильтруем при чтении.
        .filter((favorite) => favorite.usageCount > 0)
        .map((favorite) => favorite.activityTypeId),
      requests: requests.map((request) => ActivityRequestDto.from(request)),
      isAdmin: isAdminUser(userId),
    };
  }

  // ─────────────────────────── модерация ───────────────────────────

  /**
   * Модерация: все типы, включая погашенные, и заявки пользователей.
   *
   * Погашенный тип (`is_active = false`) — это и есть «вариант иконки
   * на рассмотрении»: в справочнике он лежит, пользователям не выдаётся,
   * пока админ не включит. Поэтому одобрение не требует правки базы руками,
   * нужна только иконка в файле фронтенда.
   *
   * Доступ только у админа: список захардкожен, таблица `admin_users`
   * намеренно не используется.
   */
  async getModeration(userId: string): Promise<ModerationDto> {
    this.assertAdmin(userId);

    const [types, requests] = await Promise.all([
      this.activityTypes.find({
        relations: { group: true },
        order: { id: 'DESC' },
      }),
      this.activityRequests.find({
        relations: { user: true },
        order: { id: 'DESC' },
      }),
    ]);

    return {
      types: types.map((type) => ({
        id: type.id,
        label: type.label,
        icon: type.icon,
        groupCode: type.group?.code ?? '',
        groupLabel: type.group?.label ?? '',
        isActive: type.isActive,
        requestedBy: null,
      })),
      requests: requests.map((request) =>
        ActivityRequestDto.from(request, request.user?.displayName ?? null),
      ),
    };
  }

  /** Решение по заявке: одобрить, отклонить или вернуть на доработку. */
  async decideRequest(
    userId: string,
    id: string,
    status: ActivityRequestStatus,
    comment?: string | null,
  ): Promise<ActivityRequestDto> {
    this.assertAdmin(userId);

    const request = await this.activityRequests.findOne({ where: { id } });
    if (!request) {
      throw new NotFoundException('Заявка не найдена');
    }

    request.status = status;
    request.adminComment = comment ?? null;
    const saved = await this.activityRequests.save(request);
    return ActivityRequestDto.from(saved);
  }

  /** Показать тип пользователям или убрать обратно на рассмотрение. */
  async setTypeActive(
    userId: string,
    typeId: number,
    isActive: boolean,
  ): Promise<ActivityTypeDto> {
    this.assertAdmin(userId);

    const type = await this.activityTypes.findOne({ where: { id: typeId } });
    if (!type) {
      throw new NotFoundException('Тип не найден');
    }

    type.isActive = isActive;
    const saved = await this.activityTypes.save(type);
    return ActivityTypeDto.from(saved);
  }

  private assertAdmin(userId: string): void {
    if (!isAdminUser(userId)) {
      throw new ForbiddenException('Раздел только для администратора');
    }
  }

  /**
   * Отметить активность на дне.
   *
   * День должен существовать: отметки живут в днях персонального календаря,
   * а он заполняется на год целиком. Иначе появились бы «висячие» отметки
   * в годах, которых у пользователя нет.
   */
  async addActivity(
    userId: string,
    dto: ToggleActivityDto,
  ): Promise<{ active: boolean }> {
    if (!isRealDate(dto.date)) {
      throw new BadRequestException('Некорректная дата');
    }

    const type = await this.activityTypes.findOne({
      where: { id: dto.activityTypeId, isActive: true },
    });
    if (!type) {
      throw new NotFoundException('Активность не найдена');
    }

    await this.assertDayExists(userId, dto.date);

    // Повторная отметка — не ошибка: пользователь мог дважды нажать.
    await this.activities
      .createQueryBuilder()
      .insert()
      .values({ userId, date: dto.date, activityTypeId: dto.activityTypeId })
      .orIgnore()
      .execute();

    await this.bumpFavorite(userId, dto.activityTypeId, 1);
    return { active: true };
  }

  /** Снять отметку. Счёт избранного уменьшаем, только если отметка была. */
  async removeActivity(
    userId: string,
    dto: ToggleActivityDto,
  ): Promise<{ active: boolean }> {
    if (!isRealDate(dto.date)) {
      throw new BadRequestException('Некорректная дата');
    }

    const result = await this.activities.delete({
      userId,
      date: dto.date,
      activityTypeId: dto.activityTypeId,
    });

    if (result.affected) {
      await this.bumpFavorite(userId, dto.activityTypeId, -1);
    }

    return { active: false };
  }

  /** Отметки диапазона дат: `{ '2026-10-07': [1, 4] }`. */
  async getActivitiesByDates(
    userId: string,
    from: string,
    to: string,
  ): Promise<Record<string, number[]>> {
    const rows = await this.activities.find({
      where: { userId, date: Between(from, to) },
    });

    const byDate: Record<string, number[]> = {};
    for (const row of rows) {
      const list = byDate[row.date] ?? [];
      list.push(row.activityTypeId);
      byDate[row.date] = list;
    }
    return byDate;
  }

  /**
   * Заметки дня.
   *
   * Оба поля одним сохранением: пользователь пишет две заметки и жмёт
   * «Сохранить» один раз. `undefined` — «не трогать», `null` — очистить.
   */
  async saveNotes(userId: string, dto: DayNotesDto): Promise<CalendarDayDto> {
    if (!isRealDate(dto.date)) {
      throw new BadRequestException('Некорректная дата');
    }
    if (dto.notePublic === undefined && dto.notePersonal === undefined) {
      throw new BadRequestException('Нечего сохранять: заметки не переданы');
    }

    const day = await this.assertDayExists(userId, dto.date);

    if (dto.notePublic !== undefined) {
      day.notePublic = dto.notePublic;
    }
    if (dto.notePersonal !== undefined) {
      day.notePersonal = dto.notePersonal;
    }

    await this.days.save(day);
    return CalendarDayDto.from(day);
  }

  /**
   * Запрос на новую активность.
   *
   * Пользователь просит у системы, а не создаёт личное: одобренная иконка
   * станет доступна всем. Поэтому здесь только строка в очереди — тип
   * появится после решения админа.
   */
  async createActivityRequest(
    userId: string,
    dto: CreateActivityRequestDto,
  ): Promise<ActivityRequestDto> {
    const label = dto.label.trim();
    if (label.length === 0) {
      throw new BadRequestException('Название не может быть пустым');
    }

    const request = this.activityRequests.create({ userId, label });
    const saved = await this.activityRequests.save(request);
    return ActivityRequestDto.from(saved);
  }

  /** День должен существовать: иначе отметка повисла бы вне календаря. */
  private async assertDayExists(
    userId: string,
    date: string,
  ): Promise<CalendarDay> {
    const day = await this.days.findOne({ where: { userId, date } });
    if (!day) {
      throw new ConflictException(
        'Календарь на этот год ещё не создан — сначала создайте его',
      );
    }
    return day;
  }

  /**
   * Счётчик избранного.
   *
   * Отметил — плюс, снял — минус: закладка «Избранное» отражает привычку,
   * а не текущее состояние дней. Ниже нуля не уходит (GREATEST), иначе
   * после серии отмен активность уехала бы в конец списка навсегда.
   */
  private async bumpFavorite(
    userId: string,
    activityTypeId: number,
    delta: number,
  ): Promise<void> {
    await this.favorites.query(
      `INSERT INTO calendar_activity_favorites (user_id, activity_type_id, usage_count)
       VALUES ($1, $2, GREATEST($3, 0))
       ON CONFLICT (user_id, activity_type_id) DO UPDATE
         SET usage_count = GREATEST(calendar_activity_favorites.usage_count + $3, 0)`,
      [userId, activityTypeId, delta],
    );

    // Обнулившуюся строку убираем: она ничего не значит, а в сортировке
    // избранного мусорит. Фильтр при чтении всё равно есть — на случай,
    // если удаление когда-нибудь отвалится.
    if (delta < 0) {
      await this.favorites.query(
        `DELETE FROM calendar_activity_favorites
          WHERE user_id = $1 AND activity_type_id = $2 AND usage_count <= 0`,
        [userId, activityTypeId],
      );
    }
  }
}
