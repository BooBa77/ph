import {
  BadRequestException,
  Injectable,
  Logger,
  PayloadTooLargeException,
} from '@nestjs/common';
import sharp from 'sharp';
import { StorageService } from '../storage/storage.service';
import { UsersService } from './users.service';
import type { User } from './entities/user.entity';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  AVATAR_SIZE,
  AVATAR_WEBP_QUALITY,
  MAX_INPUT_PIXELS,
  MAX_UPLOAD_BYTES,
} from '../config/uploads.config';

/**
 * Понятные человеку названия форматов — для сообщения об ошибке.
 * `image/gif` пользователю ни о чём не говорит, «GIF» говорит.
 */
const FORMAT_TITLES: Record<string, string> = {
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
  'image/gif': 'GIF',
  'image/svg+xml': 'SVG',
  'image/avif': 'AVIF',
  'image/heic': 'HEIC',
  'image/heif': 'HEIF',
  'image/tiff': 'TIFF',
  'image/bmp': 'BMP',
};

const ALLOWED_TITLES = ALLOWED_IMAGE_MIME_TYPES.map(
  (mime) => FORMAT_TITLES[mime] ?? mime,
).join(', ');

/**
 * Аватарки: загрузка, обработка, сброс.
 *
 * Отдельный сервис от UsersService, потому что здесь своя предметная
 * область — файлы, sharp, порядок операций с диском и базой. UsersService
 * при этом остаётся тем, что он есть: работа с профилем в базе.
 */
@Injectable()
export class AvatarService {
  private readonly logger = new Logger(AvatarService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Загрузить аватарку.
   *
   * Порядок операций важен и выбран так, чтобы худший исход был
   * «потеряли новый файл», а не «потеряли старую аватарку»:
   *
   *   1. привести картинку к 150×150 WebP;
   *   2. записать новый файл на диск;
   *   3. обновить `users.avatar_url`;
   *   4. удалить старый файл.
   *
   * Если падает шаг 2 — в базе и на диске всё по-старому.
   * Если падает шаг 3 — удаляем новый файл, старая аватарка цела.
   * Если падает шаг 4 — аватарка уже новая, а на диске остался мусор;
   *   пользователь этого не заметит, поэтому в ответе не отказываем,
   *   только пишем в лог. Порядок «сначала удалить старый, потом
   *   записать новый» дал бы более неприятный сбой: пользователь
   *   остался бы вообще без аватарки.
   */
  async upload(userId: string, file: Express.Multer.File): Promise<User> {
    this.validateFile(file);

    const processed = await this.processImage(file.buffer);

    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new BadRequestException('Пользователь не найден');
    }

    const previousUrl = user.avatarUrl;
    const saved = await this.storage.saveAvatar(userId, processed);

    let updated: User | null;
    try {
      updated = await this.usersService.setAvatarUrl(userId, saved.url);
    } catch (e) {
      // Запись в базу не прошла — подчищаем за собой новый файл,
      // чтобы он не остался сиротой. Ошибку удаления глотаем: главная
      // причина сбоя важнее для ответа, чем судьба мусора.
      await this.storage.deleteAvatarByUrl(userId, saved.url).catch(() => {});
      throw e;
    }

    if (!updated) {
      await this.storage.deleteAvatarByUrl(userId, saved.url).catch(() => {});
      throw new BadRequestException('Пользователь не найден');
    }

    // Аватарка уже новая — с этого места ошибки не должны ломать ответ.
    if (previousUrl) {
      await this.removeOldFile(userId, previousUrl);
    }

    return updated;
  }

  /**
   * Сбросить аватарку: `avatar_url = null` и удалить файл.
   *
   * Порядок обратный загрузке: сначала чистим базу, потом диск. Если
   * файл не удалится, в базе уже null — пользователь аватарку не увидит,
   * а мусор подчистит cron, если он когда-нибудь понадобится.
   */
  async reset(userId: string): Promise<User> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new BadRequestException('Пользователь не найден');
    }

    const previousUrl = user.avatarUrl;

    const updated = await this.usersService.setAvatarUrl(userId, null);
    if (!updated) {
      throw new BadRequestException('Пользователь не найден');
    }

    if (previousUrl) {
      await this.removeOldFile(userId, previousUrl);
    }

    return updated;
  }

  // ─── private ───

  /**
   * Проверить файл до того, как трогать диск и базу.
   *
   * Проверки три: файл вообще пришёл, он не больше лимита, и его
   * заявленный тип — из белого списка. Про SVG отдельно: в белом списке
   * его нет, потому что SVG — это XML, который умеет носить в себе
   * скрипты и внешние ссылки, а файлы мы отдаём с того же origin, что
   * и приложение. Даже если sharp его и отрендерит, принимать SVG нельзя.
   */
  private validateFile(file: Express.Multer.File | undefined): void {
    if (!file || !file.buffer) {
      throw new BadRequestException('Файл не передан');
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      const megabytes = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));
      throw new PayloadTooLargeException(
        `Файл больше ${megabytes} МБ. Выберите картинку поменьше.`,
      );
    }

    const allowed = ALLOWED_IMAGE_MIME_TYPES as readonly string[];
    if (!allowed.includes(file.mimetype)) {
      const title = FORMAT_TITLES[file.mimetype] ?? file.mimetype;
      throw new BadRequestException(
        `Формат ${title} не поддерживается. Допустимы ${ALLOWED_TITLES}.`,
      );
    }
  }

  /**
   * Привести картинку к квадрату 150×150 в WebP.
   *
   * `fit: cover` с `position: centre` — то же самое, что делает фронт
   * при кропе, но на случай, если пришёл не квадрат: лучше обрезать
   * по центру, чем отказать в загрузке.
   *
   * `rotate()` без аргументов применяет EXIF-ориентацию. Без него
   * вертикальные фото с телефона лягут на бок: sharp ориентацию
   * не применяет сам, а метаданные при конвертации в WebP теряются.
   *
   * `.withMetadata()` не вызываем намеренно: EXIF с координатами
   * съёмки и моделью камеры наружу отдавать незачем.
   */
  private async processImage(buffer: Buffer): Promise<Buffer> {
    try {
      return await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .resize(AVATAR_SIZE, AVATAR_SIZE, {
          fit: 'cover',
          position: 'centre',
        })
        .webp({ quality: AVATAR_WEBP_QUALITY })
        .toBuffer();
    } catch {
      // sharp падает на битом файле, на формате, который не умеет
      // декодировать, и на картинке больше limitInputPixels. Все три
      // случая для пользователя — «файл не подошёл», то есть 400.
      // Настоящее сообщение sharp в ответ не отдаём: оно на английском
      // и говорит о внутренностях libvips.
      throw new BadRequestException(
        `Не удалось прочитать изображение. Допустимы ${ALLOWED_TITLES}.`,
      );
    }
  }

  /**
   * Удалить прежний файл аватарки.
   *
   * Ошибка сюда не пробрасывается: аватарка к этому моменту уже
   * обновлена, и превращать успех в 500 из-за неубранного мусора
   * неправильно. Но и молчать нельзя — иначе о проблеме узнаем
   * по распухшему тому.
   */
  private async removeOldFile(userId: string, url: string): Promise<void> {
    if (!this.storage.isAvatarUrl(url)) {
      // В поле лежит что-то чужое (старые данные, ручная правка в БД).
      // Такое не удаляем: неизвестно, чей это файл.
      this.logger.warn(
        `Прежнее значение avatar_url не похоже на наш файл, не удаляю: ${url}`,
      );
      return;
    }

    try {
      await this.storage.deleteAvatarByUrl(userId, url);
    } catch (e) {
      this.logger.error(
        `Не удалось удалить прежнюю аватарку ${url}: ${String(e)}`,
      );
    }
  }
}
