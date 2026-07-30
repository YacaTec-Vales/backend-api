import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class LoginDto {
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  usernameOrEmail: string;

  @IsString()
  @MinLength(8)
  @MaxLength(255)
  password: string;

  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}
