import type { AppDefinition } from '../../lib/app-definition'
import { VoiceControl } from './VoiceControl'

export const app: AppDefinition = {
  id: 'voice-control',
  name: 'Voice',
  icon: 'Mic',
  component: VoiceControl,
  // 80: between News (50) and the mesh app slot (90, reserved). Gap-leaving
  // per CLAUDE.md §11 heuristic 6.
  order: 80
}
