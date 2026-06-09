import type { editor } from 'monaco-editor';

const editors = new Set<editor.IStandaloneCodeEditor>();

export function registerEditor(instance: editor.IStandaloneCodeEditor): void {
  editors.add(instance);
}

export function unregisterEditor(instance: editor.IStandaloneCodeEditor): void {
  editors.delete(instance);
}

export function findEditor(
  container?: Element | null
): editor.IStandaloneCodeEditor | undefined {
  for (const ed of editors) {
    const domNode = ed.getDomNode();
    if (!domNode) continue;

    if (container) {
      if (container.contains(domNode) || domNode.contains(container as Node)) {
        return ed;
      }
    } else {
      if (ed.hasTextFocus()) {
        return ed;
      }
    }
  }
  return undefined;
}
