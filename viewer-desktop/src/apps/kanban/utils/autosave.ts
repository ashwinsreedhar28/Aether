type SaveCallback = () => Promise<void>;

let saveTimeout: ReturnType<typeof setTimeout> | null = null;
let pendingSave: SaveCallback | null = null;

export function debouncedAutoSave(
  callback: SaveCallback,
  delay: number = 1000
): void {
  pendingSave = callback;

  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }

  saveTimeout = setTimeout(async () => {
    if (pendingSave) {
      try {
        await pendingSave();
      } catch (e) {
        console.error('Autosave failed:', e);
      }
      pendingSave = null;
    }
  }, delay);
}

export function cancelPendingSave(): void {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  pendingSave = null;
}

export function flushPendingSave(): Promise<void> {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  if (pendingSave) {
    const save = pendingSave;
    pendingSave = null;
    return save();
  }
  return Promise.resolve();
}
