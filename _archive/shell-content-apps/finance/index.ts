import type { AppDefinition } from '../../lib/app-definition'
import { Finance } from './Finance'

export const app: AppDefinition = {
  id: 'finance',
  name: 'Finance',
  icon: 'TrendingUp',
  component: Finance,
  // 60: between News (50) and Markdown (70). Order keys gap-spaced per
  // CLAUDE.md §11 #6 so later data apps can insert without renumbering.
  order: 60
}
