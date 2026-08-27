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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminService } from './admin.service';

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
   */
  @Get('bootstrap/status')
  @ApiOperation({
    summary: 'Estado del bootstrap inicial',
    description:
      'Devuelve hasMatriz/hasGeneralManager/bootstrapComplete. ' +
      'El admin usa esto para decidir si muestra el wizard de ' +
      'bootstrap (cuando faltan matriz o GG).',
  })
  async getBootstrapStatus(): Promise<{
    hasMatriz: boolean;
    matriz: string | null;
    hasGeneralManager: boolean;
    generalManager: string | null;
    bootstrapComplete: boolean;
  }> {
    return this.adminService.getBootstrapStatus();
  }
}
