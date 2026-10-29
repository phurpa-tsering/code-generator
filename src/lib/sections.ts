/**
 * Split a .void editor doc into request sections (root nodes between
 * request-separator nodes) and list the ones that hold a REST request.
 */

import type { JSONContent } from './requestBuilder';

const SEPARATOR_TYPE = 'request-separator';

export interface RequestSection {
  index: number;
  label: string;
  doc: JSONContent;
}

const endpointOf = (nodes: JSONContent[]) =>
  nodes.find((n) => n.type === 'api' || n.type === 'request');

const textOf = (node: JSONContent | undefined, type: string): string =>
  node?.content?.find((n) => n.type === type)?.content?.[0]?.text || '';

export function getRestSections(editorJson: JSONContent): RequestSection[] {
  const sections: { nodes: JSONContent[]; label?: string }[] = [{ nodes: [] }];
  for (const node of editorJson.content || []) {
    if (node.type === SEPARATOR_TYPE) sections.push({ nodes: [], label: node.attrs?.label || undefined });
    else sections[sections.length - 1].nodes.push(node);
  }

  return sections.flatMap((section, index) => {
    const endpoint = endpointOf(section.nodes);
    if (!endpoint) return [];
    const summary = `${textOf(endpoint, 'method') || 'GET'} ${textOf(endpoint, 'url')}`.trim();
    return [{
      index,
      label: section.label ? `${section.label} · ${summary}` : summary,
      doc: { type: 'doc', content: section.nodes },
    }];
  });
}

/** Index of the section containing the editor's cursor. */
export function getSectionIndexAtCursor(editor: any): number {
  const pos = editor?.state?.selection?.from;
  if (typeof pos !== 'number') return 0;
  let sectionIndex = 0;
  editor.state.doc.forEach((child: any, offset: number) => {
    if (child.type.name === SEPARATOR_TYPE && offset < pos) sectionIndex++;
  });
  return sectionIndex;
}
