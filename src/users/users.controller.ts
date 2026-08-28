/**
 * @fileoverview Controlador del modulo `users`.
 *
 * Endpoints (prefijo global `api/v1`):
 *  - `GET    /users`                 listar paginado.
 *  - `GET    /users/:id`             detalle.
 *  - `POST   /users`                 alta administrativa.
 *  - `PATCH  /users/:id`             edicion.
 *  - `DELETE /users/:id`             soft delete.
 *  - `POST   /users/:id/reset-password`    reset por admin.
 *  - `POST   /users/:id/invalidate-sessions` invalidar sesiones.
 *  - `GET    /users/:id/permissions` detalle de permisos.
 *  - `POST   /users/:id/permissions` grant override.
 *  - `DELETE /users/:id/permissions/:permissionCode` revoke override.
 *
 * Aplica `JwtAuthGuard` y `PermissionsGuard` a nivel de clase.
 *
 * @module users
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { GrantPermissionOverrideDto } from './dto/grant-permission-override.dto';
import { AdminResetPasswordDto } from './dto/admin-reset-password.dto';
import {
  AdminResetPasswordResponseDto,
  CreateUserResponseDto,
  PaginatedUsersResponseDto,
  PermissionOverrideResponseDto,
  UserDetailResponseDto,
  UserPermissionsResponseDto,
  UserResponseDto,
} from './dto/user-response.dto';
import {
  ApiEnvelopeCreatedResponse,
  ApiEnvelopeOkResponse,
} from '../shared/decorators/api-envelope-response.decorator';
import { ErrorResponseDto } from '../shared/dto/error-response.dto';
import { JwtAuthGuard, type RequestUser } from '../shared/guards/auth.guards';
import { PermissionsGuard } from '../shared/guards/permissions.guard';
import { VpnOriginGuard } from '../shared/guards/vpn-origin.guard';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { RequirePermissions } from '../shared/decorators/permissions.decorator';
import { RequireAnyPermission } from '../shared/decorators/any-permission.decorator';
import { RequireVpnOrigin } from '../shared/decorators/require-vpn-origin.decorator';
import { contextFromRequest } from '../shared/utils/request-context.util';

/**
 * Controlador de gestion administrativa de usuarios.
 * Prefijo: `users` (compartido con el global `api/v1`).
 */
@ApiTags('Users')
@ApiBearerAuth('bearer')
@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard, VpnOriginGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * @api {get} /users Listar usuarios
   * @apiName ListUsers
   * @apiGroup Users
   * @apiVersion 1.0.0
   * @apiPermission user.read
   * @apiDescription Lista usuarios aplicando el scope del actor.
   */
  @Get()
  @ApiOperation({
    summary: 'Listar usuarios',
    description:
      'Lista paginada con scope aplicado. GG/Administrador ven todos; GS/Coord/Verif/Cajero solo su sucursal; Distribuidor solo a si mismo.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Usuarios consultados correctamente',
    type: PaginatedUsersResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED.',
    type: ErrorResponseDto,
  })
  list(
    @CurrentUser() actor: RequestUser,
    @Query() query: ListUsersQueryDto,
  ): Promise<PaginatedUsersResponseDto> {
    return this.usersService.listUsers(actor, query);
  }

  /**
   * @api {get} /users/:id Detalle de usuario
   * @apiName GetUser
   * @apiGroup Users
   * @apiVersion 1.0.0
   * @apiPermission user.read
   */
  @Get(':id')
  @ApiOperation({
    summary: 'Detalle de usuario',
    description:
      'Devuelve el usuario, su ultima sesion y sus permisos efectivos.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Usuario consultado correctamente',
    type: UserDetailResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'USERS.NOT_FOUND.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED.',
    type: ErrorResponseDto,
  })
  get(
    @CurrentUser() actor: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<UserDetailResponseDto> {
    return this.usersService.getUser(actor, id);
  }

  /**
   * @api {post} /users Crear usuario
   * @apiName CreateUser
   * @apiGroup Users
   * @apiVersion 1.0.0
   * @apiPermission user.create
   */
  @Post()
  @RequireVpnOrigin('Tecu')
  @RequireAnyPermission('user.create', 'user.create.general_manager')
  @ApiOperation({
    summary: 'Crear usuario',
    description:
      'Crea un usuario con contrasena temporal generada por el sistema. Envia correo de bienvenida. Marca mustChangePassword=true. ' +
      'Roles permitidos: GERENTE_GENERAL usa `user.create`; ADMINISTRADOR usa `user.create.general_manager` ' +
      'para crear unicamente al Gerente General (unico GG activo, branchId=null).',
  })
  @ApiEnvelopeCreatedResponse({
    message: 'Usuario creado correctamente',
    type: CreateUserResponseDto,
  })
  @ApiConflictResponse({
    description: 'USERS.EMAIL_ALREADY_EXISTS / USERS.USERNAME_ALREADY_EXISTS.',
    type: ErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description:
      'USERS.ROLE_CREATION_FORBIDDEN / USERS.BRANCH_REQUIRED / USERS.DISTRIBUTOR_CREATION_FORBIDDEN.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED / USERS.BRANCH_SCOPE_FORBIDDEN.',
    type: ErrorResponseDto,
  })
  create(
    @CurrentUser() actor: RequestUser,
    @Body() dto: CreateUserDto,
    @Req() req: Request,
  ): Promise<CreateUserResponseDto> {
    const ctx = contextFromRequest(req);
    return this.usersService.createUser(actor, dto, ctx);
  }

  /**
   * @api {patch} /users/:id Actualizar usuario
   * @apiName UpdateUser
   * @apiGroup Users
   * @apiVersion 1.0.0
   * @apiPermission user.update
   */
  @Patch(':id')
  @RequireVpnOrigin('Tecu')
  @RequirePermissions('user.update')
  @ApiOperation({
    summary: 'Actualizar usuario',
    description:
      'Aplica un patch parcial. Si cambia rol, sucursal o status, revoca sesiones y bumpea tokenVersion.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Usuario actualizado correctamente',
    type: UserResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'USERS.NO_CHANGES.',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'USERS.NOT_FOUND.',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'USERS.EMAIL_ALREADY_EXISTS / USERS.USERNAME_ALREADY_EXISTS.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED / USERS.BRANCH_SCOPE_FORBIDDEN.',
    type: ErrorResponseDto,
  })
  update(
    @CurrentUser() actor: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateUserDto,
    @Req() req: Request,
  ): Promise<UserResponseDto> {
    const ctx = contextFromRequest(req);
    return this.usersService.updateUser(actor, id, dto, ctx);
  }

  /**
   * @api {delete} /users/:id Eliminar usuario (soft)
   * @apiName DeleteUser
   * @apiGroup Users
   * @apiVersion 1.0.0
   * @apiPermission user.delete
   */
  @Delete(':id')
  @RequireVpnOrigin('Tecu')
  @RequirePermissions('user.delete')
  @ApiOperation({
    summary: 'Eliminar usuario (soft delete)',
    description:
      'Marca isActive=false, userStatus=INACTIVO y deletedAt. Bloquea self, GG y al ultimo Administrador activo. Revoca sesiones.',
  })
  @ApiNoContentResponse({ description: 'Usuario eliminado logicamente.' })
  @ApiNotFoundResponse({
    description: 'USERS.NOT_FOUND.',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description:
      'USERS.CANNOT_DELETE_SELF / USERS.CANNOT_DELETE_GENERAL_MANAGER / USERS.LAST_ADMINISTRATOR_REQUIRED.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED.',
    type: ErrorResponseDto,
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @CurrentUser() actor: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ): Promise<void> {
    const ctx = contextFromRequest(req);
    return this.usersService.deleteUser(actor, id, ctx);
  }

  /**
   * @api {post} /users/:id/reset-password Reset de contrasena (admin)
   * @apiName AdminResetPassword
   * @apiGroup Users
   * @apiVersion 1.0.0
   * @apiPermission user.update
   */
  @Post(':id/reset-password')
  @RequireVpnOrigin('Tecu')
  @RequirePermissions('user.update')
  @ApiOperation({
    summary: 'Restablecer contrasena (admin)',
    description:
      'Genera nueva contrasena temporal, la envia por correo, marca mustChangePassword=true, revoca sesiones y bumpea tokenVersion.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Contraseña restablecida correctamente',
    type: AdminResetPasswordResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'USERS.NOT_FOUND.',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'USERS.CANNOT_RESET_SELF.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED.',
    type: ErrorResponseDto,
  })
  resetPassword(
    @CurrentUser() actor: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AdminResetPasswordDto,
    @Req() req: Request,
  ): Promise<AdminResetPasswordResponseDto> {
    const ctx = contextFromRequest(req);
    return this.usersService.adminResetPassword(actor, id, dto, ctx);
  }

  /**
   * @api {post} /users/:id/invalidate-sessions Invalidar sesiones (admin)
   * @apiName InvalidateUserSessionsAdmin
   * @apiGroup Users
   * @apiVersion 1.0.0
   * @apiPermission auth.session.revoke_any
   */
  @Post(':id/invalidate-sessions')
  @RequireVpnOrigin('Tecu')
  @RequirePermissions('auth.session.revoke_any')
  @ApiOperation({
    summary: 'Invalidar todas las sesiones del usuario',
    description:
      'Revoca TODAS las sesiones, bumpea tokenVersion, invalida cache. Pensado para respuesta a incidentes.',
  })
  @ApiNoContentResponse({ description: 'Sesiones invalidadas.' })
  @ApiNotFoundResponse({
    description: 'USERS.NOT_FOUND.',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'USERS.CANNOT_INVALIDATE_SELF.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED.',
    type: ErrorResponseDto,
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  invalidateSessions(
    @CurrentUser() actor: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ): Promise<void> {
    const ctx = contextFromRequest(req);
    return this.usersService.invalidateSessions(actor, id, 'admin_revoke', ctx);
  }

  /**
   * @api {get} /users/:id/permissions Permisos del usuario
   * @apiName GetUserPermissions
   * @apiGroup Users
   * @apiVersion 1.0.0
   * @apiPermission user.read
   */
  @Get(':id/permissions')
  @ApiOperation({
    summary: 'Permisos efectivos y overrides del usuario',
    description:
      'Devuelve effectivePermissions[] y overrides[] (incluyendo inactivos y expirados para auditoria).',
  })
  @ApiEnvelopeOkResponse({
    message: 'Permisos del usuario consultados correctamente',
    type: UserPermissionsResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'USERS.NOT_FOUND.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED.',
    type: ErrorResponseDto,
  })
  getPermissions(
    @CurrentUser() actor: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<UserPermissionsResponseDto> {
    return this.usersService.getUserPermissions(actor, id);
  }

  /**
   * @api {post} /users/:id/permissions Asignar override de permiso
   * @apiName GrantPermissionOverride
   * @apiGroup Users
   * @apiVersion 1.0.0
   * @apiPermission permission.assign
   */
  @Post(':id/permissions')
  @RequireVpnOrigin('Tecu')
  @RequirePermissions('permission.assign')
  @ApiOperation({
    summary: 'Asignar override de permiso',
    description:
      'Crea o reactiva un override (UPSERT). isGrant=false representa una denegacion explicita.',
  })
  @ApiEnvelopeCreatedResponse({
    message: 'Permiso del usuario asignado correctamente',
    type: PermissionOverrideResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'USERS.NOT_FOUND / USERS.PERMISSION_NOT_FOUND.',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'USERS.CANNOT_CHANGE_OWN_PERMISSIONS.',
    type: ErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description:
      'USERS.PERMISSION_INACTIVE / USERS.INVALID_PERMISSION_VALIDITY.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED.',
    type: ErrorResponseDto,
  })
  grantPermission(
    @CurrentUser() actor: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: GrantPermissionOverrideDto,
    @Req() req: Request,
  ): Promise<PermissionOverrideResponseDto> {
    const ctx = contextFromRequest(req);
    return this.usersService.grantPermissionOverride(actor, id, dto, ctx);
  }

  /**
   * @api {delete} /users/:id/permissions/:permissionCode Revocar override
   * @apiName RevokePermissionOverride
   * @apiGroup Users
   * @apiVersion 1.0.0
   * @apiPermission permission.assign
   */
  @Delete(':id/permissions/:permissionCode')
  @RequireVpnOrigin('Tecu')
  @RequirePermissions('permission.assign')
  @ApiOperation({
    summary: 'Revocar override de permiso',
    description: 'Marca isActive=false en el override. No es DELETE fisico.',
  })
  @ApiNoContentResponse({ description: 'Override revocado.' })
  @ApiNotFoundResponse({
    description: 'USERS.NOT_FOUND / USERS.PERMISSION_OVERRIDE_NOT_FOUND.',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'USERS.CANNOT_CHANGE_OWN_PERMISSIONS.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED.',
    type: ErrorResponseDto,
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  revokePermission(
    @CurrentUser() actor: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('permissionCode') permissionCode: string,
    @Req() req: Request,
  ): Promise<void> {
    const ctx = contextFromRequest(req);
    return this.usersService.revokePermissionOverride(
      actor,
      id,
      permissionCode,
      ctx,
    );
  }
}
