import type { AppDefinition } from '../../lib/app-definition'
import { Welcome } from './Welcome'

export const app: AppDefinition = {
  id: 'welcome',
  name: 'Welcome',
  icon: 'Sparkles',
  component: Welcome
}
