/**
 * Build a language-neutral request model from a section-scoped .void doc.
 *
 * Mirrors voiden-rest-api's generateCurlFromJson / generateCurlFromRequestObject
 * so the generated code sends the same request that "Copy as cURL" does.
 */

import type { PluginContext } from '@voiden/sdk/ui';
import { buildBodyParams, buildContentType, buildRequestBody, extractBinary, type JSONContent } from './requestBuilder';

export interface KV {
  key: string;
  value: string;
}

export interface MultipartField extends KV {
  file?: boolean;
  contentType?: string;
}

export type RequestBody =
  | { kind: 'text'; mimeType: string; text: string }
  | { kind: 'form'; params: KV[] }
  | { kind: 'multipart'; params: MultipartField[] }
  | { kind: 'binary'; mimeType: string; path: string };

export interface RequestModel {
  method: string;
  url: string;
  headers: KV[];
  query: KV[];
  body?: RequestBody;
  warnings: string[];
}

const VARIABLE = /\{\{\s*[^{}]+?\s*\}\}/;

const enabledRows = (rows: any[] | undefined): KV[] =>
  (rows || [])
    .filter((r) => r && r.key && (r.enabled === undefined || r.enabled))
    .map((r) => ({ key: String(r.key).trim(), value: r.value == null ? '' : String(r.value).trim() }));

const hasKey = (rows: KV[], key: string) => rows.some((r) => r.key.toLowerCase() === key.toLowerCase());

const resolveAbsoluteFilePath = (filePath: string, activeProject?: string): string => {
  if (!activeProject || !filePath) return filePath;
  const isAbsolute = filePath.startsWith(activeProject) || /^[A-Za-z]:[/\\]/.test(filePath);
  if (isAbsolute) return filePath;
  return activeProject.replace(/[/\\]+$/, '') + '/' + filePath.replace(/^[/\\]+/, '');
};

/** Deep-map every string in a plain value through an async resolver. */
const resolveStrings = async (value: any, resolve: (s: string) => Promise<string>): Promise<any> => {
  if (typeof value === 'string') return VARIABLE.test(value) ? resolve(value) : value;
  if (Array.isArray(value)) return Promise.all(value.map((v) => resolveStrings(v, resolve)));
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) out[k] = await resolveStrings(v, resolve);
    return out;
  }
  return value;
};

export async function buildRequestModel(
  context: PluginContext,
  sectionDoc: JSONContent,
  options: { resolveVariables: boolean },
): Promise<RequestModel> {
  const ctx = context as any;
  const { getTable, parseAuthNode, buildHeadersWithCookies, findNode } = ctx.helpers.requestUtils;
  const warnings: string[] = [];

  let doc = sectionDoc;
  try {
    doc = (await ctx.helpers.expandLinkedBlocksInDoc?.(sectionDoc, { forceRefresh: false })) ?? sectionDoc;
  } catch {
    // Linked blocks unavailable — generate from the section as written.
  }

  const endpoint = findNode(doc, 'api') || findNode(doc, 'request');
  const contentType = buildContentType(doc, getTable, undefined);

  let raw: any = {
    method: endpoint?.content?.find((n: any) => n.type === 'method')?.content?.[0]?.text || 'GET',
    url: endpoint?.content?.find((n: any) => n.type === 'url')?.content?.[0]?.text || '',
    headers: buildHeadersWithCookies(doc, undefined),
    params: getTable('query-table', doc, undefined),
    pathParams: getTable('path-table', doc, undefined),
    contentType,
    bodyParams: await buildBodyParams(doc, contentType),
    binary: extractBinary(doc),
    body: buildRequestBody(doc, getTable, undefined),
    auth: parseAuthNode(doc),
  };

  // Auth types the base reader doesn't handle (OAuth2, Digest, AWS, …) come
  // from the same extenders "Copy as cURL" uses. Explicit rows win.
  const extraFlags: string[] = [];
  try {
    const extenders: readonly any[] = ctx.paste?.getCurlHeaderExtenders?.() ?? [];
    for (const extender of extenders) {
      const result: any = await extender(doc);
      if (result?.warning) warnings.push(result.warning);
      for (const h of result?.headers ?? []) {
        if (h.key && !hasKey(enabledRows(raw.headers), h.key)) raw.headers = [...raw.headers, h];
      }
      for (const p of result?.queryParams ?? []) {
        if (p.key && !hasKey(enabledRows(raw.params), p.key)) raw.params = [...raw.params, p];
      }
      for (const flag of result?.flags ?? []) if (flag) extraFlags.push(flag);
    }
  } catch (err) {
    console.warn('[code-generator] cURL header extenders unavailable:', err);
  }
  if (extraFlags.length > 0) {
    warnings.push(
      `This request's auth needs client-side support that plain headers can't express (cURL uses ${extraFlags
        .map((f) => f.split(' ')[0])
        .join(', ')}). Configure it with your HTTP library's auth options.`,
    );
  }

  if (options.resolveVariables) {
    const replace = (window as any).electron?.env?.replaceVariables;
    if (typeof replace === 'function') {
      raw = await resolveStrings(raw, async (s) => (await replace(s)) ?? s);
    }
  }

  const headers = enabledRows(raw.headers);
  const query = enabledRows(raw.params);

  // Path params: {key} placeholders in the URL. Leave variable values unencoded
  // so their {{…}} survives into the generated code.
  let url: string = raw.url;
  for (const { key, value } of enabledRows(raw.pathParams)) {
    url = url.replace(new RegExp(`\\{${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`, 'g'), VARIABLE.test(value) ? value : encodeURIComponent(value));
  }

  const auth = raw.auth;
  if (auth) {
    const cfg = auth.config || {};
    if (auth.type === 'bearer-token' && cfg.token && !hasKey(headers, 'Authorization')) {
      headers.push({ key: 'Authorization', value: `${cfg.headerPrefix || 'Bearer'} ${cfg.token}` });
    } else if (auth.type === 'basic-auth' && (cfg.username || cfg.password) && !hasKey(headers, 'Authorization')) {
      const creds = `${cfg.username || ''}:${cfg.password || ''}`;
      if (VARIABLE.test(creds)) {
        warnings.push('Basic auth credentials use variables, so the encoded header contains the variable names. Turn on "Resolve variables" to encode the real values.');
      }
      headers.push({ key: 'Authorization', value: `Basic ${btoa(unescape(encodeURIComponent(creds)))}` });
    } else if (auth.type === 'api-key' && cfg.key) {
      if (cfg.in === 'query') query.push({ key: cfg.key, value: cfg.value || '' });
      else if (!hasKey(headers, cfg.key)) headers.push({ key: cfg.key, value: cfg.value || '' });
    }
  }

  let activeProject: string | undefined;
  try {
    activeProject = await context.project.getActiveProject();
  } catch {
    // No project open — leave file paths as written.
  }

  // Body priority mirrors the REST plugin: binary > multipart/form (driven by
  // content type) > body text > body params.
  const ct = String(raw.contentType || '').toLowerCase();
  const bodyParams: any[] = (raw.bodyParams || []).filter((p: any) => p?.key && (p.enabled === undefined || p.enabled));
  const headerContentType = headers.find((h) => h.key.toLowerCase() === 'content-type')?.value;
  let body: RequestBody | undefined;

  const binary = Array.isArray(raw.binary) ? raw.binary[0] : raw.binary;
  if (typeof binary === 'string' && binary) {
    const path = resolveAbsoluteFilePath(binary.replace(/^@/, ''), activeProject);
    body = { kind: 'binary', mimeType: headerContentType || 'application/octet-stream', path };
    warnings.push(`The body is a binary file (${path}). Generated code sends a placeholder; read the file and send its bytes instead.`);
  } else if (ct.includes('multipart') && bodyParams.length > 0) {
    body = {
      kind: 'multipart',
      params: bodyParams.map((p) => ({
        key: p.key,
        value: p.type === 'file' ? resolveAbsoluteFilePath(String(p.value).replace(/^@/, ''), activeProject) : String(p.value ?? ''),
        file: p.type === 'file',
        contentType: p.contentType || p.mimeType,
      })),
    };
  } else if (ct.includes('application/x-www-form-urlencoded') && bodyParams.length > 0) {
    body = { kind: 'form', params: bodyParams.map((p) => ({ key: p.key, value: String(p.value ?? '') })) };
  } else if (typeof raw.body === 'string' && raw.body.trim()) {
    const mimeType = ct.includes('json') ? 'application/json'
      : ct.includes('xml') ? 'application/xml'
      : ct.includes('yaml') ? (ct.includes('x-yaml') ? 'application/x-yaml' : 'application/yaml')
      : headerContentType || 'text/plain';
    body = { kind: 'text', mimeType, text: raw.body };
  } else if (bodyParams.length > 0) {
    body = ct.includes('application/json')
      ? { kind: 'text', mimeType: 'application/json', text: JSON.stringify(Object.fromEntries(bodyParams.map((p) => [p.key, p.value])), null, 2) }
      : { kind: 'form', params: bodyParams.map((p) => ({ key: p.key, value: String(p.value ?? '') })) };
  }

  // Content-Type the way "Copy as cURL" adds it; multipart gets its boundary
  // from the generated client, so never set it by hand there.
  if (body && body.kind !== 'multipart' && !headerContentType) {
    const mime = body.kind === 'form' ? 'application/x-www-form-urlencoded' : body.mimeType;
    if (mime !== 'text/plain' || body.kind === 'binary') headers.push({ key: 'Content-Type', value: mime });
  }

  if (options.resolveVariables) {
    const leftover = new Set<string>();
    const scan = (s: string) => (s.match(/\{\{\s*[^{}]+?\s*\}\}/g) || []).forEach((m) => leftover.add(m));
    scan(url);
    [...headers, ...query].forEach((r) => { scan(r.key); scan(r.value); });
    if (body?.kind === 'text') scan(body.text);
    if (leftover.size > 0) warnings.push(`Couldn't resolve ${[...leftover].join(', ')} in the active environment.`);
  }

  return { method: String(raw.method).toUpperCase(), url, headers, query, body, warnings };
}
