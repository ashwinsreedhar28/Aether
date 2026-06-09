/**
 * MCP Inspector
 *
 * Main component for the MCP Inspector app.
 * Allows connecting to MCP servers, viewing tools/resources/prompts,
 * and monitoring JSON-RPC messages.
 */

import { useState, useCallback } from 'react';
import { Wrench, FileText, MessageSquare, Activity } from 'lucide-react';
import type { TabId } from './types';
import { useMcpServers } from './hooks/useMcpServers';
import { useMcpConnection } from './hooks/useMcpConnection';
import { useMcpMessageLog } from './hooks/useMcpMessageLog';
import { ServerList } from './components/ServerList';
import { ToolsPanel } from './components/ToolsPanel';
import { ResourcesPanel } from './components/ResourcesPanel';
import { PromptsPanel } from './components/PromptsPanel';
import { MessageLog } from './components/MessageLog';

const tabs: { id: TabId; label: string; icon: typeof Wrench }[] = [
  { id: 'tools', label: 'Tools', icon: Wrench },
  { id: 'resources', label: 'Resources', icon: FileText },
  { id: 'prompts', label: 'Prompts', icon: MessageSquare },
  { id: 'messages', label: 'Messages', icon: Activity },
];

export function McpInspector() {
  const [activeTab, setActiveTab] = useState<TabId>('tools');
  const [messageLogExpanded, setMessageLogExpanded] = useState(false);

  // Hooks for server management
  const {
    servers,
    loading: serversLoading,
    error: serversError,
    selectedServerId,
    selectedServer,
    selectServer,
    startServer,
    stopServer,
    restartServer,
    reloadSettings,
  } = useMcpServers();

  // Hook for connection data
  const {
    tools,
    resources,
    prompts,
    loading: connectionLoading,
    callTool,
    readResource,
    getPrompt,
  } = useMcpConnection(selectedServer);

  // Hook for message logging
  const {
    filteredMessages,
    filter,
    setFilter,
    clearMessages,
    setServerFilter,
  } = useMcpMessageLog();

  // Filter messages by selected server
  const handleSelectServer = useCallback(
    (serverId: string | null) => {
      selectServer(serverId);
      setServerFilter(serverId);
    },
    [selectServer, setServerFilter]
  );

  const isServerRunning = selectedServer?.status === 'running';

  // Render tab content
  const renderTabContent = () => {
    switch (activeTab) {
      case 'tools':
        return (
          <ToolsPanel
            tools={tools}
            onCallTool={callTool}
            loading={connectionLoading}
            serverRunning={isServerRunning}
          />
        );
      case 'resources':
        return (
          <ResourcesPanel
            resources={resources}
            onReadResource={readResource}
            loading={connectionLoading}
            serverRunning={isServerRunning}
          />
        );
      case 'prompts':
        return (
          <PromptsPanel
            prompts={prompts}
            onGetPrompt={getPrompt}
            loading={connectionLoading}
            serverRunning={isServerRunning}
          />
        );
      case 'messages':
        return (
          <div className="h-full flex items-center justify-center text-gray-500">
            <div className="text-center">
              <Activity className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Messages are shown in the panel below</p>
              <p className="text-xs text-gray-600 mt-1">
                All JSON-RPC traffic is logged automatically
              </p>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="h-full flex flex-col bg-[rgba(15,15,25,0.95)]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--holo-accent)]/20">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-[var(--holo-accent)]" />
          <h1 className="text-lg font-medium text-[var(--holo-text)]">MCP Inspector</h1>
        </div>
        {serversError && (
          <span className="text-xs text-red-400">{serversError}</span>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        {/* Sidebar: Server list */}
        <div className="w-56 border-r border-[var(--holo-accent)]/20 flex-shrink-0">
          <ServerList
            servers={servers}
            selectedServerId={selectedServerId}
            onSelectServer={handleSelectServer}
            onStartServer={startServer}
            onStopServer={stopServer}
            onRestartServer={restartServer}
            onReload={reloadSettings}
            loading={serversLoading}
          />
        </div>

        {/* Main panel */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Tabs */}
          <div className="flex items-center border-b border-[var(--holo-accent)]/20">
            {tabs.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 px-4 py-2.5 text-sm transition-colors ${
                    isActive
                      ? 'text-[var(--holo-accent)] border-b-2 border-[var(--holo-accent)]'
                      : 'text-gray-400 hover:text-[var(--holo-text)]'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Tab content */}
          <div className={`flex-1 overflow-hidden ${messageLogExpanded ? 'hidden' : ''}`}>
            {renderTabContent()}
          </div>

          {/* Message log (always visible at bottom) */}
          <MessageLog
            messages={filteredMessages}
            filter={filter}
            onFilterChange={setFilter}
            onClear={clearMessages}
            expanded={messageLogExpanded}
            onToggleExpanded={() => setMessageLogExpanded(!messageLogExpanded)}
          />
        </div>
      </div>
    </div>
  );
}
