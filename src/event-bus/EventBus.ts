/**
 * `EventBus` pub/sub — HU-007 (E1, E2, E4).
 *
 * Por qué existe: ADR-009 §6 exige que los MFE se comuniquen sin acoplarse entre sí.
 * Un MFE que llama a otro directamente crea una dependencia que el host no puede
 * controlar. Con el bus, ambos dependen solo de `frontend-platform`.
 *
 * Por qué NO usa React: ADR-009 §1 mantiene `frontend-platform` framework-agnóstico
 * (TypeScript puro, sin dependencia de React). El bus es una clase plana; el
 * `HttpClient` la recibe por sus opciones de constructor, igual que recibe
 * `tokenProvider`. Quien quiera un Context de React lo monta en su capa, no aquí.
 */
import type { EventHandler, EventName, PayloadOf, Unsubscribe } from './events';

type AnyHandler = (payload: never) => void;

export interface EventBusOptions {
  /**
   * Si es `true`, un handler que lance no impide que corran los demás.
   * Por defecto es `false`: un error de un suscriptor debe verse, no ocultarse
   * detrás del siguiente.
   */
  readonly continueOnError?: boolean;

  /**
   * Dónde reportar los errores de los handlers. Por defecto va a `console.error`.
   * En tests se inyecta para poder afirmar sobre ellos.
   */
  readonly onHandlerError?: (error: unknown, event: EventName) => void;
}

export class EventBus {
  private readonly handlers = new Map<EventName, Set<AnyHandler>>();
  private readonly continueOnError: boolean;
  private readonly onHandlerError: (error: unknown, event: EventName) => void;

  constructor(options: EventBusOptions = {}) {
    this.continueOnError = options.continueOnError ?? false;
    this.onHandlerError =
      options.onHandlerError ??
      ((error, event) => {
        console.error(`[EventBus] handler de "${event}" falló`, error);
      });
  }

  /**
   * Suscribe un handler a un evento y devuelve la función para cancelarlo.
   *
   * E1: el cleanup es parte del contrato. Sin esto, un MFE desmontado seguiría
   * escuchando eventos de otro y la referencia nunca se liberaría.
   *
   * Devolver la función (en vez de un `unsubscribe(name, handler)` aparte) hace que
   * no se pueda olvidar: si no guardas el retorno, no hay nada que llamar.
   */
  subscribe<E extends EventName>(event: E, handler: EventHandler<E>): Unsubscribe {
    const existing = this.handlers.get(event);
    if (existing === undefined) {
      this.handlers.set(event, new Set([handler as AnyHandler]));
    } else {
      existing.add(handler as AnyHandler);
    }

    let subscribed = true;
    return () => {
      // Idempotente: llamar dos veces al unsubscribe no debe romper nada, porque
      // el cleanup de React corre dos veces en StrictMode.
      if (!subscribed) return;
      subscribed = false;
      const current = this.handlers.get(event);
      if (current === undefined) return;
      current.delete(handler as AnyHandler);
      if (current.size === 0) this.handlers.delete(event);
    };
  }

  /**
   * Publica un evento a todos sus suscriptores.
   *
   * Se itera sobre una copia: un handler que se desuscribe a sí mismo durante la
   * publicación no debe saltarse al siguiente.
   */
  publish<E extends EventName>(event: E, payload: PayloadOf<E>): void {
    const current = this.handlers.get(event);
    if (current === undefined) return;

    for (const handler of [...current]) {
      try {
        (handler as EventHandler<E>)(payload);
      } catch (error) {
        this.onHandlerError(error, event);
        if (!this.continueOnError) throw error;
      }
    }
  }

  /** Quantos handlers tiene ahora un evento. Pensado para tests. */
  listenerCount<E extends EventName>(event: E): number {
    return this.handlers.get(event)?.size ?? 0;
  }

  /** Quita todos los handlers de un evento. Pensado para tests y para teardown. */
  clear(event?: EventName): void {
    if (event === undefined) this.handlers.clear();
    else this.handlers.delete(event);
  }
}