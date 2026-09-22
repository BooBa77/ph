import { IsEmail, IsString, Length, MaxLength } from 'class-validator';

export class VerifyCodeDto {
  @IsEmail({}, { message: 'Некорректный email' })
  @MaxLength(255)
  email: string;

  @IsString()
  @Length(4, 4, { message: 'Код должен состоять из 4 цифр' })
  code: string;
}