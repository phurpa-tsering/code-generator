/**
 * Clients other API tools offer that @readme/httpsnippet doesn't ship:
 * Python's standard-library http.client and Dart's package:http.
 */

const headerEntries = (request: any): [string, string][] =>
  Object.entries(request.allHeaders || {})
    .filter(([name]) => !(request.postData?.mimeType === 'multipart/form-data' && name.toLowerCase() === 'content-type'))
    .map(([name, value]) => [name, Array.isArray(value) ? value.join(', ') : String(value)]);

// JSON string literals are valid Python string literals.
const pyStr = (s: string) => JSON.stringify(s);

export const pythonHttpClientClient = {
  info: {
    key: 'http_client',
    title: 'http.client',
    link: 'https://docs.python.org/3/library/http.client.html',
    description: "Python's standard-library HTTP client",
    extname: '.py',
  },
  convert: (request: any) => {
    const https = request.uriObj.protocol === 'https:';
    const lines = ['import http.client', ''];
    lines.push(`conn = http.client.${https ? 'HTTPSConnection' : 'HTTPConnection'}(${pyStr(request.uriObj.host)})`, '');

    const text: string | undefined = request.postData?.text;
    if (text) lines.push(`payload = ${pyStr(text)}`, '');

    // multipart text carries its own boundary, so keep the content-type that names it
    const headers = Object.entries(request.allHeaders || {}).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v)]);
    if (headers.length) {
      lines.push('headers = {');
      headers.forEach(([k, v]) => lines.push(`    ${pyStr(k)}: ${pyStr(v)},`));
      lines.push('}', '');
    }

    const args = [pyStr(request.method), pyStr(request.uriObj.path || '/')];
    args.push(text ? 'payload' : 'None');
    if (headers.length) args.push('headers');
    lines.push(`conn.request(${args.join(', ')})`);
    lines.push('res = conn.getresponse()', 'data = res.read()', '', 'print(data.decode("utf-8"))');
    return lines.join('\n');
  },
};

const dartStr = (s: string) =>
  `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\$/g, '\\$').replace(/\r/g, '\\r').replace(/\n/g, '\\n')}'`;

export const dartHttpClient = {
  info: {
    key: 'http',
    title: 'http',
    link: 'https://pub.dev/packages/http',
    description: 'Composable, Future-based HTTP library for Dart',
    extname: '.dart',
    installation: () => 'dart pub add http',
  },
  convert: (request: any) => {
    const multipart = request.postData?.mimeType === 'multipart/form-data';
    const form = request.postData?.mimeType === 'application/x-www-form-urlencoded';
    const lines = ["import 'package:http/http.dart' as http;", '', 'void main() async {'];

    const headers = headerEntries(request).filter(([name]) => !(form && name.toLowerCase() === 'content-type'));
    if (headers.length) {
      lines.push('  var headers = {');
      headers.forEach(([k, v]) => lines.push(`    ${dartStr(k)}: ${dartStr(v)},`));
      lines.push('  };');
    }

    const ctor = multipart ? 'http.MultipartRequest' : 'http.Request';
    lines.push(`  var request = ${ctor}(${dartStr(request.method)}, Uri.parse(${dartStr(request.fullUrl)}));`);

    const params: any[] = request.postData?.params || [];
    if (multipart) {
      const fields = params.filter((p) => p.fileName === undefined);
      if (fields.length) {
        lines.push('  request.fields.addAll({');
        fields.forEach((p) => lines.push(`    ${dartStr(p.name)}: ${dartStr(p.value ?? '')},`));
        lines.push('  });');
      }
      params
        .filter((p) => p.fileName !== undefined)
        .forEach((p) => lines.push(`  request.files.add(await http.MultipartFile.fromPath(${dartStr(p.name)}, ${dartStr(p.fileName)}));`));
    } else if (form && params.length) {
      lines.push('  request.bodyFields = {');
      params.forEach((p) => lines.push(`    ${dartStr(p.name)}: ${dartStr(p.value ?? '')},`));
      lines.push('  };');
    } else if (request.postData?.text) {
      lines.push(`  request.body = ${dartStr(request.postData.text)};`);
    }

    if (headers.length) lines.push('  request.headers.addAll(headers);');
    lines.push(
      '',
      '  http.StreamedResponse response = await request.send();',
      '',
      '  if (response.statusCode == 200) {',
      '    print(await response.stream.bytesToString());',
      '  } else {',
      '    print(response.reasonPhrase);',
      '  }',
      '}',
    );
    return lines.join('\n');
  },
};
