import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import emailConfig from './email.config';
import { SmtpService } from './services/smtp.service';
import { EmailCodeService } from './services/email-code.service';

/**
 * Модуль для работы с email.
 *
 * Экспортирует:
 * - SmtpService — отправка писем (или логирование в dev-режиме).
 * - EmailCodeService — генерация/проверка кодов подтверждения.
 */
@Module({
  imports: [ConfigModule.forFeature(emailConfig)],
  providers: [SmtpService, EmailCodeService],
  exports: [SmtpService, EmailCodeService],
})
export class EmailModule {}