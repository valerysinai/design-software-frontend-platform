/**
 * Tests de `HttpClient` con `EventBus` — HU-007 (E3).
 *
 * Lo que se verifica es la decisión de diseño central de esta HU: **el evento no se
 * publica en el primer 401**. Ese 401 es el token vencido, que el refresh resuelve
 * solo; publicar ahí expulsaría al usuario a login cada vez que el token expira.
 *
 * El evento sale solo cuando la sesión está realmente muerta:
 *   - el refresh lanza, o
 *   - el reintento vuelve a dar 401.
 */
import { describe, expect, it, vi } from 'vitest';

import { EventBus } from '../event-bus/EventBus';
import type { SessionExpiredPayload } from '../event-bus/events';
import { HttpClient, HttpError } from './HttpClient';

const unauthorized = (): Response => new Response(null, { status: 401 });

const okJson = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

interface Harness {
  bus: EventBus;
  eventos: SessionExpiredPayload[];
  client: HttpClient;
  responses: Response[];
}

/**
 * Monta un cliente con un bus y una cola de respuestas. `responses` se consume en
 * orden: cada llamada a fetch saca la siguiente.
 */
const harness = (responses: Response[], onUnauthorized?: () => Promise<void>): Harness => {
  const cola = [...responses];
  const bus = new EventBus();
  const eventos: SessionExpiredPayload[] = [];
  bus.subscribe('session-expired', (p) => eventos.push(p));

  const client = new HttpClient({
    baseUrl: '/api/v1',
    eventBus: bus,
    fetchImpl: async () => {
      const siguiente = cola.shift();
      if (siguiente === undefined) throw new Error('fetch called more times than expected');
      return siguiente;
    },
    ...(onUnauthorized === undefined ? {} : { onUnauthorized }),
  });

  return { bus, eventos, client, responses: cola };
};

describe('E3 sesion expirada', () => {
  it('no publica nada con el primer 401 si el refresh funciona', async () => {
    // El caso normal: token vencido, refresh exitoso, el reintento devuelve 200.
    const h = harness([unauthorized(), okJson({ ok: true })], () => Promise.resolve());

    const resultado = await h.client.get('/resource');

    expect(resultado).toEqual({ ok: true });
    expect(h.eventos).toEqual([]);
  });

  it('publica cuando el reintento vuelve a dar 401', async () => {
    // El refresh "funciona" pero el token nuevo tampoco sirve: sesión muerta.
    const h = harness([unauthorized(), unauthorized()], () => Promise.resolve());

    await expect(h.client.get('/resource')).rejects.toBeInstanceOf(HttpError);
    expect(h.eventos).toEqual([{ attempts: 2 }]);
  });

  it('publica cuando el refresh lanza', async () => {
    const h = harness([unauthorized()], () => Promise.reject(new Error('refresh falló')));

    await expect(h.client.get('/resource')).rejects.toThrow('refresh falló');
    expect(h.eventos).toEqual([{ attempts: 1 }]);
  });

  it('intenta el refresh una sola vez, no en bucle', async () => {
    // Si reintentara en bucle, con dos respuestas 401 en la cola se quedaría
    // sin respuestas y `fetch` lanzaria. Que termine en HttpError(401) y no en
    // "fetch called more times" demuestra que paró tras un reintento.
    const onUnauthorized = vi.fn(() => Promise.resolve());
    const h = harness([unauthorized(), unauthorized()], onUnauthorized);

    await expect(h.client.get('/resource')).rejects.toBeInstanceOf(HttpError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('el contador de 401 se reinicia tras publicar', async () => {
    // Tras un evento, la cuenta empieza de cero: `attempts` describe la ráfaga
    // actual, no el total histórico.
    const h = harness(
      [unauthorized(), unauthorized(), unauthorized(), unauthorized()],
      () => Promise.resolve(),
    );

    await expect(h.client.get('/a')).rejects.toBeInstanceOf(HttpError);
    await expect(h.client.get('/b')).rejects.toBeInstanceOf(HttpError);

    expect(h.eventos).toEqual([{ attempts: 2 }, { attempts: 2 }]);
  });

  it('sin eventBus sigue funcionando igual', async () => {
    // El bus es opcional: no debe romper a quien ya instancia HttpClient.
    const client = new HttpClient({
      baseUrl: '/api/v1',
      fetchImpl: async () => unauthorized(),
      onUnauthorized: () => Promise.resolve(),
    });

    await expect(client.get('/resource')).rejects.toBeInstanceOf(HttpError);
  });

  it('las llamadas correctas no generan ningun evento', async () => {
    const h = harness([okJson({ a: 1 }), okJson({ b: 2 })]);

    await h.client.get('/a');
    await h.client.get('/b');

    expect(h.eventos).toEqual([]);
  });

  it('un 403 no genera el evento de sesion expirada', async () => {
    const h = harness([new Response(null, { status: 403 })]);

    await expect(h.client.get('/resource')).rejects.toBeInstanceOf(HttpError);
    expect(h.eventos).toEqual([]);
  });

  it('notifySession autenticado reinicia el contador de 401', async () => {
    const h = harness([unauthorized(), unauthorized()], () => Promise.resolve());

    await expect(h.client.get('/a')).rejects.toBeInstanceOf(HttpError);
    expect(h.eventos).toEqual([{ attempts: 2 }]);

    // El usuario vuelve a autenticarse; la cuenta anterior no debe arrastrarse.
    h.client.notifySession({ authenticated: true, userId: 'u1' });

    const h2 = harness([unauthorized(), unauthorized()], () => Promise.resolve());
    await expect(h2.client.get('/b')).rejects.toBeInstanceOf(HttpError);
    expect(h2.eventos).toEqual([{ attempts: 2 }]);
  });

  it('varias peticiones concurrentes comparten el refresh en vuelo', async () => {
    let resolverRefresh: (() => void) | undefined;
    const refreshEnVuelo = new Promise<void>((resolve) => {
      resolverRefresh = resolve;
    });

    const bus = new EventBus();
    const eventos: SessionExpiredPayload[] = [];
    bus.subscribe('session-expired', (p) => eventos.push(p));

    let llamadas = 0;
    const client = new HttpClient({
      baseUrl: '/api/v1',
      eventBus: bus,
      onUnauthorized: () => refreshEnVuelo,
      fetchImpl: async () => {
        llamadas += 1;
        // Las dos primeras son 401 (dos peticiones concurrentes).
        return llamadas <= 2 ? unauthorized() : okJson({ ok: true });
      },
    });

    const a = client.get('/a');
    const b = client.get('/b');
    resolverRefresh?.();
    await Promise.all([a, b]);

    expect(eventos).toEqual([]);
  });
});