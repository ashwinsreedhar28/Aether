import type { AppDefinition } from '../types';
import { createLazyApp } from '../AppWrapper';

const StocksApp = createLazyApp(() => import('./StocksApp').then((m) => ({ default: m.StocksApp })));

export const app: AppDefinition = {
  id: 'stocks',
  name: 'Stocks',
  icon: 'TrendingUp',
  component: StocksApp,
  defaultSize: { width: 480, height: 620 },
};
