import { describe, expect, it } from 'vitest';

import { AuthClient } from './AuthClient';
import { HttpError } from '../http-client/HttpClient';

const mePayload = {
  id: '3f6c1a52-0f1a-4a1e-9c1b-2b7a5e4d9c10',
  email: 'maria.garcia@sena.edu.co',
  full_name: 'María García',
  actor_type: 'COORDINATOR' as unknown as 'USER',
  roles: [{ name: 'COORDINATOR', training_center_id: null }],
  features: ['SCH_CREATE', 'SCH_PUBLISH'],
  modules: ['MOD_SCHEDULING', 'MOD_ACADEMIC', 'MOD_DASHBOARD'],
};

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('AuthClient', () => {
  it('usa el token del login para consultar la identidad real y no fabrica permisos', async () => {
    let token: string | null = null;
    const client = new AuthClient({
      baseUrl: '/api/v1',
      tokenProvider: { getAccessToken: () => token, setAccessToken: (value) => { token = value; }, clear: () => { token = null; } },
      fetchImpl: async (path, init) => {
        if (path.endsWith('/login')) {
          expect(new Headers(init?.headers).has('Authorization')).toBe(false);
          return jsonResponse(200, { access_token: 'issued-by-iam' });
        }
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer issued-by-iam');
        return jsonResponse(200, mePayload);
      },
    });
    expect(await client.login('user@example.test', 'test-password')).toEqual(mePayload);
    expect(client.hasSession).toBe(true);
  });

  it('descarta el token si IAM rechaza la consulta de identidad después del login', async () => {
    let token: string | null = null;
    const client = new AuthClient({
      baseUrl: '/api/v1',
      tokenProvider: { getAccessToken: () => token, setAccessToken: (value) => { token = value; }, clear: () => { token = null; } },
      fetchImpl: async (path) => path.endsWith('/login')
        ? jsonResponse(200, { access_token: 'unusable' })
        : jsonResponse(403, { message: 'Denied', error_code: 'FORBIDDEN' }),
    });
    await expect(client.login('user@example.test', 'test-password')).rejects.toBeInstanceOf(HttpError);
    expect(client.hasSession).toBe(false);
  });
  it('expone el usuario autenticado y sus módulos', async () => {
    const calls: string[] = [];
    const client = new AuthClient({
      baseUrl: '/api/v1',
      fetchImpl: async (input, init) => {
        expect(new Headers(init?.headers).has('Authorization')).toBe(false);
        calls.push(input);
        return jsonResponse(200, mePayload);
      },
    });

    const me = await client.getMe();

    expect(calls).toEqual(['/api/v1/auth/me']);
    expect(me.modules).toEqual(['MOD_SCHEDULING', 'MOD_ACADEMIC', 'MOD_DASHBOARD']);
    expect(client.user?.full_name).toBe('María García');
  });

  it('propaga el envelope de error de la API', async () => {
    const client = new AuthClient({
      baseUrl: '/api/v1',
      onUnauthorized: async () => undefined,
      fetchImpl: async () =>
        jsonResponse(403, {
          error_code: 'FORBIDDEN',
          message: 'Sin permiso (RBAC)',
          trace_id: 'trace-1',
        }),
    });

    await expect(client.getMe()).rejects.toBeInstanceOf(HttpError);
    await expect(client.getMe()).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
      traceId: 'trace-1',
    });
  });

  it('limpia la sesión local aunque el logout remoto falle', async () => {
    let cleared = false;
    const client = new AuthClient({
      baseUrl: '/api/v1',
      tokenProvider: { getAccessToken: () => 'token', clear: () => { cleared = true; } },
      fetchImpl: async () => jsonResponse(500, { error_code: 'INTERNAL', message: 'boom' }),
    });

    await expect(client.logout()).rejects.toBeInstanceOf(HttpError);
    expect(cleared).toBe(true);
    expect(client.user).toBeNull();
  });

  it('reporta ausencia de sesión cuando no hay token', () => {
    const client = new AuthClient({
      baseUrl: '/api/v1',
      tokenProvider: { getAccessToken: () => null, clear: () => undefined },
      fetchImpl: async () => jsonResponse(200, mePayload),
    });

    expect(client.hasSession).toBe(false);
  });
});
