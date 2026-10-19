export type Environment = 'develop' | 'qa' | 'staging' | 'main';

export interface PlatformConfig {
  environment: Environment;
  gatewayBaseUrl: string;
}

export const ENVIRONMENTS: Record<Environment, PlatformConfig> = {
  develop: { environment: 'develop', gatewayBaseUrl: '/api/v1' },
  qa: { environment: 'qa', gatewayBaseUrl: 'https://qa.api.sena.edu.co/api/v1' },
  staging: { environment: 'staging', gatewayBaseUrl: 'https://staging.api.sena.edu.co/api/v1' },
  main: { environment: 'main', gatewayBaseUrl: 'https://api.sena.edu.co/api/v1' },
};

const isEnvironment = (value: string): value is Environment =>
  Object.prototype.hasOwnProperty.call(ENVIRONMENTS, value);

export const resolveConfig = (mode: string | undefined): PlatformConfig => {
  const candidate = mode ?? 'develop';
  return ENVIRONMENTS[isEnvironment(candidate) ? candidate : 'develop'];
};