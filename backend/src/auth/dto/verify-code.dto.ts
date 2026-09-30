import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length, MaxLength } from 'class-validator';

export class VerifyCodeDto {
  @ApiProperty({
    description: 'Email, на который был отправлен код',
    example: 'user@example.com',
    maxLength: 255,
  })
  @IsEmail({}, { message: 'Некорректный email' })
  @MaxLength(255)
  email: string;

  @ApiProperty({
    description: 'Код подтверждения из письма (4 цифры)',
    example: '1234',
    minLength: 4,
    maxLength: 4,
  })
  @IsString()
  @Length(4, 4, { message: 'Код должен состоять из 4 цифр' })
  code: string;
}