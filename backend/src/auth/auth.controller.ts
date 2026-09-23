import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { Public } from './decorators/public.decorator';
import { AuthService } from './auth.service';
import { RequestCodeDto } from './dto/request-code.dto';
import { VerifyCodeDto } from './dto/verify-code.dto';

const REFRESH_COOKIE = 'refresh_token';

@Public()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('request-code')
  @HttpCode(HttpStatus.OK)
  async requestCode(@Body() dto: RequestCodeDto) {
    return this.authService.requestCode(dto.email);
  }

  @Post('verify-code')
  @HttpCode(HttpStatus.OK)
  async verifyCode(
    @Body() dto: VerifyCodeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.verifyCode(
      dto.email,
      dto.code,
      req.headers['user-agent'],
    );

    this.setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt);

    return {
      accessToken: result.accessToken,
      user: result.user,
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.[REFRESH_COOKIE];
    if (!refreshToken) {
      res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
      return { accessToken: null };
    }

    const result = await this.authService.refresh(refreshToken);
    this.setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt);

    return {
      accessToken: result.accessToken,
      user: result.user,
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.[REFRESH_COOKIE];
    if (refreshToken) {
      await this.authService.logout(refreshToken);
    }
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
  }

  private setRefreshCookie(res: Response, token: string, expiresAt: Date) {
    res.cookie(REFRESH_COOKIE, token, {
      ...this.cookieOptions(),
      expires: expiresAt,
    });
  }

  private cookieOptions() {
    return {
      httpOnly: true,
      secure: this.config.get('COOKIE_SECURE') === 'true',
      sameSite: 'lax' as const,
      path: '/api/auth',
    };
  }
}