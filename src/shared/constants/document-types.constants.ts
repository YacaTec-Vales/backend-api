/**
 * @fileoverview Constantes de tipos de documento (`app.document.document_type`).
 *
 * Vive en este modulo (y no en `documents/`) para evitar un import
 * circular entre `documents/documents.service.ts` y los mappers que
 * proyectan entidades con `documentType`.
 *
 * @module shared/constants
 * @author Equipo de desarrollo Mis Vales
 * @since 2.7.0
 */

export const DOCUMENT_TYPES = {
  INE: 'ine',
  ADDRESS_PROOF: 'address_proof',
  VOUCHER_EVIDENCE: 'voucher_evidence',
  CONCILIACION_EVIDENCE: 'conciliacion_evidence',
  PHOTO_VERIFICATION: 'photo_verification',
  OTHER: 'other',
} as const;

export type DocumentTypeValue =
  (typeof DOCUMENT_TYPES)[keyof typeof DOCUMENT_TYPES];
