/**
 * Code Generator Plugin
 *
 * Adds "Generate code" to a .void file's Actions menu. It opens a modal that
 * turns the request under the cursor into code for the language picked there.
 */

import type { PluginContext } from '@voiden/sdk/ui';
import React from 'react';
import { CodeGeneratorModal } from './components/CodeGeneratorModal';

// The community installer rewrites every quoted 'react-dom' / 'react-dom/client'
// string in the bundle to a shim file path, including plain lookup keys, so
// build the keys at runtime to keep them out of its reach.
// (No piece may equal a specifier on its own, 'react' included.)
const REACT_DOM = ['reac', 't-dom'].join('');
const REACT_DOM_CLIENT = ['reac', 't-dom/client'].join('');

const createModalRoot = (el: HTMLElement) => {
  const shims = (window as any).__voiden_shims__ || {};
  const createRoot = shims[REACT_DOM_CLIENT]?.createRoot ?? shims[REACT_DOM]?.createRoot;
  if (createRoot) return createRoot(el);
  const ReactDOM = shims[REACT_DOM];
  return {
    render: (node: React.ReactNode) => ReactDOM.render(node, el),
    unmount: () => ReactDOM.unmountComponentAtNode(el),
  };
};

const codeGeneratorPlugin = (context: PluginContext) => {
  let host: HTMLElement | null = null;
  let root: any = null;

  const close = () => root?.render(null);

  // The Actions menu unmounts its items when it closes, so the modal gets its
  // own root on document.body instead of living inside the menu item.
  const open = () => {
    if (!host) {
      host = document.createElement('div');
      host.id = 'voiden-code-generator-root';
      document.body.appendChild(host);
      root = createModalRoot(host);
    }
    const modal = <CodeGeneratorModal key={Date.now()} context={context} onClose={close} />;
    // The host CodeEditor reads environments through react-query, and this
    // root sits outside the app's provider, so hand it the app's client.
    const shims = (window as any).__voiden_shims__ || {};
    const QueryClientProvider = shims['@tanstack/react-query']?.QueryClientProvider;
    const client = shims['@/main']?.getQueryClient?.();
    root.render(QueryClientProvider && client ? <QueryClientProvider client={client}>{modal}</QueryClientProvider> : modal);
  };

  const GenerateCodeAction = () => (
    <button
      onClick={open}
      title="Generate code for this request"
      style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', background: 'transparent', border: 'none', color: 'inherit', fontSize: 12, padding: 0, cursor: 'pointer' }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m16 18 6-6-6-6M8 6l-6 6 6 6" />
      </svg>
      <span>Generate code</span>
    </button>
  );

  return {
    onload: () => {
      context.registerEditorAction({
        id: 'code-generator-action',
        component: GenerateCodeAction,
        predicate: (tab: any) => Boolean(tab?.title?.endsWith('.void') || tab?.source?.endsWith('.void')),
      });
    },
    onunload: () => {
      root?.unmount();
      host?.remove();
      host = null;
      root = null;
    },
  };
};

export default codeGeneratorPlugin;
