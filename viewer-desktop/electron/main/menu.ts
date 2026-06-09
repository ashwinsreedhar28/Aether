import { app, Menu, BrowserWindow, type MenuItemConstructorOptions } from 'electron';

export function createApplicationMenu(
  mainWindow: BrowserWindow,
  onOpenFolder: () => void,
  onAddFolder: () => void
): Menu {
  const isMac = process.platform === 'darwin';

  const template: MenuItemConstructorOptions[] = [
    // App menu (macOS only)
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),

    // File menu
    {
      label: 'File',
      submenu: [
        {
          label: 'New Project...',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => {
            mainWindow.webContents.send('menu:new-project');
          },
        },
        { type: 'separator' },
        {
          label: 'Open Folder...',
          accelerator: 'CmdOrCtrl+O',
          click: onOpenFolder,
        },
        {
          label: 'Add Folder to Workspace...',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: onAddFolder,
        },
        { type: 'separator' },
        {
          label: 'Close Workspace',
          accelerator: 'CmdOrCtrl+Shift+W',
          click: () => {
            mainWindow.webContents.send('menu:close-workspace');
          },
        },
        // On Mac, Quit is in the app menu. On Windows/Linux, add it here.
        ...(isMac ? [] : [{ type: 'separator' as const }, { role: 'quit' as const }]),
      ],
    },

    // Edit menu
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' as const },
              { role: 'delete' as const },
              { role: 'selectAll' as const },
            ]
          : [
              { role: 'delete' as const },
              { type: 'separator' as const },
              { role: 'selectAll' as const },
            ]),
      ],
    },

    // View menu
    {
      label: 'View',
      submenu: [
        {
          label: 'Command Palette',
          accelerator: 'CmdOrCtrl+P',
          click: () => {
            mainWindow.webContents.send('menu:open-search');
          },
        },
        {
          label: 'Toggle File Explorer',
          accelerator: 'CmdOrCtrl+E',
          click: () => {
            mainWindow.webContents.send('menu:toggle-explorer');
          },
        },
        { type: 'separator' },
        {
          label: 'Tile Windows',
          accelerator: 'CmdOrCtrl+T',
          click: () => {
            mainWindow.webContents.send('menu:tile-windows');
          },
        },
        {
          label: 'Maximize Window',
          accelerator: 'CmdOrCtrl+M',
          click: () => {
            mainWindow.webContents.send('menu:maximize-window');
          },
        },
        { type: 'separator' },
        {
          label: 'Layout: Focus',
          accelerator: 'Ctrl+1',
          click: () => {
            mainWindow.webContents.send('menu:layout-preset', 'focus');
          },
        },
        {
          label: 'Layout: Split',
          accelerator: 'Ctrl+2',
          click: () => {
            mainWindow.webContents.send('menu:layout-preset', 'split');
          },
        },
        {
          label: 'Layout: Thirds',
          accelerator: 'Ctrl+3',
          click: () => {
            mainWindow.webContents.send('menu:layout-preset', 'thirds');
          },
        },
        {
          label: 'Layout: Quarters',
          accelerator: 'Ctrl+4',
          click: () => {
            mainWindow.webContents.send('menu:layout-preset', 'quarters');
          },
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },

    // Terminal menu
    {
      label: 'Terminal',
      submenu: [
        {
          label: 'New Terminal',
          accelerator: 'CmdOrCtrl+`',
          click: () => {
            mainWindow.webContents.send('menu:new-terminal');
          },
        },
      ],
    },

    // Window menu
    {
      label: 'Window',
      submenu: [
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            mainWindow.webContents.send('menu:close-tab');
          },
        },
        { type: 'separator' },
        {
          label: 'Previous Tab',
          accelerator: 'CmdOrCtrl+[',
          click: () => {
            mainWindow.webContents.send('menu:prev-tab');
          },
        },
        {
          label: 'Next Tab',
          accelerator: 'CmdOrCtrl+]',
          click: () => {
            mainWindow.webContents.send('menu:next-tab');
          },
        },
        { type: 'separator' },
        {
          label: 'Focus Window Above',
          accelerator: 'CmdOrCtrl+Up',
          click: () => {
            mainWindow.webContents.send('menu:focus-up');
          },
        },
        {
          label: 'Focus Window Below',
          accelerator: 'CmdOrCtrl+Down',
          click: () => {
            mainWindow.webContents.send('menu:focus-down');
          },
        },
        {
          label: 'Focus Window Left',
          accelerator: 'CmdOrCtrl+Left',
          click: () => {
            mainWindow.webContents.send('menu:focus-left');
          },
        },
        {
          label: 'Focus Window Right',
          accelerator: 'CmdOrCtrl+Right',
          click: () => {
            mainWindow.webContents.send('menu:focus-right');
          },
        },
        { type: 'separator' },
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const },
              { type: 'separator' as const },
              { role: 'window' as const },
            ]
          : []),
      ],
    },

    // AI menu
    {
      label: 'AI',
      submenu: [
        {
          label: 'Claude Command Palette',
          accelerator: 'CmdOrCtrl+/',
          click: () => {
            mainWindow.webContents.send('menu:open-claude-palette');
          },
        },
      ],
    },

    // Help menu
    {
      role: 'help',
      submenu: [
        {
          label: 'Learn More',
          click: async () => {
            const { shell } = await import('electron');
            await shell.openExternal('https://github.com');
          },
        },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}
