import React from 'react';

/**
 * Renders question / answer text with Python code awareness.
 * - Fenced ``` or ```python blocks render as a styled <pre><code> with
 *   preserved indentation and horizontal scroll.
 * - Inline `code` renders in monospace.
 * - Plain text renders normally with whitespace preserved (so manual
 *   indentation survives even outside fenced blocks).
 */
export function CodeAwareText({ text, className = '' }: { text: string; className?: string }) {
  if (!text) return null;

  // Split on fenced code blocks ```lang? ... ```
  const parts: Array<{ kind: 'text' | 'code'; content: string; lang?: string }> = [];
  const re = /```(\w+)?\n?([\s\S]*?)```/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) parts.push({ kind: 'text', content: text.slice(lastIdx, m.index) });
    parts.push({ kind: 'code', content: m[2].replace(/\n$/, ''), lang: m[1] || 'python' });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) parts.push({ kind: 'text', content: text.slice(lastIdx) });
  if (parts.length === 0) parts.push({ kind: 'text', content: text });

  return (
    <div className={`space-y-2 ${className}`}>
      {parts.map((p, i) => {
        if (p.kind === 'code') {
          return (
            <pre
              key={i}
              className="bg-slate-950 text-emerald-200 rounded-xl p-3.5 overflow-x-auto text-[11.5px] leading-relaxed font-mono whitespace-pre border border-slate-800"
              aria-label={`${p.lang || 'code'} code block`}
            >
              <code>{p.content}</code>
            </pre>
          );
        }
        // Render inline `code` and preserve manual indentation.
        const segs = p.content.split(/(`[^`\n]+`)/g);
        return (
          <p key={i} className="whitespace-pre-wrap break-words">
            {segs.map((s, j) =>
              s.startsWith('`') && s.endsWith('`') && s.length > 1 ? (
                <code
                  key={j}
                  className="px-1.5 py-0.5 rounded-md bg-slate-100 border border-slate-200 font-mono text-[0.9em] text-slate-800"
                >
                  {s.slice(1, -1)}
                </code>
              ) : (
                <React.Fragment key={j}>{s}</React.Fragment>
              )
            )}
          </p>
        );
      })}
    </div>
  );
}

export default CodeAwareText;