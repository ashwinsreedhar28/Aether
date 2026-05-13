import type { AppDefinition } from '../../lib/app-definition'
import { News } from './News'

export const app: AppDefinition = {
  id: 'news',
  name: 'News',
  icon: 'Newspaper',
  component: News
}
