import { IsOptional, IsString, MinLength } from 'class-validator';

export class InvalidateUserSessionsDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  reason?: string;

  @IsOptional()
  notifyUser?: boolean;
}
