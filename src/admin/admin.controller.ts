/**
 * @fileoverview Controller admin (READ-ONLY).
 *
 * Solo expone endpoints de observabilidad y soporte para el rol
 * ADMINISTRADOR. La regla 3.7 del sistema lo define como
 * READ-ONLY por diseno: cualquier mutacion del admin pasa por
 * los modulos existentes (users, branches) con sus permisos
 * dedicados.
 *
 * @see AdminModule
 */
import {
  Controller,
  Get,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AdminService, type BootstrapStatusDto } from './admin.service';

/**
 * Tags OpenAPI para Scalar.
 */
@ApiTags('Admin')
/**
 * Auth Bearer JWT obligatorio. El guard global `JwtAuthGuard`
 * ya exige token; ademas el servicio valida que el rol sea
 * `ADMINISTRADOR`.
 */
@ApiBearerAuth('bearer')
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  /**
   * GET /admin/bootstrap/status
   *
   * Indica si el sistema esta inicializado (MATRIZ + GG creados).
   * Usado por el dashboard del administrador para decidir si
   * mostrar el wizard de bootstrap.
   *
   * Ademas devuelve nombre, UUID y folioPrefix de la MATRIZ, y
   * nombre, email y UUID del Gerente General activo. Asi el
   * dashboard puede mostrar identificadores reales sin disparar
   * llamadas adicionales a /branches/:id o /users/:id.
   */
  @Get('bootstrap/status')
  @ApiOperation({
    summary: 'Estado del bootstrap inicial',
    description:
      'Devuelve hasMatriz/hasGeneralManager/bootstrapComplete y los ' +
      'datos basicos de cada uno (nombre, UUID, folioPrefix para ' +
      'MATRIZ; nombre, email, UUID para GG). El admin usa esto para ' +
      'decidir si muestra el wizard de bootstrap y para mostrar la ' +
      'tarjeta de estado del sistema.',
  })
  @ApiOkResponse({
    description: 'Estado del bootstrap con datos basicos.',
  })
  async getBootstrapStatus(): Promise<BootstrapStatusDto> {
    return this.adminService.getBootstrapStatus();
  }
}
