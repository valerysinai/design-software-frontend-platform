/**
 * Catálogo de eventos cross-MFE — HU-007 (E4: tipado por evento).
 *
 * La HU es explícita en no hacer esto: *"Lista mínima de eventos cross-MFE conocidos
 * hoy (sesión expirada + los que surjan de HU-SHELL-003) — no diseñar un catálogo
 * especulativo de eventos que nadie usa todavía"*.
 *
 * Por ahora hay un solo evento. Añadir otro es añadir una clave a `EventPayloads`,
 * y ese cambio queda cubierto por los tests.
 */

/**
 * Payload de `session-expired`.
 *
 * `attempts` dice cuántos 401 hubo. Sirve para distinguir "el token venció y el
 * refresh no lo salvó" de "varios fallos seguidos", que suele apuntar a un problema
 * de sesión más serio.
 */
export interface SessionExpiredPayload {
  /** Cantidad de respuestas 401 observadas desde la última sesión válida. */
  readonly attempts: number;
}

/**
 * Mapa de evento → payload.
 *
 * La clave es el nombre del evento y el valor su payload. Al suscribirse hay que
 * pasar ambas cosas, asi que un nombre mal escrito falla en `tsc` y no en runtime.
 */
export interface EventPayloads {
  'session-expired': SessionExpiredPayload;
}

/** Nombres de evento válidos. Derivado de `EventPayloads`, no una lista aparte. */
export type EventName = keyof EventPayloads;

/** El payload asociado a un evento concreto. */
export type PayloadOf<E extends EventName> = EventPayloads[E];

/** Firma de un handler ya tipado contra su evento. */
export type EventHandler<E extends EventName> = (payload: PayloadOf<E>) => void;

/** Función que cancela una suscripción. Es lo que devuelve `subscribe`. */
export type Unsubscribe = () => void;