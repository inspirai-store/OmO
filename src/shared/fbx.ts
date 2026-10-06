// Increment when the FBX preview parser changes, so an old failed thumbnail
// receives one new attempt without repeatedly retrying unchanged bad files.
export const FBX_PREVIEW_VERSION = 2;

// The grid and service must make the same retry decision. Otherwise an old
// renderer-side failure flag can prevent the upgraded parser being requested.
export function canRequestThumbnail(
  extension: string,
  metadata: Record<string, unknown>,
): boolean {
  return (
    !metadata.thumbnailError ||
    (extension === ".fbx" &&
      metadata.thumbnailErrorVersion !== FBX_PREVIEW_VERSION)
  );
}

/**
 * Three's ASCII FBX parser uses tab indentation to track nodes. Some exporters
 * emit inconsistent indentation and a trailing comma on the final array line.
 * Normalize that syntax in memory, using braces outside strings/comments as
 * the structure. Preserve numbers, strings, paths and the hosted original.
 * Binary FBX and other formats pass through without decoding/re-encoding.
 */
export function normalizeFBX(buffer: ArrayBuffer): ArrayBuffer {
  const bytes = new Uint8Array(buffer);
  if (
    new TextDecoder().decode(bytes.subarray(0, 23)) ===
    "Kaydara FBX Binary  \0\x1a\0"
  )
    return buffer;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return buffer;
  }
  if (!/^\s*FBXVersion:\s*\d+/m.test(text)) return buffer;

  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
  const nodes: { array: boolean; lastValue?: number }[] = [];
  const output: string[] = [];
  for (const line of lines) {
    const { code, structure } = unquotedCode(line.trimStart());
    if (!code.trim()) {
      output.push(line);
      continue;
    }
    const body = code.trimEnd();
    if (structure.trim() === "}") {
      const node = nodes.pop();
      if (!node) throw new Error("FBX 文本的括号结构不完整");
      if (node.array && node.lastValue !== undefined) {
        // A terminal comma makes Three retain a string instead of a numeric
        // array. Remove only the delimiter at the end of the complete array.
        output[node.lastValue] = output[node.lastValue].replace(/,\s*$/, "");
      }
      output.push("\t".repeat(nodes.length) + body);
    } else if (/^\w+:.*\{\s*$/.test(structure)) {
      if (nodes.length >= 512) throw new Error("FBX 文本嵌套层数过多");
      output.push("\t".repeat(nodes.length) + body);
      nodes.push({ array: /^\w+:\s*\*\d+\s*\{$/.test(body) });
    } else {
      const node = nodes.at(-1);
      const continuation = node?.array && /^[+\-.\d]/.test(body);
      const arrayValue = node?.array && /^a:\s*[+\-.\d]/.test(body);
      if (continuation || arrayValue) node!.lastValue = output.length;
      // Three recognizes wrapped array values only at column zero.
      output.push((continuation ? "" : "\t".repeat(nodes.length)) + body);
    }
  }
  if (nodes.length) throw new Error("FBX 文本的括号结构不完整");
  const normalized = output.join("\n");
  return normalized === text
    ? buffer
    : new TextEncoder().encode(normalized).buffer;
}

function unquotedCode(line: string): { code: string; structure: string } {
  let quoted = false;
  let escaped = false;
  let structure = "";
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      structure += " ";
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') {
      quoted = true;
      structure += " ";
    } else if (char === ";") {
      return { code: line.slice(0, i), structure };
    } else structure += char;
  }
  return { code: line, structure };
}
