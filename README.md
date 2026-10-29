# Code Generator

Generate code for any REST request in a `.void` file. Closes [#622](https://github.com/VoidenHQ/voiden/issues/622).

## Use it

1. Open a `.void` file and put the cursor in the request you want.
2. Open **Actions (☰) → Generate code**.
3. Pick a language in the modal. JavaScript (fetch) is the default, and your last choice is remembered.
4. Copy the code with **Copy** or ⌘/Ctrl+Enter.

In a file with several requests, the modal starts on the one under the cursor and has a **Request** picker to switch.

**Resolve variables** is off by default, so `{{variables}}` stay as placeholders and secrets don't end up in pasted code. Turn it on to fill them in from the active environment.

## Languages

21 languages and 38 clients, covering every language Postman's code generator offers:

C, C#, Clojure, Crystal, Dart, Go, HTTP, Java, JavaScript, Kotlin, Node.js, Objective-C, OCaml, PHP, PowerShell, Python, R, Ruby, Rust, Shell (cURL, HTTPie, wget), and Swift.

Most come from [`@readme/httpsnippet`](https://github.com/readmeio/httpsnippet). Python `http.client` and Dart `http` are added in [`src/lib/extraClients.ts`](src/lib/extraClients.ts).

## What it reads

It builds the same request as **Copy as cURL**:

- method, URL and path params
- headers and cookies
- query params
- bearer, basic and API-key auth, plus auth that other plugins add through the cURL header extenders (OAuth2 and others)
- JSON, XML, YAML, form and multipart bodies
- linked blocks

The REST body readers are vendored from `voiden-rest-api` in [`src/lib/requestBuilder.ts`](src/lib/requestBuilder.ts). Keep that file in sync when REST block types change.

## Limits

- **REST requests only.** GraphQL, WebSocket and gRPC aren't supported.
- **Binary file bodies** show a placeholder, with a note to send the file's bytes.
- **Auth that cURL sends as a flag** (Digest, NTLM, AWS SigV4) can't be written as plain headers. The modal says so instead of dropping it silently.
- **Highlighting** comes from the app's own code editor, which has grammars for JavaScript, Python and C# only. Other languages use JavaScript highlighting, and raw HTTP is shown as plain text.
- **Unresolved base URLs in split-host clients.** Python `http.client` and raw HTTP put the host on its own line. With **Resolve variables** off, that line shows `{{baseUrl}}`.

## Install

Download `code-generator.zip` from the [latest release](../../releases/latest), then in Voiden choose **Extensions → ⋯ → Install from file**.

## Build

```bash
npm install
npm run build   # dist/code-generator.js
npm test
npm run zip     # dist/code-generator.zip, install with Extensions → ⋯ → Install from file
```
