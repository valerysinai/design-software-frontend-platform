import type { EventBus } from '../event-bus/EventBus';

export interface ApiError {
  error_code: string;
  message: string;
  trace_id?: string;
}

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly traceId: string | undefined;

  constructor(status: number, body: ApiError | null) {
    super(body?.message ?? `HTTP ${status}`);
    this.name = 'HttpError';
    this.status = status;
    this.code = body?.error_code ?? 'UNKNOWN_ERROR';
    this.traceId = body?.trace_id;
  }
}

export interface SessionState {
  authenticated: boolean;
  userId: string | null;
}

export interface SessionListener {
  (state: SessionState): void;
}

export interface TokenProvider {
  getAccessToken(): string | null;
  clear(): void;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpClientOptions {
  baseUrl: string;
  fetchImpl?: FetchLike;
  tokenProvider?: TokenProvider;
  onUnauthorized?: () => Promise<void>;
  onSessionChange?: SessionListener;
  /**
   * Bus para eventos cross-MFE (HU-007). Opcional para no romper a quien ya
   * instancia `HttpClient` sin bus.
   *
   * Cuando se pasa, el cliente publica `session-expired` **solo cuando la sesión
   * está realmente muerta**: el refresh falló, o el reintento volvió a dar 401.
   * Ver `publishSessionExpired` para el porqué de no publicar en el primer 401.
   */
  eventBus?: EventBus;
}

const isApiError = (value: unknown): value is ApiError => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate['error_code'] === 'string' && typeof candidate['message'] === 'string';
};

export class HttpClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly tokenProvider: TokenProvider | undefined;
  private readonly onUnauthorized: (() => Promise<void>) | undefined;
  private readonly onSessionChange: SessionListener | undefined;
  private readonly eventBus: EventBus | undefined;
  private refreshInFlight: Promise<void> | null = null;
  private unauthorizedCount = 0;

  constructor(options: HttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.tokenProvider = options.tokenProvider;
    this.onUnauthorized = options.onUnauthorized;
    this.onSessionChange = options.onSessionChange;
    this.eventBus = options.eventBus;
  }

  async request<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (init.body !== undefined && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const token = this.tokenProvider?.getAccessToken();
    if (token !== null) headers.set('Authorization', `Bearer ${token}`);

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      credentials: 'include',
    });

    if (response.status === 401) {
      this.unauthorizedCount += 1;

      // Un 401 con refresh pendiente NO es una sesión muerta: es el token vencido,
      // que el refresh resuelve solo. Publicar aquí expulsaría al usuario a login
      // cada vez que el token expira, que es cada poco.
      if (!retried) {
        try {
          await this.refreshOnce();
        } catch (error) {
          // El refresh falló: no hay token y la sesión no se recupera sola.
          this.publishSessionExpired();
          throw error;
        }
        return this.request<T>(path, init, true);
      }

      // El reintento volvió a dar 401: el refresh no sirvió, la sesión está muerta.
      this.publishSessionExpired();
    }

    if (!response.ok) throw new HttpError(response.status, await HttpClient.parseError(response));

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  /**
   * Publica `session-expired` y limpia el contador.
   *
   * Lo consume el shell (HU-SHELL-003 E3) para redirigir a login preservando la
   * ruta de retorno.
   */
  private publishSessionExpired(): void {
    const attempts = this.unauthorizedCount;
    this.unauthorizedCount = 0;
    this.eventBus?.publish('session-expired', { attempts });
  }

  /** Avisa que la sesión volvió a estar viva (login, refresh exitoso). */
  notifySession(state: SessionState): void {
    if (state.authenticated) this.unauthorizedCount = 0;
    this.onSessionChange?.(state);
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    const init: RequestInit = { method: 'POST' };
    if (body !== undefined) init.body = JSON.stringify(body);
    return this.request<T>(path, init);
  }

  private refreshOnce(): Promise<void> {
    if (this.refreshInFlight !== null) return this.refreshInFlight;
    const onUnauthorized = this.onUnauthorized ?? ((): Promise<void> => Promise.resolve());
    const run = onUnauthorized().finally(() => {
      this.refreshInFlight = null;
    });
    this.refreshInFlight = run;
    return run;
  }

  private static async parseError(response: Response): Promise<ApiError | null> {
    try {
      const body: unknown = await response.json();
      return isApiError(body) ? body : null;
    } catch {
      return null;
    }
  }
}