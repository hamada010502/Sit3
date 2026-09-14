/**
 * VESTIPHOBIA — multipart/form-data parsing.
 *
 * The only form on the site that isn't a plain URL-encoded POST is the admin
 * image upload, so this is a small, purpose-built parser rather than a
 * dependency: read the whole body (already size-capped by the caller), split
 * it on the boundary, and pull headers/content out of each part. Works
 * entirely on Buffers so binary file content is never passed through a
 * string encoding that could corrupt it.
 */

const CRLF = Buffer.from('\r\n');

function splitBuffer(buf, needle) {
  const parts = [];
  let start = 0;
  for (;;) {
    const idx = buf.indexOf(needle, start);
    if (idx === -1) {
      parts.push(buf.subarray(start));
      break;
    }
    parts.push(buf.subarray(start, idx));
    start = idx + needle.length;
  }
  return parts;
}

/** Parse the `Content-Type: multipart/form-data; boundary=...` header. */
export function parseBoundary(contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(String(contentType || ''));
  const boundary = m && (m[1] || m[2]);
  return boundary ? boundary.trim() : null;
}

/**
 * @returns {{ fields: Record<string,string>, files: Array<{name:string, filename:string, contentType:string, data:Buffer}> }}
 */
export function parseMultipart(body, boundary) {
  const fields = {};
  const files = [];
  const delimiter = Buffer.from(`--${boundary}`);

  const segments = splitBuffer(body, delimiter);
  for (const raw of segments) {
    // Each real part starts with \r\n right after the boundary and ends with
    // \r\n before the next boundary; the first and last segments (before the
    // opening boundary and after the closing `--`) are not parts.
    if (raw.length < 4) continue;
    let part = raw;
    if (part.subarray(0, 2).equals(CRLF)) part = part.subarray(2);
    if (part.subarray(-2).equals(CRLF)) part = part.subarray(0, part.length - 2);
    if (part.length === 0 || part.subarray(0, 2).toString() === '--') continue;

    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd === -1) continue;
    const headerText = part.subarray(0, headerEnd).toString('utf8');
    const content = part.subarray(headerEnd + 4);

    const dispositionMatch = /Content-Disposition:\s*form-data;\s*(.+)/i.exec(headerText);
    if (!dispositionMatch) continue;
    const params = {};
    for (const m of dispositionMatch[1].matchAll(/(\w+)="([^"]*)"/g)) params[m[1]] = m[2];
    const name = params.name;
    if (!name) continue;

    const contentTypeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headerText);

    if (params.filename !== undefined) {
      if (!params.filename) continue; // an empty file input submits a filename-less part
      files.push({
        name,
        filename: params.filename,
        contentType: contentTypeMatch ? contentTypeMatch[1].trim() : 'application/octet-stream',
        data: content,
      });
    } else {
      fields[name] = content.toString('utf8');
    }
  }

  return { fields, files };
}

/** Read a request body into one Buffer, capped at `max` bytes. */
export function readRawBody(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let aborted = false;
    req.on('data', (c) => {
      if (aborted) return;
      size += c.length;
      if (size > max) {
        aborted = true;
        chunks.length = 0;
        req.pause();
        reject(Object.assign(new Error('Upload too large'), { status: 413 }));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!aborted) resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}
