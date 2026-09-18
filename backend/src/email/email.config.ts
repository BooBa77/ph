import { registerAs } from '@nestjs/config';

/**
 * Конфигурация email-сервиса.
 *
 * В dev-режиме (NODE_ENV !== 'production') письма не отправляются,
 * а логируются. Это позволяет разрабатывать без настроенного SMTP
 * и без риска случайно отправить письмо реальному пользователю.
 */
export default registerAs('email', () => ({
  smtp: {
    host: process.env.EMAIL_SMTP_HOST || 'smtp.mail.ru',
    port: parseInt(process.env.EMAIL_SMTP_PORT || '465', 10),
    secure: process.env.EMAIL_SMTP_SECURE !== 'false',
    user: process.env.EMAIL_SMTP_USER || '',
    password: process.env.EMAIL_SMTP_PASSWORD || '',
    from: process.env.EMAIL_SMTP_FROM || '"PeakHunter" <peakhunter@mail.ru>',
  },
  /**
   * Если true — письма логируются, но не отправляются.
   * Управляется через NODE_ENV, можно переопределить переменной EMAIL_DEV_MODE.
   */
  devMode:
    process.env.EMAIL_DEV_MODE === 'true' ||
    process.env.NODE_ENV !== 'production',
}));