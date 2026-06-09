import { useState } from 'react';
import { Settings as SettingsIcon, Volume2, FolderOpen, Palette, Mic } from 'lucide-react';
import { SoundSettings } from './components/SoundSettings';
import { ProjectsSettings } from './components/ProjectsSettings';
import { AppearanceSettings } from './components/AppearanceSettings';
import { DictationSettings } from './components/DictationSettings';

type Tab = 'sounds' | 'projects' | 'appearance' | 'dictation';

export function Settings() {
  const [activeTab, setActiveTab] = useState<Tab>('sounds');

  const tabs: { id: Tab; label: string; icon: typeof SettingsIcon }[] = [
    { id: 'sounds', label: 'Sounds', icon: Volume2 },
    { id: 'projects', label: 'Projects', icon: FolderOpen },
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'dictation', label: 'Dictation', icon: Mic },
  ];

  return (
    <div className="h-full flex flex-col bg-[rgba(10,10,20,0.95)]">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--holo-border)]">
        <SettingsIcon size={18} className="text-[var(--holo-accent)]" />
        <h1 className="text-sm font-medium text-[var(--holo-text)]">Settings</h1>
      </div>

      {/* Tab navigation */}
      <div className="flex border-b border-[var(--holo-border)]">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm transition-colors relative ${
                activeTab === tab.id
                  ? 'text-[var(--holo-accent)]'
                  : 'text-[var(--holo-muted)] hover:text-[var(--holo-text)]'
              }`}
            >
              <Icon size={14} />
              {tab.label}
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--holo-accent)]" />
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'sounds' && <SoundSettings />}
        {activeTab === 'projects' && <ProjectsSettings />}
        {activeTab === 'appearance' && <AppearanceSettings />}
        {activeTab === 'dictation' && <DictationSettings />}
      </div>
    </div>
  );
}

export default Settings;
