import { useState, useCallback, useEffect } from 'react';
import type { Bookmark } from '../types';
import { BOOKMARKS_STORAGE_KEY, DEFAULT_BOOKMARKS } from '../constants';

function generateId(): string {
  return `bookmark-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function loadBookmarks(): Bookmark[] {
  try {
    const stored = localStorage.getItem(BOOKMARKS_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to load bookmarks:', e);
  }

  // Return default bookmarks for first-time users
  return DEFAULT_BOOKMARKS.map(b => ({
    id: generateId(),
    title: b.title,
    url: b.url,
    createdAt: Date.now(),
  }));
}

function saveBookmarks(bookmarks: Bookmark[]): void {
  try {
    localStorage.setItem(BOOKMARKS_STORAGE_KEY, JSON.stringify(bookmarks));
  } catch (e) {
    console.error('Failed to save bookmarks:', e);
  }
}

export function useBookmarks() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(() => loadBookmarks());

  // Save whenever bookmarks change
  useEffect(() => {
    saveBookmarks(bookmarks);
  }, [bookmarks]);

  const addBookmark = useCallback((title: string, url: string, favicon?: string) => {
    const newBookmark: Bookmark = {
      id: generateId(),
      title: title || url,
      url,
      favicon,
      createdAt: Date.now(),
    };
    setBookmarks(prev => [...prev, newBookmark]);
    return newBookmark;
  }, []);

  const removeBookmark = useCallback((id: string) => {
    setBookmarks(prev => prev.filter(b => b.id !== id));
  }, []);

  const updateBookmark = useCallback((id: string, updates: Partial<Omit<Bookmark, 'id' | 'createdAt'>>) => {
    setBookmarks(prev => prev.map(b =>
      b.id === id ? { ...b, ...updates } : b
    ));
  }, []);

  const isBookmarked = useCallback((url: string) => {
    return bookmarks.some(b => b.url === url);
  }, [bookmarks]);

  const getBookmarkByUrl = useCallback((url: string) => {
    return bookmarks.find(b => b.url === url);
  }, [bookmarks]);

  return {
    bookmarks,
    addBookmark,
    removeBookmark,
    updateBookmark,
    isBookmarked,
    getBookmarkByUrl,
  };
}
