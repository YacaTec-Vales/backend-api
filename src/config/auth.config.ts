import { registerAs } from '@nestjs/config';

export interface AuthConfig {
  jwt: {
    secret: string;
    issuer: string;
    audience: string;
    accessTtlSeconds: number;
    refreshTtlSeconds: number;
    refreshRememberTtlSeconds: number;
  };
  argon2: {
    memoryCost: number;
    timeCost: number;
    parallelism: number;
  };
  lockout: {
    maxFailedAttempts: number;
    lockoutMinutes: number;
  };
}

export const authConfig = registerAs(
  'auth',
  (): AuthConfig => ({
    jwt: {
      secret: process.env.JWT_SECRET as string,
      issuer: process.env.JWT_ISSUER ?? 'vales-yacatec',
      audience: process.env.JWT_AUDIENCE ?? 'vales-yacatec-api',
      accessTtlSeconds: parseInt(process.env.JWT_ACCESS_TTL ?? '900', 10),
      refreshTtlSeconds: parseInt(process.env.JWT_REFRESH_TTL ?? '604800', 10),
      refreshRememberTtlSeconds: parseInt(
        process.env.JWT_REFRESH_REMEMBER_TTL ?? '2592000',
        10,
      ),
    },
    argon2: {
      memoryCost: parseInt(process.env.ARGON2_MEMORY_COST ?? '19456', 10),
      timeCost: parseInt(process.env.ARGON2_TIME_COST ?? '2', 10),
      parallelism: parseInt(process.env.ARGON2_PARALLELISM ?? '1', 10),
    },
    lockout: {
      maxFailedAttempts: parseInt(
        process.env.AUTH_MAX_FAILED_ATTEMPTS ?? '5',
        10,
      ),
      lockoutMinutes: parseInt(process.env.AUTH_LOCKOUT_MINUTES ?? '15', 10),
    },
  }),
);
