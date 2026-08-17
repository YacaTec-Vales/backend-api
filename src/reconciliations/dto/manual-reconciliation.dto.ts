import { IsUUID, IsNotEmpty } from 'class-validator';

export class ManualReconciliationDto {
  @IsUUID('all', { message: 'El ID del movimiento debe ser un UUID válido.' })
  @IsNotEmpty({ message: 'El ID del movimiento es obligatorio.' })
  bankMovementId: string;

  @IsUUID('all', { message: 'El ID de la relación debe ser un UUID válido.' })
  @IsNotEmpty({ message: 'El ID de la relación es obligatorio.' })
  relationId: string;

  @IsUUID('all', { message: 'El ID de autorización debe ser un UUID válido.' })
  @IsNotEmpty({ message: 'El ID de autorización es obligatorio.' })
  authorizationId: string;
}
