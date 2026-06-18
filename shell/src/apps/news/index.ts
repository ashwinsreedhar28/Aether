import type { AppDefinition } from '../types';
import { createLazyApp } from '../AppWrapper';

const NewsApp = createLazyApp(() => import('./NewsApp').then((m) => ({ default: m.NewsApp })));

export const app: AppDefinition = {
  id: 'news',
  name: 'News',
  icon: 'Newspaper',
  component: NewsApp,
  defaultSize: { width: 520, height: 640 },
};
