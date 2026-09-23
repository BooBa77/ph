import { SetMetadata } from '@nestjs/common';

/**
 * Метаданные, по которым JwtAuthGuard понимает,
 * что роут публичный (не требует access-токена).
 */
export const IS_PUBLIC_KEY = 'isPublic';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);