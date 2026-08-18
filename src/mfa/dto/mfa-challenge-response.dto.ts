/**
 * @fileoverview DTO de respuesta cuando el login requiere MFA.
 *
 * Cuando un usuario con MFA habilitado inicia sesion, en lugar de
 * devolver `TokenResponseDto`, el sistema devuelve este DTO con un
 * JWT parcial de corta vida (5 min) que el frontend debe presentar
 * en `POST /auth/mfa-verify` junto con el codigo TOTP.
 *
 * @module mfa/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { ApiProperty } from '@nestjs/swagger';

/**
 * Respuesta de challenge MFA. El frontend detecta `mfaRequired: true`
 * y redirige al flujo de verificacion MFA.
 */
export class MfaChallengeResponseDto {
  /** Siempre `true`. Permite al frontend distinguir del `TokenResponseDto`. */
  @ApiProperty({
    description:
      'Indica que se requiere verificacion MFA para completar el login.',
    example: true,
  })
  mfaRequired: true;

  /** JWT parcial con claim `mfaPending: true`. TTL corto (5 min). */
  @ApiProperty({
    description:
      'JWT parcial con claim mfaPending. Usar en POST /auth/mfa-verify.',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  mfaToken: string;

  /** TTL del `mfaToken` en segundos. */
  @ApiProperty({
    description: 'Tiempo de vida del mfaToken en segundos.',
    example: 300,
  })
  mfaTokenExpiresIn: number;
}
