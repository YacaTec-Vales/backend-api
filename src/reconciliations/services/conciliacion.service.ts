import { Injectable, Inject, Logger } from '@nestjs/common';
import { DRIZZLE_WRITE } from '../../database/drizzle.provider';
import type { DrizzleWrite } from '../../database/drizzle.provider';
import { ExcelParserService } from './excel-parser.service';
import {
  reconciliationBatches,
  bankMovements,
  reconciliations,
  relations,
} from '../../database/schema';
import { eq, sql } from 'drizzle-orm';

@Injectable()
export class ConciliacionService {
  private readonly logger = new Logger(ConciliacionService.name);

  constructor(
    @Inject(DRIZZLE_WRITE) private readonly db: DrizzleWrite,
    private readonly excelParser: ExcelParserService,
  ) {}

  /**
   * Procesa la conciliación automática a partir de un archivo Excel.
   * Utiliza transacciones de Drizzle para asegurar la consistencia.
   *
   * @param fileBuffer El buffer del archivo subido
   * @param uploadedBy UUID del usuario (cajera) que sube el archivo
   * @param originalFileName Nombre original del archivo Excel
   * @param storagePath Ruta o referencia donde se guardó el documento original
   */
  async procesarConciliacionAutomatica(
    fileBuffer: Buffer,
    uploadedBy: string,
    originalFileName: string,
    storagePath: string,
  ) {
    // 1. Extraemos los movimientos usando el servicio de parsing
    const parsedMovements = this.excelParser.parseBankExcel(fileBuffer);

    // 2. Ejecutamos la lógica en una transacción garantizando atomicidad
    await this.db.transaction(async (tx) => {
      // Crear el lote de conciliación en estado inicial
      const [batch] = await tx
        .insert(reconciliationBatches)
        .values({
          uploadedBy,
          originalFileName,
          storagePath,
          sheetName: 'Hoja1',
          status: 'EN_PROCESO',
        })
        .returning();

      let matchedCount = 0;
      let branchCreditBalance = 0;

      for (const movement of parsedMovements) {
        // Ignoramos concepto, cruzamos exclusivamente por Referencia
        const relationList = await tx
          .select()
          .from(relations)
          .where(eq(relations.referencePayment, movement.reference))
          .limit(1);

        const relation = relationList[0];

        // Convertir el monto flotante a centavos
        const paymentCents = Math.round(movement.paymentAmount * 100);

        // Insertar siempre el movimiento bancario extraído del archivo
        const [insertedMovement] = await tx
          .insert(bankMovements)
          .values({
            batchId: batch.id,
            item: movement.item,
            concept: movement.concept, // Se ignora para el cruce, pero se guarda para auditoría
            reference: movement.reference,
            paymentCents,
            paymentFolio: movement.paymentFolio,
            paymentDate: movement.paymentDate, // Formato normalizado a YYYY-MM-DD o texto plano
            paymentTime: movement.paymentTime, // Formato normalizado a HH:mm
            paymentType: movement.paymentType,
            rawRow: movement.rawRow,
          })
          .returning();

        if (relation) {
          // MATCH ENCONTRADO
          const newPaidCents = Number(relation.totalPaidCents) + paymentCents;
          const newStatus =
            newPaidCents >= Number(relation.totalToPayCents)
              ? 'LIQUIDADO'
              : 'PARCIAL';

          // Actualizar saldo y estado de la relación
          await tx
            .update(relations)
            .set({
              totalPaidCents: newPaidCents,
              reconciliationStatus: newStatus,
              updatedAt: new Date(),
            })
            .where(eq(relations.id, relation.id));

          // Registrar el cruce en la tabla reconciliation
          const [reconciliationRecord] = await tx
            .insert(reconciliations)
            .values({
              relationId: relation.id,
              bankMovementId: insertedMovement.id,
              montoAplicadoCents: paymentCents,
              reconciliationType: 'AUTOMATICA',
            })
            .returning();

          // Ligar el bank_movement con su reconciliation id
          await tx
            .update(bankMovements)
            .set({ reconciliationId: reconciliationRecord.id })
            .where(eq(bankMovements.id, insertedMovement.id));

          matchedCount++;
        } else {
          // SIN MATCH: Se registra como SALDO_FAVOR_SUCURSAL sumándolo al total del batch.
          // El bank_movement se queda sin reconciliationId y sirve como histórico del sobrante.
          branchCreditBalance += paymentCents;
        }
      }

      // 3. Finalizar y actualizar el estado y contadores del lote
      await tx
        .update(reconciliationBatches)
        .set({
          totalMovements: parsedMovements.length,
          totalReconciled: matchedCount,
          totalBranchCreditBalance: branchCreditBalance,
          status: 'COMPLETADO',
          completedAt: new Date(),
        })
        .where(eq(reconciliationBatches.id, batch.id));

      this.logger.log(
        `Lote ${batch.id} procesado exitosamente. Movimientos totales: ${parsedMovements.length}, Cruzados: ${matchedCount}, Saldo huérfano (cents): ${branchCreditBalance}`,
      );
    });
  }

  /**
   * Procesa la conciliación manual de un movimiento bancario hacia una relación.
   * Requiere una autorización previa (aprobada por un Gerente o Coordinador).
   */
  async procesarConciliacionManual(
    bankMovementId: string,
    relationId: string,
    authorizationId: string,
    userId: string,
  ) {
    await this.db.transaction(async (tx) => {
      // Validar que el movimiento no esté conciliado previamente
      const [movement] = await tx
        .select()
        .from(bankMovements)
        .where(eq(bankMovements.id, bankMovementId))
        .limit(1);

      if (!movement) throw new Error('Movimiento bancario no encontrado');
      if (movement.reconciliationId)
        throw new Error('El movimiento ya se encuentra conciliado');

      // Validar relación
      const [relation] = await tx
        .select()
        .from(relations)
        .where(eq(relations.id, relationId))
        .limit(1);

      if (!relation) throw new Error('Relación no encontrada');

      // (Nota: En un entorno real validaríamos que la autorización existe,
      // es del tipo CONCILIACION_MANUAL, está APROBADA y pertenece a esto).

      const paymentCents = movement.paymentCents;
      const newPaidCents = Number(relation.totalPaidCents) + paymentCents;
      const newStatus =
        newPaidCents >= Number(relation.totalToPayCents)
          ? 'LIQUIDADO'
          : 'PARCIAL';

      // 1. Actualizar Relación
      await tx
        .update(relations)
        .set({
          totalPaidCents: newPaidCents,
          reconciliationStatus: newStatus,
          updatedAt: new Date(),
        })
        .where(eq(relations.id, relation.id));

      // 2. Insertar Conciliación Manual
      const [reconciliationRecord] = await tx
        .insert(reconciliations)
        .values({
          relationId: relation.id,
          bankMovementId: movement.id,
          montoAplicadoCents: paymentCents,
          reconciliationType: 'MANUAL',
          authorizationId,
          notes: `Conciliación manual ejecutada por el usuario ${userId}`,
        })
        .returning();

      // 3. Ligar Bank Movement
      await tx
        .update(bankMovements)
        .set({ reconciliationId: reconciliationRecord.id })
        .where(eq(bankMovements.id, movement.id));

      // NOTA: Como la acción modifica una conciliación, la traza de auditoría
      // debe quedar mediante el app.audit_action seteado a 'CONCILIACION.MANUAL'
      await tx.execute(sql`SET LOCAL app.audit_action = 'CONCILIACION.MANUAL'`);

      this.logger.log(
        `Conciliación manual ejecutada. Movimiento: ${bankMovementId}, Relación: ${relationId}`,
      );
    });
  }
}
