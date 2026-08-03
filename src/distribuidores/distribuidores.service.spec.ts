/**
 * @fileoverview Tests placeholder para el modulo `distribuidores`.
 *
 * SCAFFOLD ONLY — los tests se dejan como `describe.skip` con un
 * `TODO` explicito para que cuando el equipo responsable implemente
 * el modulo, el harness de Jest siga reconociendolos.
 */

import { NotImplementedException } from '@nestjs/common';
import { DistribuidoresService } from './distribuidores.service';

describe('DistribuidoresService (SCAFFOLD)', () => {
  it.skip('TODO: implementar createFromSolicitud', async () => {
    const service = new DistribuidoresService();
    await expect(
      service.createFromSolicitud(
        { id: 'gg-1', role: 'GERENTE_GENERAL', branchId: null },
        { solicitudId: 'sol-1' },
        { ipAddress: '', userAgent: '', device: '' },
      ),
    ).rejects.toBeInstanceOf(NotImplementedException);
  });
});
