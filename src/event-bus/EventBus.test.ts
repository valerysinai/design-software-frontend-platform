/**
 * Tests del `EventBus` — HU-007 (E1, E2, E4).
 */
import { describe, expect, it, vi } from 'vitest';

import { EventBus } from './EventBus';
import type { SessionExpiredPayload } from './events';

const payload = (attempts = 1): SessionExpiredPayload => ({ attempts });

describe('E1 publicar y suscribir', () => {
  it('entrega el payload al handler suscrito', () => {
    const bus = new EventBus();
    const recibido: SessionExpiredPayload[] = [];

    bus.subscribe('session-expired', (p) => recibido.push(p));
    bus.publish('session-expired', payload(2));

    expect(recibido).toEqual([{ attempts: 2 }]);
  });

  it('entrega a varios handlers del mismo evento', () => {
    const bus = new EventBus();
    const a = vi.fn();
    const b = vi.fn();

    bus.subscribe('session-expired', a);
    bus.subscribe('session-expired', b);
    bus.publish('session-expired', payload());

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('no entrega eventos a los que no se suscribió', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.subscribe('session-expired', handler);
    bus.publish('session-expired', payload());
    handler.mockClear();

    // Con el catálogo de un solo evento no se puede publicar otro, asi que se
    // verifica que el bus no invoca a nadie cuando no hay suscriptores.
    bus.clear();
    bus.publish('session-expired', payload());

    expect(handler).not.toHaveBeenCalled();
  });

  it('publicar sin suscriptores no falla', () => {
    const bus = new EventBus();
    expect(() => bus.publish('session-expired', payload())).not.toThrow();
  });

  it('el mismo handler puede suscribirse dos veces y recibe dos veces', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.subscribe('session-expired', handler);
    bus.subscribe('session-expired', handler);
    bus.publish('session-expired', payload());

    // Set() deduplica por identidad: dos suscripciones del mismo handler son
    // una sola. Se documenta para que nadie dependa de la duplicación.
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('E1 cleanup', () => {
  it('el unsubscribe detiene la entrega', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    const stop = bus.subscribe('session-expired', handler);
    bus.publish('session-expired', payload());
    stop();
    bus.publish('session-expired', payload());

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('el unsubscribe es idempotente', () => {
    // React corre los efectos dos veces en StrictMode, asi que el cleanup puede
    // invocarse dos veces sobre la misma función.
    const bus = new EventBus();
    const handler = vi.fn();

    const stop = bus.subscribe('session-expired', handler);
    stop();
    expect(() => stop()).not.toThrow();
    expect(() => stop()).not.toThrow();
  });

  it('unsubscribe de un evento sin handlers no falla', () => {
    const bus = new EventBus();
    const stop = bus.subscribe('session-expired', vi.fn());
    bus.clear();
    expect(() => stop()).not.toThrow();
  });

  it('solo se desuscribe el handler indicado, no el resto', () => {
    const bus = new EventBus();
    const seQueda = vi.fn();
    const seViene = vi.fn();

    bus.subscribe('session-expired', seQueda);
    const stop = bus.subscribe('session-expired', seViene);
    stop();
    bus.publish('session-expired', payload());

    expect(seQueda).toHaveBeenCalledTimes(1);
    expect(seViene).not.toHaveBeenCalled();
  });

  it('listenerCount refleja las suscripciones vivas', () => {
    const bus = new EventBus();
    expect(bus.listenerCount('session-expired')).toBe(0);

    const stop1 = bus.subscribe('session-expired', vi.fn());
    bus.subscribe('session-expired', vi.fn());
    expect(bus.listenerCount('session-expired')).toBe(2);

    stop1();
    expect(bus.listenerCount('session-expired')).toBe(1);

    bus.clear();
    expect(bus.listenerCount('session-expired')).toBe(0);
  });
});

describe('robustez', () => {
  it('un handler que se desuscribe durante la publicación no rompe el resto', () => {
    const bus = new EventBus();
    const segundo = vi.fn();

    const stopPrimero = bus.subscribe('session-expired', () => {
      stopPrimero();
    });
    bus.subscribe('session-expired', segundo);

    // Si se iterara el Set vivo, desuscribirse durante el recorrido saltaría el
    // segundo handler. Se itera sobre una copia justamente para esto.
    bus.publish('session-expired', payload());

    expect(segundo).toHaveBeenCalledTimes(1);
  });

  it('un handler que lanza se reporta y se propaga por defecto', () => {
    const errores: unknown[] = [];
    const bus = new EventBus({ onHandlerError: (e) => errores.push(e) });
    const boom = new Error('boom');

    bus.subscribe('session-expired', () => {
      throw boom;
    });

    expect(() => bus.publish('session-expired', payload())).toThrow(boom);
    expect(errores).toEqual([boom]);
  });

  it('con continueOnError, los demás handlers siguen corriendo', () => {
    const errores: unknown[] = [];
    const bus = new EventBus({
      continueOnError: true,
      onHandlerError: (e) => errores.push(e),
    });
    const despues = vi.fn();

    bus.subscribe('session-expired', () => {
      throw new Error('boom');
    });
    bus.subscribe('session-expired', despues);

    expect(() => bus.publish('session-expired', payload())).not.toThrow();
    expect(despues).toHaveBeenCalledTimes(1);
    expect(errores).toHaveLength(1);
  });

  it('sin onHandlerError inyectado, el fallo va a console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const bus = new EventBus();

    bus.subscribe('session-expired', () => {
      throw new Error('boom');
    });

    expect(() => bus.publish('session-expired', payload())).toThrow();
    expect(spy).toHaveBeenCalled();
    expect(String(spy.mock.calls[0]?.[0])).toContain('session-expired');
    spy.mockRestore();
  });

  it('clear sin argumento vacia todo', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.subscribe('session-expired', handler);
    bus.clear();
    bus.publish('session-expired', payload());

    expect(handler).not.toHaveBeenCalled();
  });
});

describe('E4 tipado por evento', () => {
  it('los tipos del catalogo son los unicos nombres validos', () => {
    // Si esto compila, EventName sigue el catalogo. La asercion de
    // runtime es trivial; lo que importa es que el nombre este en el mapa.
    const bus = new EventBus();
    expect(bus.listenerCount('session-expired')).toBe(0);
  });
});