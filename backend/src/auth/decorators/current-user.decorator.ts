import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Достаёт req.user, который положил JwtAuthGuard после проверки токена.
 * У нас req.user = { id: string }.
 */
export interface AuthUser {
  id: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);