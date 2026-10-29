/**
 * Vendored from voiden-rest-api/src/lib/requestBuilder.ts — the REST body
 * readers aren't exposed by that plugin, and this plugin must build the same
 * body the app sends. Keep in sync when the REST block types change.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type JSONContent = { type?: string; attrs?: Record<string, any>; content?: JSONContent[]; text?: string };

export type RestDoc = { type?: string; content?: JSONContent[] };

interface BodyParam {
  key: string;
  value: string | File | any;
  type?: "text" | "file";
  enabled: boolean;
  omitIfUnresolved?: boolean;
  importedFrom?: string;
}

// ── REST-specific node list ────────────────────────────────────────────────────

export const REST_BLOCK_NODES = [
  "api", "request", "method", "url",
  "headers-table", "query-table", "url-table", "multipart-table",
  "cookies-table", "options-table",
  "json_body", "xml_body", "yml_body",
  "auth", "pre_request_block", "post_request_block",
  "documentation", "restFile",
];

// ── Private helpers ───────────────────────────────────────────────────────────

function stripJsonComments(jsonc: string): string {
  let result = "";
  let i = 0;
  let inString = false;
  let stringChar = "";

  while (i < jsonc.length) {
    const char = jsonc[i];
    const nextChar = jsonc[i + 1];

    if ((char === '"' || char === "'") && (i === 0 || jsonc[i - 1] !== "\\")) {
      if (!inString) { inString = true; stringChar = char; }
      else if (char === stringChar) { inString = false; stringChar = ""; }
      result += char; i++; continue;
    }
    if (inString) { result += char; i++; continue; }

    if (char === "/" && nextChar === "/") {
      i += 2;
      while (i < jsonc.length && jsonc[i] !== "\n" && jsonc[i] !== "\r") i++;
      if (i < jsonc.length && (jsonc[i] === "\n" || jsonc[i] === "\r")) { result += jsonc[i]; i++; }
      continue;
    }
    if (char === "/" && nextChar === "*") {
      i += 2;
      while (i < jsonc.length - 1) { if (jsonc[i] === "*" && jsonc[i + 1] === "/") { i += 2; break; } i++; }
      continue;
    }
    result += char; i++;
  }
  return result;
}

function deepMergeJSON(imported: any, local: any): any {
  if (local === null || typeof local !== "object" || Array.isArray(local)) return local;
  if (imported === null || typeof imported !== "object" || Array.isArray(imported)) return local;
  const result: any = { ...imported };
  for (const key in local) {
    if (local.hasOwnProperty(key)) {
      if (result.hasOwnProperty(key) && typeof result[key] === "object" && !Array.isArray(result[key]) &&
        typeof local[key] === "object" && !Array.isArray(local[key])) {
        result[key] = deepMergeJSON(result[key], local[key]);
      } else {
        result[key] = local[key];
      }
    }
  }
  return result;
}

// ── Exported REST block readers ───────────────────────────────────────────────

/**
 * Map a content-type string to a file extension.
 * Used when a binary file body needs a default extension.
 */
export const getFileExtension = (contentType: string): string => {
  const map: Record<string, string> = {
    "application/json": ".json", "text/plain": ".txt", "application/xml": ".xml",
    "application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg",
    "audio/mpeg": ".mp3", "video/mp4": ".mp4", "text/csv": ".csv",
    "text/html": ".html", "application/zip": ".zip", "application/octet-stream": "",
    "audio/wav": ".wav", "video/webm": ".webm", "image/gif": ".gif",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "text/css": ".css", "application/javascript": ".js",
  };
  return map[contentType] || "";
};

/**
 * Determine the content-type for a REST request from editor nodes and headers.
 * Reads: json_body, xml_body, yml_body, multipart-table, url-table, restFile.
 */
export const buildContentType = (
  doc: RestDoc,
  getTableFn: (type: string, doc: RestDoc, env?: Record<string, string>) => Array<{ key: string; value: string }>,
  environment?: Record<string, string>,
): string => {
  const headersTable = getTableFn("headers-table", doc, environment);
  const ctHeader = headersTable.find((h) => h.key?.toLowerCase() === "content-type");
  const fromHeader = ctHeader?.value?.split(";")[0]?.trim()?.toLowerCase() || "";

  if (fromHeader) {
    if (["application/json", "application/hal+json", "text/json"].includes(fromHeader)) return "application/json";
    if (["application/xml", "text/xml"].includes(fromHeader)) return "application/xml";
    if (["application/x-yaml", "application/yaml", "text/yaml", "text/x-yaml"].includes(fromHeader)) return "application/x-yaml";
  }

  let contentType = "none";
  doc.content?.forEach((node) => {
    if (node.type === "multipart-table") contentType = "multipart/form-data";
    else if (node.type === "url-table") contentType = "application/x-www-form-urlencoded";
    else if (node.type === "json_body") contentType = "application/json";
    else if (node.type === "xml_body") contentType = "application/xml";
    else if (node.type === "yml_body") contentType = "application/x-yaml";
    else if (node.type === "file") contentType = getFileExtension(node.attrs?.extension || "");
  });
  return contentType;
};

/**
 * Extract body params (form fields, multipart entries) from REST editor nodes.
 * Reads: multipart-table, url-table, json_body.
 */
export const buildBodyParams = async (
  doc: RestDoc,
  contentType: string,
): Promise<BodyParam[]> => {
  const nodeType = (() => {
    switch (contentType) {
      case "multipart/form-data": return "multipart-table";
      case "application/x-www-form-urlencoded": return "url-table";
      default: return "json_body";
    }
  })();

  const allBodyParams: BodyParam[] = [];

  for (const node of doc.content || []) {
    if (node.type !== nodeType) continue;
    const importedFrom = node.attrs?.importedFrom;

    for (const bodyNode of node.content || []) {
      if (bodyNode.type !== "table") continue;
      for (const row of bodyNode.content || []) {
        if (row.type !== "tableRow") continue;
        const keyCol = row.content?.[0];
        const valCol = row.content?.[1];
        if (!keyCol || keyCol.type !== "tableCell") continue;
        if (!valCol || valCol.type !== "tableCell") continue;

        const key = ((keyCol.content?.[0]?.content?.[0]?.text) || "").trim();
        let value: string | File | any;
        let type: "text" | "file" = "text";

        if (nodeType === "multipart-table") {
          const enabled = !row.attrs?.disabled;
          const omitIfUnresolved = row.attrs?.omitIfUnresolved === true;
          // Legacy: single file stored directly in cell attrs
          const legacyFilePath = valCol.attrs?.file;
          if (legacyFilePath) {
            if (key) allBodyParams.push({ enabled, omitIfUnresolved, type: "file", key, value: legacyFilePath, importedFrom });
            continue;
          }

          // Find all file nodes in the cell paragraph (supports multiple attachments per row)
          const paragraphContent: JSONContent[] = valCol.content?.[0]?.content || [];
          const fileLinkNodes = paragraphContent.filter(
            (n: JSONContent) => n.type === "fileLink" && n.attrs?.filePath
          );
          const inlineFileNodes = paragraphContent.filter(
            (n: JSONContent) => n.type === "file" && (n.attrs?.filePath || n.attrs?.actualFile)
          );
          const tableFileNodes = paragraphContent.filter(
            (n: JSONContent) => n.type === "table-file" && n.attrs?.file
          );

          const allFileNodes = [
            ...fileLinkNodes.map((n: JSONContent) => n.attrs!.filePath as string),
            ...inlineFileNodes.map((n: JSONContent) => (n.attrs!.filePath || n.attrs!.actualFile) as string),
            ...tableFileNodes.map((n: JSONContent) => n.attrs!.file as string),
          ].filter(Boolean);

          if (allFileNodes.length > 0) {
            // Emit one BodyParam per file — FormData.append handles same-key multi-file natively
            for (const fp of allFileNodes) {
              if (key) allBodyParams.push({ enabled, omitIfUnresolved, type: "file", key, value: fp, importedFrom });
            }
          } else {
            // Plain text value
            const textValue = ((valCol.content?.[0]?.content?.[0]?.text) || "").trim();
            if (key && textValue) allBodyParams.push({ enabled, omitIfUnresolved, type: "text", key, value: textValue, importedFrom });
          }
          continue;
        } else {
          value = ((valCol.content?.[0]?.content?.[0]?.text) || "").trim();
          type = "text";
        }

        if (!key || !value) continue;
        allBodyParams.push({
          enabled: !row.attrs?.disabled,
          omitIfUnresolved: row.attrs?.omitIfUnresolved === true,
          type,
          key,
          value,
          importedFrom,
        });
      }
    }
  }

  // Group by key to resolve import vs local conflicts.
  // File params with the same key are intentional multi-file uploads — keep all.
  // Text params with the same key: local overrides imported (existing behaviour).
  const paramsByKey = allBodyParams.reduce((acc, param) => {
    const list = acc[param.key] || [];
    list.push(param);
    return { ...acc, [param.key]: list };
  }, {} as Record<string, BodyParam[]>);

  return Object.values(paramsByKey).flatMap((params) => {
    const allFile = params.every((p) => p.type === "file");
    if (allFile && params.length > 1) {
      // Multi-file: keep local ones; if all imported, keep all
      const local = params.filter((p) => !(p as any).importedFrom);
      const keep = local.length > 0 ? local : params;
      return keep.map(({ importedFrom, ...rest }: any) => rest);
    }
    // Text or single: local overrides imported
    if (params.length > 1) {
      const local = params.find((p) => !(p as any).importedFrom);
      if (local) { const { importedFrom, ...rest } = local as any; return [rest]; }
    }
    const { importedFrom, ...rest } = params[0] as any;
    return [rest];
  });
};

/**
 * Extract a binary file reference from the restFile node.
 */
export const extractBinary = (doc: RestDoc): File | string | string[] | undefined => {
  const files: (File | string)[] = [];
  doc.content?.forEach((node) => {
    if (node.type === "restFile") {
      node.content?.forEach((child) => {
        if (child.type === "fileLink" && child.attrs?.filePath) files.push(child.attrs.filePath);
        else if (child.type === "file" && child.attrs?.filePath) files.push(child.attrs.filePath);
        else if (child.type === "file" && (child.attrs?.actualFile || child.attrs?.file)) {
          files.push((child.attrs.actualFile as any) || (child.attrs.file as any));
        }
      });
    }
  });
  if (files.length === 0) return undefined;
  if (files.length === 1) return files[0]; // backward compatible — single file unchanged
  return files as string[];               // multiple files — callers handle the array case
};

/**
 * Extract the request body string from REST body nodes (json_body, xml_body, yml_body).
 * Merges imported and local JSON bodies via deep merge.
 */
export const buildRequestBody = (
  doc: RestDoc,
  getTableFn: (type: string, doc: RestDoc, env?: Record<string, string>) => Array<{ key: string; value: string }>,
  environment?: Record<string, string>,
): string => {
  const headerContentType = (() => {
    const headersTable = getTableFn("headers-table", doc, environment);
    const ct = headersTable.find((h) => h.key?.toLowerCase() === "content-type");
    return ct?.value?.split(";")[0]?.trim()?.toLowerCase() || "";
  })();

  const pickBodyNode = (type: "json_body" | "xml_body" | "yml_body") => {
    const nodes = doc.content?.filter((v) => v.type === type);
    if (!nodes?.length) return null;
    return nodes.find((item) => !item.attrs?.importedFrom) || nodes.find((item) => item.attrs?.importedFrom) || null;
  };

  const pickLatestBodyNode = () => {
    const bodyTypes = new Set(["json_body", "xml_body", "yml_body"]);
    for (let i = (doc.content?.length || 0) - 1; i >= 0; i--) {
      const node = doc.content?.[i];
      if (node?.type && bodyTypes.has(node.type)) return node;
    }
    return null;
  };

  let selected: JSONContent | null = null;
  if (["application/json", "application/hal+json", "text/json"].includes(headerContentType)) selected = pickBodyNode("json_body");
  else if (["application/xml", "text/xml"].includes(headerContentType)) selected = pickBodyNode("xml_body");
  else if (["application/x-yaml", "application/yaml", "text/yaml", "text/x-yaml"].includes(headerContentType)) selected = pickBodyNode("yml_body");
  else selected = pickLatestBodyNode();

  if (!selected) selected = pickLatestBodyNode();
  if (!selected) return "";

  if (selected.type === "xml_body" || selected.type === "yml_body") return selected.attrs?.body || "";

  // JSON: deep-merge imported + local bodies
  const all = doc.content?.filter((v: any) => v.type === "json_body") || [];
  const imported = all.filter((v) => v.attrs?.importedFrom);
  const local = all.filter((v) => !v.attrs?.importedFrom);

  if (!all.length) return "";
  if (local.length && !imported.length) return stripJsonComments(local[0].attrs?.body || "");
  if (imported.length && !local.length) return stripJsonComments(imported[0].attrs?.body || "");

  try {
    const mergedJSON = deepMergeJSON(
      JSON.parse(stripJsonComments(imported[0]?.attrs?.body || "{}")),
      JSON.parse(stripJsonComments(local[0]?.attrs?.body || "{}")),
    );
    return JSON.stringify(mergedJSON, null, 2);
  } catch {
    return stripJsonComments(local[0]?.attrs?.body || imported[0]?.attrs?.body || "");
  }
};
