export interface BrowserState {
  url: string;
  displayUrl: string;
  isLoading: boolean;
  loadProgress: number;
  canGoBack: boolean;
  canGoForward: boolean;
  title: string;
  isSecure: boolean;
}

export interface Bookmark {
  id: string;
  title: string;
  url: string;
  favicon?: string;
  createdAt: number;
}

export interface WebViewRef {
  loadURL: (url: string) => void;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  stop: () => void;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  getURL: () => string;
  getTitle: () => string;
  openDevTools: () => void;
  isDevToolsOpened: () => boolean;
  closeDevTools: () => void;
}
