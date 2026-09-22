import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UAParser } from 'ua-parser-js';

import { AuthIdentity } from './entities/auth-identity.entity';
import { Session } from './entities/session.entity';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { EmailCodeService } from '../email/services/email-code.service';
import { SmtpService } from '../email/services/smtp.service';

export interface RequestCodeResult {
  message: string;
  resendAfterSeconds: number;
}

export interface AuthUserPayload {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface VerifyCodeResult {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: AuthUserPayload;
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: AuthUserPayload;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(AuthIdentity)
    private readonly identityRepo: Repository<AuthIdentity>,
    @InjectRepository(Session)
    private readonly sessionRepo: Repository<Session>,
    private readonly usersService: UsersService,
    private readonly emailCodeService: EmailCodeService,
    private readonly smtpService: SmtpService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Шаг 1: запросить код на email.
   * БД не проверяем вообще — защита от энумерации email.
   */
  async requestCode(rawEmail: string): Promise<RequestCodeResult> {
    const email = this.normalizeEmail(rawEmail);

    let code: string;
    try {
      code = this.emailCodeService.createCode(email);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }

    await this.smtpService.sendEmail(
      email,
      'Код подтверждения PeakHunter',
      `Ваш код подтверждения: ${code}\n\nКод действует 5 минут.`,
    );

    return {
      message: 'Код отправлен на указанный email',
      resendAfterSeconds: 60,
    };
  }

  /**
   * Шаг 2: проверить код и выдать токены.
   * Если пользователя нет — создаём User + AuthIdentity в транзакции.
   * Если есть и deleted_at IS NOT NULL — снимаем deleted_at (реанимация).
   */
  async verifyCode(
    rawEmail: string,
    code: string,
    userAgent: string | undefined,
  ): Promise<VerifyCodeResult> {
    const email = this.normalizeEmail(rawEmail);

    const isValid = this.emailCodeService.verifyCode(email, code);
    if (!isValid) {
      throw new UnauthorizedException('Неверный или истёкший код');
    }

    const identity = await this.identityRepo.findOne({
      where: { provider: 'email', providerUserId: email },
      relations: { user: true },
    });

    let user: User;

    if (!identity) {
      user = await this.dataSource.transaction(async (manager) => {
        const newUser = await this.usersService.create(
          {
            displayName: this.displayNameFromEmail(email),
          },
          manager,
        );

        const newIdentity = manager.create(AuthIdentity, {
          userId: newUser.id,
          provider: 'email',
          providerUserId: email,
        });
        await manager.save(newIdentity);

        return newUser;
      });

      this.logger.log(`Зарегистрирован новый пользователь: ${email}`);
    } else {
      user = identity.user;

      if (user.deletedAt) {
        await this.usersService.clearDeletedAt(user.id);
        user.deletedAt = null;
        this.logger.log(`Реанимация пользователя: ${email}`);
      }
    }

    const refreshToken = this.generateRefreshToken();
    const refreshTokenHash = this.hashRefreshToken(refreshToken);
    const refreshExpiresAt = this.getRefreshExpiry();

    const session = this.sessionRepo.create({
      userId: user.id,
      deviceLabel: this.parseDeviceLabel(userAgent),
      refreshTokenHash,
      expiresAt: refreshExpiresAt,
      revokedAt: null,
    });
    await this.sessionRepo.save(session);

    const accessToken = await this.jwtService.signAsync({ sub: user.id });

    return {
      accessToken,
      refreshToken,
      refreshExpiresAt,
      user: {
        id: user.id,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
      },
    };
  }

  /**
   * Обновить access по refresh.
   * Ротация refresh + продление expires_at.
   */
  async refresh(rawRefreshToken: string): Promise<RefreshResult> {
    const hash = this.hashRefreshToken(rawRefreshToken);

    const session = await this.sessionRepo.findOne({
      where: { refreshTokenHash: hash },
      relations: { user: true },
    });

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Сессия истекла или отозвана');
    }

    const newRefreshToken = this.generateRefreshToken();
    session.refreshTokenHash = this.hashRefreshToken(newRefreshToken);
    session.expiresAt = this.getRefreshExpiry();
    await this.sessionRepo.save(session);

    const accessToken = await this.jwtService.signAsync({ sub: session.userId });

    return {
      accessToken,
      refreshToken: newRefreshToken,
      refreshExpiresAt: session.expiresAt,
      user: {
        id: session.user.id,
        displayName: session.user.displayName,
        avatarUrl: session.user.avatarUrl,
      },
    };
  }

  /**
   * Отозвать сессию.
   */
  async logout(rawRefreshToken: string): Promise<void> {
    const hash = this.hashRefreshToken(rawRefreshToken);
    const session = await this.sessionRepo.findOne({
      where: { refreshTokenHash: hash },
    });

    if (!session) return;

    session.revokedAt = new Date();
    await this.sessionRepo.save(session);
  }

  // ─── helpers ───

  private normalizeEmail(email: string): string {
    return email.toLowerCase().trim();
  }

  private displayNameFromEmail(email: string): string {
    const localPart = email.split('@')[0] ?? email;
    return localPart.slice(0, 50);
  }

  private generateRefreshToken(): string {
    return randomBytes(48).toString('base64url');
  }

  private hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private getRefreshExpiry(): Date {
    const days = Number(this.config.get('REFRESH_EXPIRES_DAYS') ?? 180);
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  private parseDeviceLabel(userAgent: string | undefined): string | null {
    if (!userAgent) return null;
    const parsed = UAParser(userAgent);
    const browser = parsed.browser.name ?? 'Unknown browser';
    const os = parsed.os.name ?? 'Unknown OS';
    return `${browser} on ${os}`.slice(0, 100);
  }
}