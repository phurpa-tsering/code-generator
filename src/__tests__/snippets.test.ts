import { describe, expect, it } from 'vitest';
import type { RequestModel } from '../lib/buildRequest';
import { DEFAULT_LANGUAGE_ID, generateSnippet, getLanguageOptions } from '../lib/snippets';

const base: RequestModel = {
  method: 'POST',
  url: '{{baseUrl}}/customers/{{customerId}}',
  headers: [
    { key: 'Authorization', value: 'Bearer {{token}}' },
    { key: 'Content-Type', value: 'application/json' },
  ],
  query: [{ key: 'expand', value: '{{expand}}' }],
  body: { kind: 'text', mimeType: 'application/json', text: '{\n  "email": "{{email}}",\n  "name": "Jane O\'Neil $5"\n}' },
  warnings: [],
};

const languages = getLanguageOptions();

describe('getLanguageOptions', () => {
  it('lists real languages only, with JavaScript fetch as the default', () => {
    expect(languages.some((l) => l.id === DEFAULT_LANGUAGE_ID)).toBe(true);
    expect(languages.some((l) => l.target === 'agent' || l.target === 'json')).toBe(false);
    for (const id of ['python:requests', 'python:http_client', 'go:native', 'java:okhttp', 'php:guzzle', 'ruby:native', 'csharp:httpclient', 'swift:urlsession', 'kotlin:okhttp', 'rust:reqwest', 'dart:http', 'shell:curl']) {
      expect(languages.map((l) => l.id)).toContain(id);
    }
  });
});

describe('generateSnippet', () => {
  it.each(languages.map((l) => l.id))('%s keeps {{variables}} and leaves no tokens', (id) => {
    const code = generateSnippet(base, id);
    expect(code).not.toMatch(/vdnvar\d+z/);
    expect(code).not.toContain('http://{{baseUrl}}');
    expect(code).toContain('{{token}}');
    expect(code).toContain('{{email}}');
  });

  it('JavaScript fetch puts the base-url variable first, unprefixed', () => {
    const code = generateSnippet(base, 'javascript:fetch');
    expect(code).toContain("{{baseUrl}}/customers/{{customerId}}?expand={{expand}}");
    expect(code).toContain("Authorization: 'Bearer {{token}}'");
  });

  it('adds a scheme to scheme-less URLs that are not variables', () => {
    expect(generateSnippet({ ...base, url: 'localhost:3000/x' }, 'javascript:fetch')).toContain('http://localhost:3000/x');
  });

  it('builds form and multipart bodies', () => {
    const form = generateSnippet({ ...base, headers: [], body: { kind: 'form', params: [{ key: 'a', value: '1' }] } }, 'python:requests');
    expect(form).toContain('payload = { "a": "1" }');
    const multipart = generateSnippet({ ...base, headers: [], body: { kind: 'multipart', params: [{ key: 'f', value: '/tmp/a.png', file: true }, { key: 'n', value: 'x' }] } }, 'dart:http');
    expect(multipart).toContain("http.MultipartFile.fromPath('f', '/tmp/a.png')");
    expect(multipart).toContain("'n': 'x'");
    expect(multipart).not.toContain('content-type');
  });

  it('escapes Dart strings', () => {
    expect(generateSnippet(base, 'dart:http')).toContain("O\\'Neil \\$5");
  });
});
