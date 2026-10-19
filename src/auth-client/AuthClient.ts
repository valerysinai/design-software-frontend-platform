import type { components, operations } from '../contracts/generated/iam';
import { HttpClient, type HttpClientOptions, type SessionState, type TokenProvider } from '../http-client/HttpClient';

export type Me = components['schemas']['MeResponse'];

export interface Session extends SessionState {
  user: Me | null;
}

export interface AuthClientOptions extends HttpClientOptions {
  accessToken?: string;
}

export class AuthClient {
  private readonly http: HttpClient;
  private readonly tokenProvider: TokenProvider | undefined;
  private currentUser: Me | null = null;

  constructor(options: AuthClientOptions) {
    this.tokenProvider = options.tokenProvider;
    this.http = new HttpClient(options);
  }

  get hasSession(): boolean {
    return this.tokenProvider?.getAccessToken() != null;
  }

  get user(): Me | null {
    return this.currentUser;
  }

  async login(email: string, password: string): Promise<Me> {
    if (!this.tokenProvider?.setAccessToken) {
      throw new Error('A writable token provider is required to sign in.');
    }
    const result = await this.http.post<components['schemas']['TokenResponse']>('/auth/login', { email, password });
    this.tokenProvider.setAccessToken(result.access_token);
    try {
      return await this.getMe();
    } catch (error) {
      this.clearSession();
      throw error;
    }
  }

  async getMe(): Promise<Me> {
    const me = await this.http.get<Me>('/auth/me');
    this.currentUser = me;
    this.http.notifySession({ authenticated: true, userId: me.id });
    return me;
  }

  async logout(): Promise<void> {
    try {
      await this.http.post<void>('/auth/logout');
    } finally {
      this.clearSession();
    }
  }

  clearSession(): void {
    this.currentUser = null;
    this.tokenProvider?.clear();
    this.http.notifySession({ authenticated: false, userId: null });
  }
}

export type LogoutOperation = operations['logout'];
