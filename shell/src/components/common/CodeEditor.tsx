import { useRef, useEffect } from 'react';
import { Editor, type Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { getLanguageFromPath } from '../../utils/languageDetection';
import { registerEditor, unregisterEditor } from '../../utils/monacoEditorRegistry';

interface CodeEditorProps {
  filePath: string;
  value: string;
  onChange?: (value: string | undefined) => void;
  readOnly?: boolean;
  isActive?: boolean;
}

export function CodeEditor({ filePath, value, onChange, readOnly = false, isActive }: CodeEditorProps) {
  const language = getLanguageFromPath(filePath);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  const handleEditorMount = (editor: editor.IStandaloneCodeEditor, _monaco: Monaco) => {
    editorRef.current = editor;
    registerEditor(editor);
    // Note: Cmd/Ctrl+Arrow window navigation shortcuts are handled at the
    // Electron main process level via 'before-input-event', which intercepts
    // these keys before they reach Monaco. No special handling needed here.
  };

  // Focus editor when tab becomes active
  useEffect(() => {
    if (isActive && editorRef.current) {
      editorRef.current.focus();
    }
  }, [isActive]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (editorRef.current) {
        unregisterEditor(editorRef.current);
      }
    };
  }, []);

  return (
    <div className="h-full w-full">
      <Editor
        theme="hc-black"
        language={language}
        value={value}
        onChange={onChange}
        onMount={handleEditorMount}
        options={{
          readOnly,
          minimap: { enabled: true },
          fontSize: 14,
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          automaticLayout: true,
          folding: true,
          foldingStrategy: 'indentation',
          bracketPairColorization: { enabled: true },
          padding: { top: 16, bottom: 16 },
          smoothScrolling: true,
          cursorBlinking: 'smooth',
          cursorSmoothCaretAnimation: 'on',
          renderWhitespace: 'selection',
          guides: {
            indentation: true,
            bracketPairs: true,
          },
          // Holographic theme colors
          colorDecorators: true,
          matchBrackets: 'always',
        }}
        loading={
          <div className="flex items-center justify-center h-full text-[var(--holo-muted)]">
            Loading editor...
          </div>
        }
      />
    </div>
  );
}
