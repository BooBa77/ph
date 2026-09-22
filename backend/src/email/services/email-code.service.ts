import { Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'crypto';

/**
 * Данные о коде подтверждения для одного email.
 */
interface CodeData {
  /** Четырёхзначный код */
  code: string;
  /** Время истечения (timestamp, мс) */
  expiresAt: number;
  /** Сколько неверных попыток уже было */
  attempts: number;
  /** Время, до которого новый код запрашивать нельзя (timestamp, мс) */
  resendAfter: number;
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
 * ## Защита от подбора
 * - 2 неверные попытки → код сгорает, надо запрашивать новый.
 *
 * ## Защита от спама
 * - Повторный запрос кода — не чаще раза в 60 секунд.
 */
@Injectable()
export class EmailCodeService {
  private readonly logger = new Logger(EmailCodeService.name);

  private readonly codes = new Map<string, CodeData>();

  /** Время жизни кода (5 минут) */
  private readonly CODE_TTL_MS = 5 * 60 * 1000;

  /** Cooldown между запросами кода (60 секунд) */
  private readonly RESEND_COOLDOWN_MS = 60 * 1000;

  /** Максимум неверных попыток */
  private readonly MAX_ATTEMPTS = 2;

  private generateCode(): string {
    return randomInt(1000, 10000).toString();
  }

  /**
   * Создать новый код для email.
   * Если активный код уже есть и cooldown не прошёл — бросает ошибку.
   */
  createCode(email: string): string {
    const normalizedEmail = this.normalize(email);
    const now = Date.now();

    const existing = this.codes.get(normalizedEmail);
    if (existing && existing.resendAfter > now) {
      const remaining = Math.ceil((existing.resendAfter - now) / 1000);
      this.logger.warn(
        `Повторный запрос кода для ${normalizedEmail} через ${remaining}с`,
      );
      throw new Error(
        `Код уже отправлен. Повторите через ${remaining} секунд`,
      );
    }

    const code = this.generateCode();
    const expiresAt = now + this.CODE_TTL_MS;
    const resendAfter = now + this.RESEND_COOLDOWN_MS;

    this.codes.set(normalizedEmail, {
      code,
      expiresAt,
      attempts: 0,
      resendAfter,
    });

    this.logger.log(`Создан код для ${normalizedEmail}, истекает через 5 минут`);
    return code;
  }

  /**
   * Проверить код для email.
   * При успехе код удаляется.
   * При неверном коде — увеличивает счётчик попыток.
   * Если попытки исчерпаны — код сгорает.
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

    if (data.code === code) {
      this.logger.log(`Код для ${normalizedEmail} подтверждён`);
      this.codes.delete(normalizedEmail);
      return true;
    }

    data.attempts += 1;
    const remaining = this.MAX_ATTEMPTS - data.attempts;

    if (remaining <= 0) {
      this.logger.warn(
        `Код для ${normalizedEmail} сгорел: исчерпаны попытки`,
      );
      this.codes.delete(normalizedEmail);
    } else {
      this.logger.warn(
        `Неверный код для ${normalizedEmail}, осталось попыток: ${remaining}`,
      );
    }

    return false;
  }

  /**
   * Сколько секунд до возможности запросить новый код.
   */
  getResendCooldownSeconds(email: string): number {
    const normalizedEmail = this.normalize(email);
    const data = this.codes.get(normalizedEmail);

    if (!data) return 0;

    const remaining = Math.ceil((data.resendAfter - Date.now()) / 1000);
    return remaining > 0 ? remaining : 0;
  }

  private normalize(email: string): string {
    return email.toLowerCase().trim();
  }
}