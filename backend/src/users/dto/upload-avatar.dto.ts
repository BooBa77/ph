import { ApiProperty } from '@nestjs/swagger';

/**
 * Тело POST /api/users/me/avatar — multipart/form-data с одним файлом.
 *
 * Класс нужен только для Swagger: Nest его не валидирует (ValidationPipe
 * работает с JSON-телом, а здесь multipart). Всё, что касается файла,
 * проверяют multer и AvatarService.
 */
export class UploadAvatarDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description:
      'Картинка аватарки. Допустимы JPEG, PNG и WebP, до 10 МБ. ' +
      'Квадрат выделяет клиент, но сервер всё равно обрежет по центру ' +
      'и приведёт к 150×150 WebP.',
  })
  file: unknown;
}
