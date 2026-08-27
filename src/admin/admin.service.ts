/**
 * @fileoverview Servicio admin con operaciones READ-ONLY.
 *
 * Hoy expone `getBootstrapStatus()` que consulta la BD sin
 * mutar nada. Cualquier mutacion que el admin necesite hacer
 * pasa por los modulos de negocio (users, branches, etc.)
 * con sus permisos dedicados.
 */
import { Injectable, Logger } from '@nestjs/common';
import { BranchesRepository } from '../branches/branches.repository';
import { UserRepository } from '../database/repositories/user.repository';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly branchesRepo: BranchesRepository,
    private readonly userRepo: UserRepository,
  ) {}

  /**
   * Detecta si el sistema esta inicializado: existe MATRIZ y
   * existe al menos un Gerente General activo.
   *
   * El frontend (dashboard del admin) usa esto para decidir si
   * debe mostrar el wizard de bootstrap o las pantallas
   * operativas.
   */
  async getBootstrapStatus(): Promise<{
    hasMatriz: boolean;
    matriz: string | null;
    hasGeneralManager: boolean;
    generalManager: string | null;
    bootstrapComplete: boolean;
  }> {
    const matriz = await this.branchesRepo.findMatriz();
    const gg = await this.userRepo.findActiveByRole('GERENTE_GENERAL');

    return {
      hasMatriz: matriz !== null,
      matriz: matriz?.id ?? null,
      hasGeneralManager: gg !== null,
      generalManager: gg?.id ?? null,
      bootstrapComplete: matriz !== null && gg !== null,
    };
  }
}
