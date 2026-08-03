/**
 * @fileoverview Helpers de supertest para flujos autenticados.
 *
 * Envoltorios que:
 *  - Construyen la app de test (`createTestApp`).
 *  - Loguean un actor y devuelven access/refresh tokens.
 *  - Devuelven un agente `supertest` con `Authorization` ya
 *    inyectado para que cada test escriba menos boilerplate.
 *
 * @module test/helpers
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import request from 'supertest';

import type { CreateTestAppHandle } from './create-test-app';
import { createTestApp } from './create-test-app';

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

/**
 * Manejador autenticado: supertest agent con Authorization
 * preinyectado y los tokens originales accesibles para refresh
 * o reuso.
 */
export interface AuthenticatedAgent {
  agent: ReturnType<typeof request>;
  accessToken: string;
  refreshToken: string;
  userId: string;
  close: () => Promise<void>;
}

/**
 * Loguea a un usuario via `POST /auth/login` y devuelve los
 * tokens emitidos. Solo aplica a e2e; los unit tests deben
 * seguir mockeando `AuthService`.
 *
 * @param app - Aplicacion Nest levantada por `createTestApp`.
 * @param credentials - Username/email y password.
 * @returns Tokens de la sesion.
 */
export async function loginAs(
  app: import('@nestjs/common').INestApplication,
  credentials: { usernameOrEmail: string; password: string },
): Promise<LoginResponse> {
  const res = await request(
    app.getHttpServer() as Parameters<typeof request>[0],
  )
    .post('/auth/login')
    .send(credentials)
    .expect(201);
  return res.body as LoginResponse;
}

/**
 * Construye la app, loguea y devuelve un agente autenticado.
 * Pensado para `beforeEach` de suites e2e.
 *
 * @param credentials - Credenciales del actor.
 * @param opts - Opciones de `createTestApp`.
 * @returns Agente autenticado y funcion de cierre.
 */
export async function buildAuthenticatedAgent(
  credentials: { usernameOrEmail: string; password: string },
  opts?: Parameters<typeof createTestApp>[0],
): Promise<AuthenticatedAgent> {
  const handle: CreateTestAppHandle = await createTestApp(opts);
  const login = await loginAs(handle.app, credentials);
  const agent = request(handle.httpServer);
  return {
    agent,
    accessToken: login.accessToken,
    refreshToken: login.refreshToken,
    userId: '',
    close: handle.close,
  };
}
