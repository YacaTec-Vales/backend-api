export type UserType =
  | 'GERENTE_GENERAL'
  | 'GERENTE_SUCURSAL'
  | 'COORDINADOR'
  | 'VERIFICADOR'
  | 'DISTRIBUIDOR'
  | 'CAJERO'
  | 'ADMINISTRADOR';

export const USER_TYPE_VALUES: UserType[] = [
  'GERENTE_GENERAL',
  'GERENTE_SUCURSAL',
  'COORDINADOR',
  'VERIFICADOR',
  'DISTRIBUIDOR',
  'CAJERO',
  'ADMINISTRADOR',
];

export type UserStatus = 'ACTIVO' | 'INACTIVO' | 'SUSPENDIDO';

export type Device = 'Tecu' | 'Calipx' | 'Poch' | 'unknown';

export interface JwtPayload {
  sub: string;
  username: string;
  role: UserType;
  branchId: string | null;
  tokenVersion: number;
  sessionId: string;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedUser {
  id: string;
  username: string;
  email: string;
  displayName: string;
  role: UserType;
  branchId: string | null;
  userStatus: UserStatus;
  isActive: boolean;
  tokenVersion: number;
  passwordChangedAt: Date;
  mfaEnabled: boolean;
  permissions: string[];
  sessionId: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface LoginContext {
  ipAddress: string;
  userAgent: string;
  device: Device;
}
