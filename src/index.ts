export { HttpClient, HttpError } from './http-client/HttpClient';
export type {
  ApiError,
  FetchLike,
  HttpClientOptions,
  SessionListener,
  SessionState,
  TokenProvider,
} from './http-client/HttpClient';

export { AuthClient } from './auth-client/AuthClient';
export type { AuthClientOptions, Me, Session } from './auth-client/AuthClient';

// HU-007: bus pub/sub para comunicación cross-MFE sin acople directo (ADR-009 §6).
export { EventBus } from './event-bus/EventBus';
export type { EventBusOptions } from './event-bus/EventBus';
export type {
  EventHandler,
  EventName,
  EventPayloads,
  PayloadOf,
  SessionExpiredPayload,
  Unsubscribe,
} from './event-bus/events';

export { ENVIRONMENTS, resolveConfig } from './config/config';
export type { Environment, PlatformConfig } from './config/config';

export type {
  BaseMfeProps,
  IamMfeProps,
  SchedulingMfeProps,
  AcademicManagementMfeProps,
  TrainingEnvironmentMfeProps,
  ReferenceDataMfeProps,
  ActorsMfeProps,
  DocumentMfeProps,
  MonitoringMfeProps,
  AuditMfeProps,
} from './contracts/remote-props';