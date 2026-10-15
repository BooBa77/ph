import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

import type { CalendarMode } from '../calendar.types';

/** Режимы работы: те же значения, что в CHECK на `users.calendar_mode`. */
const MODES: CalendarMode[] = ['cycle', 'free', 'study', 'parental', 'retired'];

/**
 * Тело POST /api/calendar/years/:year/init — ответ на вопрос «работаешь?».
 *
 * Режим приходит один раз, при создании календаря на год: дальше год
 * считается календарём пользователя, и мы его не перезаписываем.
 */
export class InitYearDto {
  @ApiProperty({
    description:
      'Режим: cycle — пятидневка, free — свободный график, study — учёба, parental — декрет, retired — пенсия',
    enum: MODES,
    example: 'cycle',
  })
  @IsIn(MODES, {
    message: `Режим должен быть одним из: ${MODES.join(', ')}`,
  })
  mode: CalendarMode;
}

/** Ответ: состояние календаря пользователя на год. */
export class YearStateDto {
  @ApiProperty({ description: 'Год', example: 2026 })
  year: number;

  @ApiProperty({
    description: 'Календарь на этот год уже создан',
    example: true,
  })
  filled: boolean;

  @ApiProperty({
    description:
      'Текущий режим работы пользователя. null — ещё не спрашивали. Режим один на пользователя, а не на год: заполнение прошлого года его не меняет',
    enum: MODES,
    nullable: true,
  })
  mode: CalendarMode | null;

  @ApiProperty({ description: 'Сколько дней года заполнено', example: 365 })
  filledDays: number;

  @ApiProperty({
    description:
      'Есть ли государственный производственный календарь на год. false — шаблон ещё не утверждён, при создании календаря праздники придётся расставить самому',
    example: true,
  })
  stateAvailable: boolean;

  @ApiProperty({
    description:
      'Есть ли учебный календарь на год. Важно только для режима study',
    example: true,
  })
  educationAvailable: boolean;

  static from(state: {
    year: number;
    mode: CalendarMode | null;
    filledDays: number;
    stateAvailable: boolean;
    educationAvailable: boolean;
  }): YearStateDto {
    return {
      year: state.year,
      filled: state.filledDays > 0,
      mode: state.mode,
      filledDays: state.filledDays,
      stateAvailable: state.stateAvailable,
      educationAvailable: state.educationAvailable,
    };
  }
}
