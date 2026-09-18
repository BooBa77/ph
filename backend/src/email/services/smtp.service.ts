import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

/**
 * Сервис отправки email через SMTP.
 *
 * В dev-режиме (email.devMode === true) письма не отправляются,
 * а выводятся в лог. Это позволяет разрабатывать без настроенного
 * SMTP-ящика и без риска отправить письмо реальному пользователю.
 */
@Injectable()
export class SmtpService {
  private readonly logger = new Logger(SmtpService.name);
  private readonly transporter: Transporter | null;
  private readonly devMode: boolean;

  constructor(private readonly configService: ConfigService) {
    this.devMode = this.configService.get<boolean>('email.devMode') === true;

    if (this.devMode) {
      this.logger.warn(
        'SMTP в dev-режиме: письма логируются, но не отправляются',
      );
      this.transporter = null;
    } else {
      this.transporter = nodemailer.createTransport({
        host: this.configService.get<string>('email.smtp.host'),
        port: this.configService.get<number>('email.smtp.port'),
        secure: this.configService.get<boolean>('email.smtp.secure'),
        auth: {
          user: this.configService.get<string>('email.smtp.user'),
          pass: this.configService.get<string>('email.smtp.password'),
        },
      });
    }
  }

  /**
   * Отправить письмо.
   *
   * @param to      — адрес получателя
   * @param subject — тема письма
   * @param text    — тело письма (plain text)
   * @throws Error если отправка не удалась (в prod-режиме)
   */
  async sendEmail(to: string, subject: string, text: string): Promise<void> {
    const from = this.configService.get<string>('email.smtp.from')!;

    // Dev-режим: логируем и выходим
    if (this.devMode) {
      this.logger.log(
        `[DEV] Письмо не отправлено. To: ${to}, Subject: "${subject}", Text: "${text}"`,
      );
      return;
    }

    try {
      const result = await this.transporter!.sendMail({
        from,
        to,
        subject,
        text,
      });
      this.logger.log(`Письмо отправлено на ${to}, messageId: ${result.messageId}`);
    } catch (error) {
      this.logger.error(
        `Ошибка отправки письма на ${to}: ${error instanceof Error ? error.message : error}`,
      );
      throw new Error('Ошибка отправки письма');
    }
  }
}