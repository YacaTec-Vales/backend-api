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

/**
 * DTO publico de estado del bootstrap. Es el shape que consume el
 * frontend (`BootstrapService.getSystemStatus` -> dashboard).
 *
 * - `hasMatriz`           : existe una sucursal con `esMatriz=true`.
 * - `matrizId`/`matrizName`/`matrizFolioPrefix`: datos de esa sucursal.
 * - `hasGeneralManager`   : existe al menos un usuario activo con
 *                           rol `GERENTE_GENERAL` (unicidad enforced
 *                           por lock + indice unico parcial).
 * - `generalManagerId`/`generalManagerName`/`generalManagerEmail`:
 *                           datos del GG activo.
 * - `bootstrapComplete`   : ambos `true` -> sistema inicializado.
 */
export interface BootstrapStatusDto {
  hasMatriz: boolean;
  matrizId: string | null;
  matrizName: string | null;
  matrizFolioPrefix: string | null;
  hasGeneralManager: boolean;
  generalManagerId: string | null;
  generalManagerName: string | null;
  generalManagerEmail: string | null;
  bootstrapComplete: boolean;
}

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
   * Ademas devuelve datos basicos para mostrar en el dashboard del
   * admin (nombre, UUID, folio prefix) sin que tenga que hacer una
   * segunda llamada a /branches/:id o /users/:id.
   */
  async getBootstrapStatus(): Promise<BootstrapStatusDto> {
    const matriz = await this.branchesRepo.findMatriz();
    const gg = await this.userRepo.findActiveByRole('GERENTE_GENERAL');

    let ggName: string | null = null;
    let ggEmail: string | null = null;
    if (gg) {
      ggName =
        [gg.firstName, gg.lastNamePaternal, gg.lastNameMaternal]
          .filter((s) => !!s && s.length > 0)
          .join(' ')
          .trim() || null;
      ggEmail = gg.email ?? null;
    }

    return {
      hasMatriz: matriz !== null,
      matrizId: matriz?.id ?? null,
      matrizName: matriz?.name ?? null,
      matrizFolioPrefix: matriz?.folioPrefix ?? null,
      hasGeneralManager: gg !== null,
      generalManagerId: gg?.id ?? null,
      generalManagerName: ggName,
      generalManagerEmail: ggEmail,
      bootstrapComplete: matriz !== null && gg !== null,
    };
  }
}
