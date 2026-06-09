export function isKanbanFile(path: string): boolean {
  const name = path.split('/').pop()?.toLowerCase() || '';
  // Support both: *.kanban (new) and kb_*.json (legacy)
  return name.endsWith('.kanban') || (name.startsWith('kb_') && name.endsWith('.json'));
}

export function isApiFile(path: string): boolean {
  const name = path.split('/').pop()?.toLowerCase() || '';
  return name.endsWith('.api');
}
