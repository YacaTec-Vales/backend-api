/**
 * Mappers barrel.
 *
 * Concentra las exportaciones de los mappers para que los
 * servicios importen con una sola linea y para que sea
 * evidente cuantos tipos de entidad tienen un mapper
 * explicito.
 *
 * Si se agrega un nuevo mapper, agregarlo aqui en orden
 * alfabetico.
 *
 * @module shared/mappers
 */

export { toBranchResponseDto } from './branch.mapper';
export type { BranchRowShape } from './branch.mapper';
export { toBranchCutoffResponseDto } from './branch-cutoff.mapper';
export type { BranchCutoffRowShape } from './branch-cutoff.mapper';
export { toClientResponseDto } from './client.mapper';
export type { ClientRowShape } from './client.mapper';
export { toDocumentResponseDto } from './document.mapper';
export type { DocumentRowShape } from './document.mapper';
export { toIso } from './date.utils';
export { toProductResponseDto } from './product.mapper';
export type { ProductRowShape } from './product.mapper';
export { toMailLogItemDto } from './mail-log.mapper';
export type { EmailLogRowShape } from './mail-log.mapper';
export { toSessionResponseDto } from './session.mapper';
export type { SessionRowShape } from './session.mapper';
export { toVoucherResponseDto } from './voucher.mapper';
export type { VoucherRowShape } from './voucher.mapper';
export {
  toInternalUserResponseDto,
  toLastSessionInfoDto,
  toOverrideResponseDto,
  toUserDetailResponseDto,
  toUserResponseDto,
} from './user.mapper';
export type {
  LastSessionRow,
  OverrideRowShape,
  UserRowShape,
} from './user.mapper';
