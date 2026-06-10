import { useEffect, useRef, useCallback, useState } from 'react';
import type { WSEvent } from '../types';
import type { FileChangeEvent } from '../types/electron';

type FileChangeCallback = (path: string) => void;
type FileSystemCallback = (event: WSEvent) => void;

interface Subscribers {
  fileChanges: Map<string, Set<FileChangeCallback>>;
  fileSystem: Set<FileSystemCallback>;
}

// Global subscribers shared across all hook instances
const globalSubscribers: Subscribers = {
  fileChanges: new Map(),
  fileSystem: new Set(),
};

// Track if we've set up the IPC listener
let ipcListenerSetup = false;
let ipcCleanup: (() => void) | null = null;

function handleFileChange(event: FileChangeEvent) {
  // Notify file-specific subscribers
  if (event.type === 'file-changed') {
    const callbacks = globalSubscribers.fileChanges.get(event.path);
    if (callbacks) {
      callbacks.forEach(cb => cb(event.path));
    }
  }

  // Notify file system subscribers (for tree refresh)
  globalSubscribers.fileSystem.forEach(cb => cb(event as WSEvent));
}

function setupIpcListener() {
  if (ipcListenerSetup) return;

  ipcCleanup = window.electron.fs.onChange(handleFileChange);
  ipcListenerSetup = true;
}

function teardownIpcListener() {
  if (ipcCleanup) {
    ipcCleanup();
    ipcCleanup = null;
  }
  ipcListenerSetup = false;
}

// Track component instances to manage listener lifecycle
let instanceCount = 0;

export function useFileWatcher() {
  // In Electron, we're always "connected" since IPC is synchronous
  const [connected] = useState(true);

  // Track subscriptions for cleanup
  const fileSubscriptionsRef = useRef<Map<string, FileChangeCallback>>(new Map());
  const fsSubscriptionRef = useRef<FileSystemCallback | null>(null);

  useEffect(() => {
    instanceCount++;

    // Set up IPC listener if this is the first instance
    if (instanceCount === 1) {
      setupIpcListener();
    }

    // Capture the stable subscriptions map for use in cleanup
    const fileSubscriptions = fileSubscriptionsRef.current;

    return () => {
      instanceCount--;

      // Clean up all subscriptions from this instance
      fileSubscriptions.forEach((callback, path) => {
        const callbacks = globalSubscribers.fileChanges.get(path);
        if (callbacks) {
          callbacks.delete(callback);
          if (callbacks.size === 0) {
            globalSubscribers.fileChanges.delete(path);
          }
        }
      });
      fileSubscriptions.clear();

      if (fsSubscriptionRef.current) {
        globalSubscribers.fileSystem.delete(fsSubscriptionRef.current);
        fsSubscriptionRef.current = null;
      }

      // Tear down IPC listener if this was the last instance
      if (instanceCount === 0) {
        teardownIpcListener();
      }
    };
  }, []);

  const subscribeToFile = useCallback((path: string, callback: FileChangeCallback) => {
    // Store in our local tracking
    fileSubscriptionsRef.current.set(path, callback);

    // Add to global subscribers
    if (!globalSubscribers.fileChanges.has(path)) {
      globalSubscribers.fileChanges.set(path, new Set());
    }
    globalSubscribers.fileChanges.get(path)!.add(callback);

    // Return unsubscribe function
    return () => {
      const callbacks = globalSubscribers.fileChanges.get(path);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          globalSubscribers.fileChanges.delete(path);
        }
      }
      fileSubscriptionsRef.current.delete(path);
    };
  }, []);

  const subscribeToFileSystem = useCallback((callback: FileSystemCallback) => {
    // Remove previous subscription if any
    if (fsSubscriptionRef.current) {
      globalSubscribers.fileSystem.delete(fsSubscriptionRef.current);
    }

    fsSubscriptionRef.current = callback;
    globalSubscribers.fileSystem.add(callback);

    // Return unsubscribe function
    return () => {
      globalSubscribers.fileSystem.delete(callback);
      if (fsSubscriptionRef.current === callback) {
        fsSubscriptionRef.current = null;
      }
    };
  }, []);

  return {
    connected,
    subscribeToFile,
    subscribeToFileSystem,
  };
}
