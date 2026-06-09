import type { AppDefinition } from '../types';
import { createLazyApp } from '../AppWrapper';

const ApiManagerApp = createLazyApp(() =>
  import('./ApiManager').then((m) => ({ default: m.ApiManager }))
);

export const app: AppDefinition = {
  id: 'api-manager',
  name: 'API Manager',
  icon: 'Send',
  component: ApiManagerApp,
  fileTypes: ['api'],
  defaultSize: { width: 1200, height: 800 },
};
