import type { Terminal } from '@xterm/xterm';

const terminals = new Set<Terminal>();

export function registerTerminal(instance: Terminal): void {
  terminals.add(instance);
}

export function unregisterTerminal(instance: Terminal): void {
  terminals.delete(instance);
}

export function findTerminal(
  container?: Element | null
): Terminal | undefined {
  for (const term of terminals) {
    const domNode = term.element;
    if (!domNode) continue;

    if (container) {
      if (container.contains(domNode) || domNode.contains(container as Node)) {
        return term;
      }
    } else {
      if (domNode.ownerDocument.activeElement && domNode.contains(domNode.ownerDocument.activeElement)) {
        return term;
      }
    }
  }
  return undefined;
}
