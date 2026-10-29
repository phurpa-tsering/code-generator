/**
 * Turn a RequestModel into code with @readme/httpsnippet.
 *
 * {{variables}} are swapped for plain tokens before conversion and restored
 * after, so they survive URL parsing and each language's string escaping.
 */

import { HTTPSnippet, addTarget, addTargetClient, availableTargets } from '@readme/httpsnippet';
import type { RequestModel } from './buildRequest';
import { dartHttpClient, pythonHttpClientClient } from './extraClients';

export interface LanguageOption {
  /** `${target}:${client}` */
  id: string;
  target: string;
  client: string;
  language: string;
  clientTitle: string;
  /** File extension for the snippet, e.g. `.js` */
  extname: string | null;
}

export const DEFAULT_LANGUAGE_ID = 'javascript:fetch';

// Not languages: `agent` is an LLM prompt, `json` is the HAR-ish object itself.
const HIDDEN_TARGETS = new Set(['agent', 'json']);

let clientsRegistered = false;
const registerExtraClients = () => {
  if (clientsRegistered) return;
  clientsRegistered = true;
  addTargetClient('python', pythonHttpClientClient as any);
  addTarget({ info: { key: 'dart', title: 'Dart', default: 'http' }, clientsById: { http: dartHttpClient } } as any);
};

export function getLanguageOptions(): LanguageOption[] {
  registerExtraClients();
  return availableTargets()
    .filter((t: any) => !HIDDEN_TARGETS.has(t.key))
    .sort((a: any, b: any) => a.title.localeCompare(b.title))
    .flatMap((t: any) =>
      t.clients.map((c: any) => ({
        id: `${t.key}:${c.key}`,
        target: t.key,
        client: c.key,
        language: t.title,
        clientTitle: c.title,
        extname: c.extname ?? null,
      })),
    );
}

const VARIABLES = /\{\{\s*[^{}]+?\s*\}\}/g;

export function generateSnippet(model: RequestModel, languageId: string): string {
  registerExtraClients();
  const [target, client] = languageId.split(':');

  const originals: string[] = [];
  const mask = (s: string) =>
    s.replace(VARIABLES, (m) => {
      let i = originals.indexOf(m);
      if (i === -1) i = originals.push(m) - 1;
      return `vdnvar${i}z`;
    });

  // A URL that starts with a variable ({{baseUrl}}/users) or has no scheme
  // still has to parse as a URL; give it a stand-in scheme we strip later.
  let url = mask(model.url.trim());
  let schemeStandIn: string | undefined;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    if (/^vdnvar\d+z/.test(url)) schemeStandIn = `http://${url.match(/^vdnvar\d+z/)![0]}`;
    url = `http://${url}`;
  }

  const body = model.body;
  const postData =
    !body ? undefined
    : body.kind === 'text' ? { mimeType: body.mimeType, text: mask(body.text) }
    : body.kind === 'binary' ? { mimeType: body.mimeType, text: `<contents of ${body.path}>` }
    : body.kind === 'form' ? {
        mimeType: 'application/x-www-form-urlencoded',
        params: body.params.map((p) => ({ name: mask(p.key), value: mask(p.value) })),
      }
    : {
        mimeType: 'multipart/form-data',
        params: body.params.map((p) =>
          p.file
            ? { name: mask(p.key), fileName: p.value, ...(p.contentType ? { contentType: p.contentType } : {}) }
            : { name: mask(p.key), value: mask(p.value) },
        ),
      };

  const snippet = new HTTPSnippet({
    method: model.method,
    url,
    httpVersion: 'HTTP/1.1',
    cookies: [],
    headers: model.headers.map((h) => ({ name: mask(h.key), value: mask(h.value) })),
    queryString: model.query.map((q) => ({ name: mask(q.key), value: mask(q.value) })),
    headersSize: -1,
    bodySize: -1,
    ...(postData ? { postData } : {}),
  } as any);

  const converted = snippet.convert(target as any, client);
  let code = Array.isArray(converted) ? converted[0] : converted;
  if (typeof code !== 'string') throw new Error(`No generator for ${languageId}`);

  if (schemeStandIn) code = code.split(schemeStandIn).join(schemeStandIn.slice('http://'.length));
  return code.replace(/vdnvar(\d+)z/g, (m, i) => originals[Number(i)] ?? m);
}
