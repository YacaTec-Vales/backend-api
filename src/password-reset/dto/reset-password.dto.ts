import { IsString, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  @MinLength(16)
  @MaxLength(255)
  token: string;

  @IsString()
  @MinLength(8)
  @MaxLength(255)
  newPassword: string;
}
