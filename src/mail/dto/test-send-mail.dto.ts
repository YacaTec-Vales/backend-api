/**
 * @fileoverview DTO para `POST /mail/admin/test-send`.
 *
 * Body de entrada del endpoint admin que permite a QA/operacion
 * enviar una plantilla arbitraria a un email concreto para
 * validar el render y la conexion SMTP. NO usa el dispatcher
 * (no resuelve usuarios, no escribe auditoria): es solo un
 * helper de pruebas.
 *
 * @module mail/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsObject, IsString } from 'class-validator';
import type { TemplateKey } from '../templates/manifest';

/**
 * Slugs de plantilla aceptados por el endpoint admin. Es
 * `TemplateKey` re-exportado para que `class-validator` valide
 * contra el union literal (si el slug no existe, TypeScript
 * falla en compilacion; ademas `@IsString` protege contra
 * payloads que no validen el union).
 */
export type TestSendMailTemplateKey = TemplateKey;

/**
 * Body de `POST /mail/admin/test-send`.
 */
export class TestSendMailDto {
  /**
   * Direccion del destinatario. No se valida que pertenezca a
   * un usuario del sistema (es un endpoint de prueba).
   */
  @ApiProperty({
    description: 'Email del destinatario de la prueba.',
    example: 'qa@yacatec.demo',
  })
  @IsEmail()
  to!: string;

  /**
   * Slug de la plantilla a renderizar. Debe ser uno de los
   * unionados en `TemplateKey`.
   */
  @ApiProperty({
    description: 'Slug de la plantilla a renderizar.',
    enum: [
      'reset-password',
      'session-revoked',
      'user-welcome',
      'user-password-reset-by-admin',
    ],
    example: 'user-welcome',
  })
  @IsString()
  templateKey!: TestSendMailTemplateKey;

  /**
   * Variables que se pasan al HBS. La estructura concreta la
   * declara cada plantilla en su JSDoc; aqui solo exigimos que
   * sea un objeto.
   */
  @ApiProperty({
    description:
      'Variables que se interpolan en la plantilla. La estructura ' +
      'la declara cada archivo .hbs en su JSDoc.',
    type: 'object',
    additionalProperties: true,
    example: {
      displayName: 'QA',
      username: 'qa.user',
      temporaryPassword: 'Tmp#1234567890Ab',
      loginUrl: 'http://localhost:3000/login',
    },
  })
  @IsObject()
  vars!: Record<string, unknown>;
}
