import { IsEmail, MaxLength } from 'class-validator';

export class RequestCodeDto {
  @IsEmail({}, { message: 'Некорректный email' })
  @MaxLength(255)
  email: string;
}