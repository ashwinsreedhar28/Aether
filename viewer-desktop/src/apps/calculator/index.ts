import type { AppDefinition } from '../types';
import { createLazyApp } from '../AppWrapper';

const CalculatorApp = createLazyApp(() => import('./Calculator').then(m => ({ default: m.Calculator })));

export const app: AppDefinition = {
  id: 'calculator',
  name: 'Calculator',
  icon: 'Calculator',
  component: CalculatorApp,
  defaultSize: { width: 320, height: 480 },
};
