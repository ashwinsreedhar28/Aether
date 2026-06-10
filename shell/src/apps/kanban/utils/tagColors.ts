const TAG_COLORS = [
  { bg: 'rgba(107, 124, 255, 0.2)', border: '#6b7cff', text: '#a5b4fc' },
  { bg: 'rgba(78, 197, 255, 0.2)', border: '#4ec5ff', text: '#7dd3fc' },
  { bg: 'rgba(109, 227, 182, 0.2)', border: '#6de3b6', text: '#86efac' },
  { bg: 'rgba(245, 199, 107, 0.2)', border: '#f5c76b', text: '#fcd34d' },
  { bg: 'rgba(243, 139, 160, 0.2)', border: '#f38ba0', text: '#fda4af' },
  { bg: 'rgba(156, 136, 255, 0.2)', border: '#9c88ff', text: '#c4b5fd' },
  { bg: 'rgba(244, 114, 182, 0.2)', border: '#f472b6', text: '#f9a8d4' },
  { bg: 'rgba(45, 212, 191, 0.2)', border: '#2dd4bf', text: '#5eead4' },
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

export function getTagColor(tag: string) {
  const index = hashString(tag.toLowerCase()) % TAG_COLORS.length;
  return TAG_COLORS[index];
}

export function getAllUniqueTags(columns: Array<{ cards: Array<{ tags?: string[] }> }>): string[] {
  const tagSet = new Set<string>();
  columns.forEach(col => {
    col.cards.forEach(card => {
      card.tags?.forEach(tag => tagSet.add(tag));
    });
  });
  return Array.from(tagSet).sort();
}
