# design-software-frontend-platform

Fachada transversal para los repos de frontend. Es el único lugar permitido para `fetch`, `localStorage`, configuración de ambientes y comunicación entre MFEs.

## Responsabilidades

- `http-client`: URL base por ambiente, cabeceras, `x-required-feature`, errores 401/403/429/500, `trace_id` y refresh single-flight.
- `auth-client`: login, logout, `GET /auth/me`, sesión y claims de roles/features.
- `event-bus`: eventos entre shell y remotes; no permite acoplar un remote con otro.
- `config`: ambiente activo, URLs del edge/BFF y flags.
- `contracts/remote-props.ts`: interfaces de props que cada MFE debe implementar.

## Regla

Los MFEs no llaman `fetch` directamente, no leen `localStorage` directamente y no definen su propio cliente HTTP.

## EventBus (HU-007)

Bus pub/sub para que los MFEs se comuniquen sin importarse entre sí. ADR-009 §1 mantiene
este paquete framework-agnóstico, así que **no usa React**: es una clase plana que se pasa
por las opciones del constructor, igual que `tokenProvider` u `onUnauthorized`.

```ts
import { EventBus } from '@sena/frontend-platform';

const bus = new EventBus();

const stop = bus.subscribe('session-expired', ({ attempts }) => {
  console.warn('sesión muerta tras', attempts, '401');
});

// En el cleanup del componente, para no dejar la referencia colgada.
stop();
```

### El catálogo de eventos está tipado

E4 de la HU pide que un nombre mal escrito falle en build, no en runtime:

```ts
export interface EventPayloads {
  'session-expired': SessionExpiredPayload;
}
```

`subscribe('sesion-expirada', …)` no compila. Añadir un evento es añadir una clave a ese
mapa. Hoy hay **un solo evento**, a propósito: la HU pide no diseñar un catálogo
especulativo de eventos que nadie usa todavía.

### `session-expired` no se publica en el primer 401

El `HttpClient` reintenta una vez tras un 401 porque ese primer 401 es el token vencido,
que el refresh resuelve solo. Publicar ahí expulsaría al usuario a login cada vez que el
token expira.

El evento sale solo cuando la sesión no se recupera:

| Situación | ¿Publica? |
|---|---|
| 401 → refresh ok → reintento 200 | ❌ |
| 401 → refresh ok → reintento 401 | ✅ `attempts: 2` |
| 401 → refresh lanza | ✅ `attempts: 1` |
| 403, 404, 500 | ❌ |

### Sobre el Context de React

La HU pedía "inyectado vía React Context", pero eso contradice ADR-009 §1 y el paquete no
tiene React. Quien necesite un Context (por ejemplo el shell para propagar el bus por el
árbol) lo monta en su capa, no aquí.

## Estado

| Capa | Estado | HU |
|---|---|---|
| `http-client` | ✅ | previa |
| `auth-client` | ✅ | previa |
| `event-bus` | ✅ | `HU-007` |
| `config` | ✅ | previa |
| `contracts/remote-props.ts` | ✅ | `HU-008` (parcial) |

## Pendiente conocido

ADR-009 §6 dice que *"ningún MFE llama `fetch` directo"*, pero hoy lo hacen: 16 llamadas en
`scheduling-mfe`, 4 en `academic-management-mfe`, 2 en `document-mfe`. Por eso los 401 de
esos MFEs **no pasan por el `HttpClient`** y no emiten `session-expired`. Until que migren al
`HttpClient`, la redirección por sesión expirada solo cubre el shell.