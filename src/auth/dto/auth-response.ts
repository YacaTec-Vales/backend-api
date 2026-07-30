export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
  user: AuthUserResponse;
}

export interface AuthUserResponse {
  id: string;
  username: string;
  email: string;
  displayName: string;
  role: string;
  branchId: string | null;
  mfaEnabled: boolean;
  permissions: string[];
}

export interface SessionResponse {
  id: string;
  device: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  issuedAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date;
  isCurrent: boolean;
}
