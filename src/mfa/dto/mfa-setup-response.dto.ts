/**
 * @fileoverview DTO de respuesta para el setup inicial de MFA.
 *
 * Contiene la URI `otpauth://` para generar el codigo QR y los
 * backup codes de un solo uso. El frontend debe mostrar ambos
 * al usuario durante el proceso de activacion.
 *
 * @module mfa/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { ApiProperty } from '@nestjs/swagger';

/**
 * Respuesta del setup MFA. Solo se muestra una vez; los backup
 * codes no son recuperables despues.
 */
export class MfaSetupResponseDto {
  /** URI `otpauth://totp/...` lista para generar un QR. */
  @ApiProperty({
    description: 'URI otpauth:// para generar un codigo QR.',
    example: 'otpauth://totp/vales-yacatec:user-uuid?secret=ABCD&issuer=vales-yacatec',
  })
  otpauthUrl: string;

  /** Backup codes de un solo uso (visibles solo en este momento). */
  @ApiProperty({
    type: [String],
    description: 'Backup codes de un solo uso. Guardalos en un lugar seguro.',
    example: ['ABCD1234XY', 'EFGH5678XY'],
  })
  backupCodes: string[];
}
