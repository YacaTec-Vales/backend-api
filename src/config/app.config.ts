import { registerAs } from '@nestjs/config';

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  apiPrefix: string;
  appPublicUrl: string;
  corsOrigins: string[];
  cookieDomain: string;
  cookieSecure: boolean;
}

export const appConfig = registerAs(
  'app',
  (): AppConfig => ({
    nodeEnv: (process.env.NODE_ENV as AppConfig['nodeEnv']) ?? 'development',
    port: parseInt(process.env.PORT ?? '3000', 10),
    apiPrefix: process.env.API_PREFIX ?? 'api/v1',
    appPublicUrl: process.env.APP_PUBLIC_URL ?? 'http://localhost:3000',
    corsOrigins: (process.env.CORS_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    cookieDomain: process.env.COOKIE_DOMAIN ?? '',
    cookieSecure: process.env.COOKIE_SECURE === 'true',
  }),
);
