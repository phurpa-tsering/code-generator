import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { PluginContext } from '@voiden/sdk/ui';
import { buildRequestModel, type RequestModel } from '../lib/buildRequest';
import { getRestSections, getSectionIndexAtCursor, type RequestSection } from '../lib/sections';
import { DEFAULT_LANGUAGE_ID, generateSnippet, getLanguageOptions } from '../lib/snippets';

const LANGUAGE_KEY = 'voiden-code-generator:language';
const RESOLVE_KEY = 'voiden-code-generator:resolve';

const readPref = (key: string): string | null => {
  try { return localStorage.getItem(key); } catch { return null; }
};
const writePref = (key: string, value: string) => {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
};

// The host editor only ships a few grammars and falls back to JavaScript,
// which reads well enough for the C-family languages most clients use.
const editorLang = (languageId: string) => {
  const target = languageId.split(':')[0];
  if (target === 'python' || target === 'csharp') return target;
  if (target === 'http') return 'text';
  return 'javascript';
};

// Styled with the app's theme variables, so the modal follows the active theme
// without depending on which Tailwind classes the host build includes. Classes
// are prefixed to stay out of the host's way.
const CSS = `
.vcg-backdrop { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(0,0,0,0.5); backdrop-filter: blur(2px); animation: vcg-fade 120ms ease-out; }
.vcg-frame { width: 100%; max-width: 920px; height: min(680px, 88vh); display: flex; flex-direction: column; background: var(--modal-bg, var(--ui-bg)); color: var(--ui-fg); border: 1px solid var(--ui-line); border-radius: 10px; overflow: hidden; box-shadow: 0 24px 64px rgba(0,0,0,0.45); animation: vcg-rise 160ms ease-out; font-size: 13px; }
.vcg-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 14px 16px 12px; background: var(--modal-header-bg, var(--ui-panel-bg)); border-bottom: 1px solid var(--ui-line); }
.vcg-title { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; }
.vcg-title svg { color: var(--icon-secondary); }
.vcg-endpoint { display: flex; align-items: center; gap: 8px; margin-top: 6px; min-width: 0; font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 12px; color: var(--icon-secondary); }
.vcg-endpoint span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vcg-method { flex-shrink: 0; padding: 1px 6px; border-radius: 4px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.03em; }
.vcg-icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: none; border-radius: 6px; background: transparent; color: var(--icon-secondary); cursor: pointer; }
.vcg-icon-btn:hover { background: var(--ui-hover); color: var(--ui-fg); }
.vcg-toolbar { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px 16px; padding: 12px 16px; border-bottom: 1px solid var(--ui-line); }
.vcg-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.vcg-label { font-size: 11px; font-weight: 500; color: var(--icon-secondary); }
.vcg-select-wrap { position: relative; }
.vcg-select-wrap svg { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); pointer-events: none; color: var(--icon-secondary); }
.vcg-select { appearance: none; -webkit-appearance: none; height: 30px; min-width: 220px; max-width: 320px; padding: 0 28px 0 10px; border: 1px solid var(--ui-line); border-radius: 6px; background: var(--ui-panel-bg); color: var(--ui-fg); font-size: 12.5px; cursor: pointer; }
.vcg-select:hover { border-color: var(--icon-secondary); }
.vcg-select:focus-visible, .vcg-switch:focus-visible, .vcg-copy:focus-visible, .vcg-icon-btn:focus-visible { outline: 2px solid var(--button-primary-bg, #409fff); outline-offset: 1px; }
.vcg-spacer { flex: 1; }
.vcg-toggle { display: flex; align-items: center; gap: 8px; height: 30px; font-size: 12.5px; cursor: pointer; user-select: none; }
.vcg-switch { position: relative; width: 30px; height: 17px; flex-shrink: 0; border: none; border-radius: 999px; padding: 0; background: var(--ui-line); cursor: pointer; transition: background 120ms; }
.vcg-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 13px; height: 13px; border-radius: 50%; background: var(--ui-fg); transition: transform 120ms; }
.vcg-switch[aria-checked="true"] { background: var(--button-primary-bg, #409fff); }
.vcg-switch[aria-checked="true"]::after { transform: translateX(13px); background: #fff; }
.vcg-body { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 10px; padding: 12px 16px 16px; }
.vcg-panel { flex: 1; min-height: 0; display: flex; flex-direction: column; border: 1px solid var(--ui-line); border-radius: 8px; overflow: hidden; background: var(--code-bg, var(--ui-bg)); }
.vcg-panel-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; height: 36px; padding: 0 6px 0 12px; background: var(--ui-panel-bg); border-bottom: 1px solid var(--ui-line); font-size: 12px; color: var(--icon-secondary); }
.vcg-file { display: flex; align-items: center; gap: 6px; font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); }
.vcg-copy { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border: 1px solid transparent; border-radius: 6px; background: var(--button-primary-bg, #409fff); color: #fff; font-size: 12px; font-weight: 600; cursor: pointer; transition: background 120ms, color 120ms; }
.vcg-copy:hover { background: var(--button-primary-hover, var(--button-primary-bg, #409fff)); }
.vcg-copy:disabled { opacity: 0.5; cursor: default; }
.vcg-copy[data-copied="true"] { background: color-mix(in srgb, var(--icon-success, #87d96c) 18%, transparent); border-color: color-mix(in srgb, var(--icon-success, #87d96c) 45%, transparent); color: var(--icon-success, #87d96c); }
.vcg-kbd { padding: 0 4px; border-radius: 3px; background: rgba(255,255,255,0.18); font-size: 10.5px; font-weight: 500; }
.vcg-editor { flex: 1; min-height: 0; overflow: auto; }
.vcg-pre { flex: 1; margin: 0; overflow: auto; padding: 12px 14px; font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 12.5px; line-height: 1.55; white-space: pre; tab-size: 2; color: var(--code-fg, var(--ui-fg)); }
.vcg-warnings { display: flex; flex-direction: column; gap: 4px; padding: 8px 12px; border: 1px solid color-mix(in srgb, var(--icon-warning, #ffcc66) 35%, transparent); border-radius: 8px; background: color-mix(in srgb, var(--icon-warning, #ffcc66) 8%, transparent); font-size: 12px; line-height: 1.45; }
.vcg-warnings div { display: flex; gap: 8px; }
.vcg-warnings svg { flex-shrink: 0; margin-top: 2px; color: var(--icon-warning, #ffcc66); }
.vcg-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 32px; text-align: center; color: var(--icon-secondary); }
.vcg-empty strong { color: var(--ui-fg); font-size: 14px; }
@keyframes vcg-fade { from { opacity: 0; } }
@keyframes vcg-rise { from { opacity: 0; transform: translateY(6px) scale(0.99); } }
`;

const Icon = {
  code: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m16 18 6-6-6-6M8 6l-6 6 6 6" /></svg>,
  close: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>,
  chevron: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>,
  copy: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>,
  check: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>,
  file: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>,
  warning: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4M12 17h.01" /></svg>,
};

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

const MethodBadge: React.FC<{ method: string }> = ({ method }) => {
  const m = method.toLowerCase();
  return (
    <span className="vcg-method" style={{ color: `var(--http-${m}, var(--ui-fg))`, background: `var(--http-${m}-bg, var(--ui-hover))` }}>
      {method}
    </span>
  );
};

const Select: React.FC<React.SelectHTMLAttributes<HTMLSelectElement> & { selectRef?: React.Ref<HTMLSelectElement> }> = ({ selectRef, children, ...props }) => (
  <div className="vcg-select-wrap">
    <select ref={selectRef} className="vcg-select" {...props}>{children}</select>
    {Icon.chevron}
  </div>
);

interface Props {
  context: PluginContext;
  onClose: () => void;
}

export const CodeGeneratorModal: React.FC<Props> = ({ context, onClose }) => {
  const editor = useMemo(() => context.project.getActiveEditor?.('voiden'), [context]);
  const CodeEditor = context.ui?.components?.CodeEditor;
  const sections: RequestSection[] = useMemo(() => {
    try { return editor?.getJSON ? getRestSections(editor.getJSON()) : []; } catch { return []; }
  }, [editor]);

  const languages = useMemo(() => getLanguageOptions(), []);
  const groups = useMemo(() => {
    const byLanguage = new Map<string, typeof languages>();
    languages.forEach((l) => byLanguage.set(l.language, [...(byLanguage.get(l.language) || []), l]));
    return [...byLanguage.entries()];
  }, [languages]);

  const [sectionIndex, setSectionIndex] = useState<number>(() => {
    const atCursor = getSectionIndexAtCursor(editor);
    return sections.find((sec) => sec.index === atCursor)?.index ?? sections[0]?.index ?? 0;
  });
  const [languageId, setLanguageId] = useState<string>(() => {
    const saved = readPref(LANGUAGE_KEY);
    return saved && languages.some((l) => l.id === saved) ? saved : DEFAULT_LANGUAGE_ID;
  });
  const [resolveVariables, setResolveVariables] = useState<boolean>(() => readPref(RESOLVE_KEY) === 'true');
  const [model, setModel] = useState<RequestModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const languageRef = useRef<HTMLSelectElement>(null);

  const language = languages.find((l) => l.id === languageId);

  useEffect(() => { languageRef.current?.focus(); }, []);

  useEffect(() => {
    const section = sections.find((sec) => sec.index === sectionIndex);
    if (!section) return;
    let cancelled = false;
    setError(null);
    buildRequestModel(context, section.doc, { resolveVariables })
      .then((m) => { if (!cancelled) setModel(m); })
      .catch((err) => { if (!cancelled) setError(`Couldn't read this request: ${err?.message || err}`); });
    return () => { cancelled = true; };
  }, [context, sections, sectionIndex, resolveVariables]);

  const code = useMemo(() => {
    if (!model) return '';
    try { return generateSnippet(model, languageId); } catch (err: any) { return `// Couldn't generate ${languageId}: ${err?.message || err}`; }
  }, [model, languageId]);

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      (context.ui as any)?.showToast?.("Couldn't copy to the clipboard", 'error');
    }
  };

  // Esc closes; ⌘/Ctrl+Enter copies without reaching for the mouse.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); copy(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const toggleResolve = () => {
    setResolveVariables((v) => { writePref(RESOLVE_KEY, String(!v)); return !v; });
  };

  const fileName = language ? `${language.client}${language.extname ?? ''}` : '';

  return (
    <div className="vcg-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <style>{CSS}</style>
      <div className="vcg-frame" role="dialog" aria-modal="true" aria-labelledby="vcg-title">
        <div className="vcg-header">
          <div style={{ minWidth: 0 }}>
            <div className="vcg-title" id="vcg-title">{Icon.code}Generate code</div>
            {model && (
              <div className="vcg-endpoint">
                <MethodBadge method={model.method} />
                <span title={model.url}>{model.url || '(no URL)'}</span>
              </div>
            )}
          </div>
          <button className="vcg-icon-btn" onClick={onClose} title="Close (Esc)" aria-label="Close">{Icon.close}</button>
        </div>

        {sections.length === 0 ? (
          <div className="vcg-empty">
            <strong>No REST request in this file</strong>
            <span>Add one with <code>/endpoint</code>, then open Generate code again.</span>
          </div>
        ) : (
          <>
            <div className="vcg-toolbar">
              <label className="vcg-field">
                <span className="vcg-label">Language</span>
                <Select
                  selectRef={languageRef}
                  value={languageId}
                  onChange={(e) => { setLanguageId(e.target.value); writePref(LANGUAGE_KEY, e.target.value); }}
                >
                  {groups.map(([name, options]) => (
                    <optgroup key={name} label={name}>
                      {options.map((o) => (
                        <option key={o.id} value={o.id}>{options.length > 1 ? `${name} – ${o.clientTitle}` : name}</option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              </label>

              {sections.length > 1 && (
                <label className="vcg-field">
                  <span className="vcg-label">Request</span>
                  <Select value={sectionIndex} onChange={(e) => setSectionIndex(Number(e.target.value))}>
                    {sections.map((sec) => <option key={sec.index} value={sec.index}>{sec.label}</option>)}
                  </Select>
                </label>
              )}

              <span className="vcg-spacer" />

              <div className="vcg-toggle" onClick={toggleResolve} title="Replace {{variables}} with values from the active environment">
                <button
                  type="button"
                  role="switch"
                  aria-checked={resolveVariables}
                  aria-label="Resolve variables"
                  className="vcg-switch"
                  onClick={(e) => { e.stopPropagation(); toggleResolve(); }}
                />
                <span>Resolve variables</span>
              </div>
            </div>

            <div className="vcg-body">
              <div className="vcg-panel">
                <div className="vcg-panel-bar">
                  <span className="vcg-file">{Icon.file}{fileName}</span>
                  <button
                    className="vcg-copy"
                    data-copied={copied}
                    onClick={copy}
                    disabled={!code || !!error}
                    title={`Copy (${isMac ? '⌘' : 'Ctrl'}+Enter)`}
                  >
                    {copied ? <>{Icon.check}Copied</> : <>{Icon.copy}Copy <span className="vcg-kbd">{isMac ? '⌘↵' : 'Ctrl+↵'}</span></>}
                  </button>
                </div>
                {CodeEditor && model && !error ? (
                  <div className="vcg-editor">
                    <CodeEditor readOnly lang={editorLang(languageId)} value={code} />
                  </div>
                ) : (
                  <pre className="vcg-pre">{error ?? (model ? code : 'Generating…')}</pre>
                )}
              </div>

              {(model?.warnings.length ?? 0) > 0 && (
                <div className="vcg-warnings">
                  {model!.warnings.map((w) => <div key={w}>{Icon.warning}<span>{w}</span></div>)}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
