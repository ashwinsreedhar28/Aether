import type { AppDefinition } from '../../lib/app-definition'
import { MarkdownViewer } from './MarkdownViewer'

export const app: AppDefinition = {
  id: 'markdown',
  name: 'Markdown',
  icon: 'FileText',
  component: MarkdownViewer,
  order: 70,
  fileTypes: ['md', 'markdown']
}
