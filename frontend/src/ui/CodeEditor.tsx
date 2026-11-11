import { useMemo, useRef } from 'react';

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  filePath: string;
  className?: string;
  onSave?: () => void;
}

function languageFor(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase();
  if (extension === 'tsx' || extension === 'ts') return 'TypeScript';
  if (extension === 'jsx' || extension === 'js') return 'JavaScript';
  if (extension === 'py') return 'Python';
  if (extension === 'json') return 'JSON';
  if (extension === 'md') return 'Markdown';
  return 'Text';
}

export function CodeEditor({ value, onChange, filePath, className = '', onSave }: CodeEditorProps) {
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const lineCount = useMemo(() => Math.max(1, value.split('\n').length), [value]);

  return (
    <div className={`flex min-h-0 flex-col overflow-hidden bg-[#FAF7F2] ${className}`}>
      <div className="flex items-center justify-between border-b border-ink/10 bg-white/70 px-3 py-1.5 text-[10px] font-mono text-ink/50">
        <span>{languageFor(filePath)} · {lineCount} lines</span>
        <span>Tab inserts spaces · Ctrl/Cmd+S saves checkpoint</span>
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          aria-hidden="true"
          className="select-none overflow-hidden border-r border-ink/10 bg-ink/5 px-3 py-4 text-right font-mono text-xs leading-relaxed text-ink/35"
        >
          {Array.from({ length: lineCount }, (_, index) => (
            <div key={index}>{index + 1}</div>
          ))}
        </div>
        <textarea
          ref={editorRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Tab') {
              event.preventDefault();
              const target = event.currentTarget;
              const start = target.selectionStart;
              const end = target.selectionEnd;
              const next = `${value.slice(0, start)}  ${value.slice(end)}`;
              onChange(next);
              requestAnimationFrame(() => {
                target.selectionStart = start + 2;
                target.selectionEnd = start + 2;
              });
            }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
              event.preventDefault();
              onSave?.();
            }
          }}
          spellCheck={false}
          wrap="off"
          className="min-h-full min-w-0 flex-1 resize-none overflow-auto bg-transparent p-4 font-mono text-xs leading-relaxed text-ink/90 outline-none"
          aria-label={`Edit ${filePath}`}
        />
      </div>
    </div>
  );
}
