/**
 * Contrato de tipos del componente que cada remote expone — HU-008, ADR-009 §11 capa 1.
 *
 * Para qué sirve: si un remote cambia la forma de su `App` de un modo incompatible,
 * **su propio `tsc` falla** antes de que el cambio llegue al host. Es el equivalente
 * frontend del gate Pact del backend (ADR-006 §7).
 *
 * ## Qué NO es este archivo (E3)
 *
 * Describe la forma del **componente React**, no la API. Los tipos de datos de negocio
 * siguen viniendo del OpenAPI generado de cada MFE
 * (`contracts/generated/<dominio>.ts`). Aquí no se redeclara ni un solo schema: cuando un
 * puerto necesita un payload de dominio, se declara su **forma estructural** con el
 * payload opaco (`unknown`), y cada MFE conserva sus tipos precisos, que satisfacen esa
 * forma. Es lo que permite que el contrato sea ejecutable sin arrastrar los
 * `contracts/generated` de 9 repos a este paquete.
 *
 * ## Cómo lo consume un MFE
 *
 * La interfaz local del MFE **extiende** la de aquí:
 *
 * ```ts
 * import type { IamMfeProps as PlatformIamMfeProps } from '@sena/frontend-platform';
 *
 * export interface IamMfeProps extends PlatformIamMfeProps {
 *   rbacCatalog?: RbacCatalogPort;   // tipo preciso del MFE
 * }
 * ```
 *
 * Si el MFE cambiara `rbacCatalog` a algo que no cumple la forma declarada aquí, el
 * `extends` no compila. **Ese `extends` es el gate de E2.**
 *
 * ## Lo que el shell envía hoy
 *
 * El host monta los remotes en `RemoteRoutes.tsx` con una única prop:
 *
 * ```tsx
 * <Remote basePath={definition.basePath} />
 * ```
 *
 * El resto de props de este contrato son opcionales porque son lo que cada MFE **ya
 * espera** y lo que el shell habilita conforme se conecten backend y base de datos. Se
 * declaran todas para que el contrato sea el lugar único donde ver qué falta inyectar,
 * en vez de estar repartido por 9 `App.tsx`.
 */

/** Prop que el shell envía hoy a todos los remotes. */
export interface BaseMfeProps {
  /**
   * Prefijo bajo el que el shell monta el remote, p. ej. `/scheduling`.
   *
   * OJO: hoy ningún MFE la lee (verificado 2026-10-14: 9 de 9 la declaran y 0 la
   * consumen). Está aquí porque es la única prop que el host realmente envía, y por
   * tanto la única que el contrato puede validar de extremo a extremo hoy.
   */
  basePath?: string;
}

// ---------------------------------------------------------------------------
// iam-mfe
// ---------------------------------------------------------------------------

/**
 * Forma del puerto RBAC de iam, sin acoplar a los tipos OpenAPI del MFE.
 *
 * `RbacModule`, `RbacRole` y `RbacRoleFeature` son
 * `components["schemas"][...]` del `iam.yaml` generado dentro de iam-mfe. Declarar aquí
 * la forma y dejar el payload opaco es lo que permite que el `extends` del MFE valide sin
 * que este paquete dependa de los tipos generados de otro repo (E3).
 */
export interface RbacCatalogPortContract {
  listModules(): Promise<unknown[]>;
  listRoles(): Promise<unknown[]>;
  listRoleFeatures(roleId: string): Promise<unknown[]>;
}

/** Forma del puerto de administración de usuarios de iam. Mismo criterio que arriba. */
export interface UserAdministrationPortContract {
  listUsers(query: unknown): Promise<unknown>;
  createUser(input: unknown): Promise<unknown>;
  updateUser(userId: string, input: unknown): Promise<unknown>;
  listRoles(): Promise<unknown[]>;
  revokeGlobalRole(userId: string, roleName: string): Promise<void>;
  deactivateUser(userId: string): Promise<void>;
  listSessions(userId: string): Promise<unknown[]>;
  closeSession(userId: string, sessionId: string): Promise<void>;
}

export interface IamMfeProps extends BaseMfeProps {
  /** HU-IAM-015. Implementación real: `iam-mfe/src/application/ports/UserAdministrationPort`. */
  userAdministration?: UserAdministrationPortContract;
  /** El shell valida el permiso antes de montar el MFE. */
  canManageUsers?: boolean;
  /** HU-IAM-016. Implementación real: `iam-mfe/src/application/ports/RbacCatalogPort`. */
  rbacCatalog?: RbacCatalogPortContract;
  /** Autorización de lectura RBAC confirmada por el shell. `false` si no se pudo verificar. */
  canViewRoleConfig?: boolean;
}

// ---------------------------------------------------------------------------
// scheduling-mfe
// ---------------------------------------------------------------------------

/** Sub-rutas que el shell puede pedirle a scheduling-mfe. */
export type SchedulingActivePage =
  | 'time-slots'
  | 'schedules'
  | 'schedule-editor'
  | 'schedule-conflicts'
  | 'my-schedule';

export interface SchedulingMfeProps extends BaseMfeProps {
  userPermissions?: string[];
  apiBaseUrl?: string;
  activePage?: SchedulingActivePage;
  /**
   * Puerto de plataforma que el MFE ya define en `MySchedulePlatform`.
   * Se declara opaco para no atar el contrato a esa interfaz local.
   */
  mySchedulePlatform?: unknown;
  scheduleId?: string;
  onCreateSchedule?: () => void;
  onNavigateToSchedules?: () => void;
  onNavigateToConflicts?: (scheduleId: string) => void;
  onNavigateToScheduleEditor?: (scheduleId: string, reviewedRowVersion?: number) => void;
  conflictsReviewedVersion?: number;
}

// ---------------------------------------------------------------------------
// academic-management-mfe
// ---------------------------------------------------------------------------

export interface AcademicManagementMfeProps extends BaseMfeProps {
  apiBaseUrl?: string;
}

// ---------------------------------------------------------------------------
// training-environment-mfe
// ---------------------------------------------------------------------------

export interface TrainingEnvironmentMfeProps extends BaseMfeProps {
  userRole?: string;
  roles?: string[];
}

// ---------------------------------------------------------------------------
// reference-data-mfe
// ---------------------------------------------------------------------------

export interface ReferenceDataMfeProps extends BaseMfeProps {
  permissions?: readonly string[];
}

// ---------------------------------------------------------------------------
// actors-mfe
// ---------------------------------------------------------------------------

/**
 * ⚠️ actors-mfe no encaja en el patrón de los otros 8 (verificado 2026-10-14):
 *
 * - expone el `App` desde `src/ui/App.tsx`, no desde `src/App.tsx`;
 * - no usa `FC<Props>` sino `function App(props: AppProps = {})`;
 * - **no tiene Module Federation**: su `vite.config.ts` no declara `@originjs/vite-plugin-federation`,
 *   ni `exposes`, ni `remoteEntry.js`. El `import('actorsMfe/App')` del shell no puede
 *   resolverse hoy.
 *
 * Por eso **no declara `basePath`**: sin federation no hay contrato de host que cumplir.
 * Adicionalmente, su `CompetencySelector` es un componente pasado por prop, un patrón de
 * render-prop que ningún otro MFE usa.
 */
export interface ActorsMfeProps {
  /** Componente selector de competencias. PascalCase porque es un elemento, no un valor. */
  CompetencySelector?: unknown;
  canManageCompetencies?: boolean;
}

// ---------------------------------------------------------------------------
// document-mfe
// ---------------------------------------------------------------------------

/**
 * Su `App` está declarado `FC<DocumentMfeProps>` pero **no acepta ni destructura
 * parámetros**: es `() => {}`. Reduce a la forma base.
 */
export interface DocumentMfeProps extends BaseMfeProps {}

// ---------------------------------------------------------------------------
// monitoring-mfe
// ---------------------------------------------------------------------------

/**
 * Forma del cliente HTTP de monitoring.
 *
 * ⚠️ Deliberadamente **no** es el `HttpClient` de este paquete. El de monitoring es un
 * puerto propio (`request<T>(req: HttpRequest)`, con un objeto) y el de aquí una clase con
 * campos privados (`request<T>(path: string)`). Al ser nominalmente tipada, una no
 * satisface a la otra. Declarar aquí la firma real del puerto de monitoring es lo correcto;
 * unificar ambos clientes es trabajo de otro repo.
 */
export interface MonitoringHttpClientContract {
  request<TResponse>(request: unknown): Promise<TResponse>;
}

export interface MonitoringMfeProps extends BaseMfeProps {
  httpClient?: MonitoringHttpClientContract;
  /** Catálogos de KPI que el shell entrega (tipos en `monitoring-catalogs`, opacos aquí). */
  catalogs?: {
    kpiTypes: unknown[];
    kpiStatuses: unknown[];
  };
  /** Contexto del usuario. Sin identidad de instructor ni capacidades = sin permiso. */
  user?: {
    instructorId?: string;
    capabilities?: readonly string[];
  };
  /** Ficha elegida en academic-management-mfe (HU-MON-007). */
  fichaId?: string;
  fichaLabel?: string;
  /** Solo modo independiente sin shell. */
  fichaOptions?: { id: string; label: string }[];
}

// ---------------------------------------------------------------------------
// audit-mfe
// ---------------------------------------------------------------------------

/** Igual que document-mfe: `App` declarado `FC<AuditMfeProps>` pero es `() => {}`. */
export interface AuditMfeProps extends BaseMfeProps {}