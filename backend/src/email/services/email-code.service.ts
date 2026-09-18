import { Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'crypto';

/**
 * Данные о коде подтверждения для одного email.
 */
interface CodeData {
  /** Четырёхзначный код подтверждения */
  code: string;
  /** Время истечения кода (timestamp, мс) */
  expiresAt: number;
}

/**
 * Сервис для генерации и хранения кодов подтверждения email.
 *
 * ## Назначение
 * Хранит коды в оперативной памяти (Map).
 * При перезапуске сервера все коды сбрасываются.
 *
 * ## Формат кода
 * Четырёхзначное число (1000–9999).
 *
 * ## Время жизни
 * 5 минут.
 *
 * ## Ограничения
 * - Один email может иметь только один активный код.
 * - Новый код можно запросить только после истечения старого.
 * - Нет rate-limit на попытки ввода (TODO: добавить при необходимости).
 */
@Injectable()
export class EmailCodeService {
  private readonly logger = new Logger(EmailCodeService.name);

  /** Хранилище кодов: email -> данные кода */
  private readonly codes = new Map<string, CodeData>();

  /** Время жизни кода в миллисекундах (5 минут) */
  private readonly CODE_TTL_MS = 5 * 60 * 1000;

  /**
   * Сгенерировать случайный четырёхзначный код.
   * Использует crypto.randomInt — криптографически стойкий ГПСЧ.
   */
  private generateCode(): string {
    return randomInt(1000, 10000).toString();
  }

  /**
   * Создать новый код для email.
   *
   * @throws Error если для этого email уже есть активный код
   */
  createCode(email: string): string {
    const normalizedEmail = this.normalize(email);

    const existing = this.codes.get(normalizedEmail);
    if (existing && existing.expiresAt > Date.now()) {
      const remaining = Math.ceil((existing.expiresAt - Date.now()) / 1000);
      this.logger.warn(
        `Попытка создать новый код для ${normalizedEmail}, активный код истечёт через ${remaining}с`,
      );
      throw new Error(
        `Код уже отправлен. Подождите ${Math.ceil(remaining / 60)} минут(ы)`,
      );
    }

    const code = this.generateCode();
    const expiresAt = Date.now() + this.CODE_TTL_MS;

    this.codes.set(normalizedEmail, { code, expiresAt });
    this.logger.log(`Создан код для ${normalizedEmail}, истекает через 5 минут`);

    return code;
  }

  /**
   * Проверить код для email. При успехе код удаляется.
   */
  verifyCode(email: string, code: string): boolean {
    const normalizedEmail = this.normalize(email);
    const data = this.codes.get(normalizedEmail);

    if (!data) {
      this.logger.warn(`Проверка кода для ${normalizedEmail}: код не найден`);
      return false;
    }

    if (data.expiresAt < Date.now()) {
      this.logger.warn(`Проверка кода для ${normalizedEmail}: код истёк`);
      this.codes.delete(normalizedEmail);
      return false;
    }

    const isValid = data.code === code;

    if (isValid) {
      this.logger.log(`Код для ${normalizedEmail} подтверждён`);
      this.codes.delete(normalizedEmail);
    } else {
      this.logger.warn(`Неверный код для ${normalizedEmail}`);
    }

    return isValid;
  }

  /**
   * Активен ли код для email (не истёк).
   */
  hasActiveCode(email: string): boolean {
    const normalizedEmail = this.normalize(email);
    const data = this.codes.get(normalizedEmail);

    if (!data) return false;

    if (data.expiresAt < Date.now()) {
      this.codes.delete(normalizedEmail);
      return false;
    }
    return true;
  }

  /**
   * Удалить код принудительно (например, при ошибке отправки письма).
   */
  deleteCode(email: string): void {
    const normalizedEmail = this.normalize(email);
    this.codes.delete(normalizedEmail);
    this.logger.log(`Код для ${normalizedEmail} удалён`);
  }

  /**
   * Сколько секунд осталось до истечения кода.
   */
  getRemainingSeconds(email: string): number {
    const normalizedEmail = this.normalize(email);
    const data = this.codes.get(normalizedEmail);

    if (!data) return 0;

    const remaining = Math.ceil((data.expiresAt - Date.now()) / 1000);
    return remaining > 0 ? remaining : 0;
  }

  /**
   * Привести email к нижнему регистру и убрать пробелы.
   */
  private normalize(email: string): string {
    return email.toLowerCase().trim();
  }
}