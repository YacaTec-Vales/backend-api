/**
 * @fileoverview Barrel de mappers DTO.
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
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

export { toBranchResponseDto } from './branch.mapper';
export type { BranchRowShape } from './branch.mapper';
export { toClientResponseDto } from './client.mapper';
export type { ClientRowShape } from './client.mapper';
export { toIso } from './date.utils';
export { toMailLogItemDto } from './mail-log.mapper';
export type { EmailLogRowShape } from './mail-log.mapper';
export { toSessionResponseDto } from './session.mapper';
export type { SessionRowShape } from './session.mapper';
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
