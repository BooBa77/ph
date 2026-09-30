import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, MaxLength } from 'class-validator';

export class RequestCodeDto {
  @ApiProperty({
    description: 'Email, на который отправить код подтверждения',
    example: 'user@example.com',
    maxLength: 255,
  })
  @IsEmail({}, { message: 'Некорректный email' })
  @MaxLength(255)
  email: string;
}