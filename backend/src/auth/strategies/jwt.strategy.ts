import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthUser } from '../decorators/current-user.decorator';

interface JwtPayload {
  sub: string;
}

/**
 * Стратегия проверки access-токена.
 *
 * Работает «тонко»: только проверяет подпись JWT (это делает passport-jwt)
 * и возвращает { id } из payload. В БД не ходит — это не её задача.
 *
 * Если роуту нужен полный User — контроллер сам достанет через UsersService.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    const secret = config.get<string>('JWT_ACCESS_SECRET');
    if (!secret) {
      throw new Error('JWT_ACCESS_SECRET не задан');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    return { id: payload.sub };
  }
}