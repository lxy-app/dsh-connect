/**
 * Small dependency-free Markdown parser for chat transcripts.
 *
 * It intentionally covers the subset that DSH assistant replies commonly use
 * (headings, paragraphs, emphasis, links, lists, quotes, fenced code, tables
 * and dividers) and degrades gracefully: unbalanced markers stay literal text,
 * so partially streamed messages never disappear or break the layout.
 *
 * Parsing is split in two stages: `parseMarkdown` builds the block tree and
 * `parseInline` tokenizes the inline content of each block. Keeping this module
 * free of React Native imports makes it cheap to unit test in plain Node.
 */

export type MarkdownTableAlign = 'left' | 'center' | 'right';

export type MarkdownInline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'strong'; children: MarkdownInline[] }
  | { type: 'em'; children: MarkdownInline[] }
  | { type: 'del'; children: MarkdownInline[] }
  | { type: 'link'; href: string; children: MarkdownInline[] }
  | { type: 'image'; href: string; alt: string };

export type MarkdownListItem = {
  blocks: MarkdownBlock[];
  /** Present for GFM task list items (`- [ ]`, `- [x]`). */
  checked?: boolean;
};

export type MarkdownBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'code'; language?: string; code: string }
  | { type: 'list'; ordered: boolean; start: number; items: MarkdownListItem[] }
  | { type: 'quote'; blocks: MarkdownBlock[] }
  | { type: 'table'; align: MarkdownTableAlign[]; header: string[]; rows: string[][] }
  | { type: 'divider' };

type ListMarker = { indent: number; marker: string; contentIndent: number; content: string };

type Fence = { char: '`' | '~'; length: number; language?: string };

type LinkMatch = {
  node: MarkdownInline;
  next: number;
};

const MAX_INLINE_DEPTH = 12;
const ESCAPABLE = new Set('\\`*_{}[]()#+-.!|>~'.split(''));

/** Parses a full Markdown document into renderable blocks. */
export function parseMarkdown(source: string): MarkdownBlock[] {
  if (!source) return [];
  return parseBlocks(source.replace(/\r\n?/g, '\n').split('\n'));
}

/** Parses inline Markdown (emphasis, code spans, links, bare URLs). */
export function parseInline(source: string): MarkdownInline[] {
  if (!source) return [];
  return parseInlineNodes(source, 0);
}

/** Flattens Markdown into readable plain text (used for collapsed previews). */
export function markdownToPlainText(source: string): string {
  if (!source) return '';
  return blocksToPlainText(parseMarkdown(source))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseBlocks(lines: string[]): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = matchFence(line);
    if (fence) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !isFenceClose(lines[index], fence)) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: 'code', language: fence.language, code: code.join('\n') });
      continue;
    }

    const heading = matchHeading(line);
    if (heading) {
      blocks.push({ type: 'heading', level: heading.level, text: heading.text });
      index += 1;
      continue;
    }

    if (isDivider(line)) {
      blocks.push({ type: 'divider' });
      index += 1;
      continue;
    }

    if (isQuoteLine(line)) {
      const quoted: string[] = [];
      while (index < lines.length && isQuoteLine(lines[index])) {
        quoted.push(stripQuote(lines[index]));
        index += 1;
      }
      blocks.push({ type: 'quote', blocks: parseBlocks(quoted) });
      continue;
    }

    if (matchListItem(line) && !isDivider(line)) {
      const parsed = parseList(lines, index);
      blocks.push(parsed.block);
      index = parsed.next;
      continue;
    }

    const table = matchTable(lines, index);
    if (table) {
      blocks.push(table.block);
      index = table.next;
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index];
      if (!current.trim()) break;
      if (paragraph.length > 0 && (startsBlock(current) || tableHeaderAt(lines, index))) break;
      paragraph.push(current.trim());
      index += 1;
    }
    if (paragraph.length > 0) blocks.push({ type: 'paragraph', text: paragraph.join('\n') });
  }

  return blocks;
}

function parseList(lines: string[], start: number): { block: MarkdownBlock; next: number } {
  const first = matchListItem(lines[start]);
  if (!first) {
    return { block: { type: 'paragraph', text: lines[start].trim() }, next: start + 1 };
  }

  const baseIndent = first.indent;
  const ordered = /\d/.test(first.marker);
  const startNumber = ordered ? Number.parseInt(first.marker, 10) : 1;
  const items: MarkdownListItem[] = [];
  let index = start;

  while (index < lines.length) {
    const current = matchListItem(lines[index]);
    if (!current || current.indent !== baseIndent || /\d/.test(current.marker) !== ordered) break;

    const markerWidth = current.contentIndent;
    const body: string[] = [current.content];
    let cursor = index + 1;

    while (cursor < lines.length) {
      const line = lines[cursor];
      if (!line.trim()) {
        let lookahead = cursor + 1;
        while (lookahead < lines.length && !lines[lookahead].trim()) lookahead += 1;
        if (lookahead >= lines.length) {
          cursor = lookahead;
          break;
        }
        const nextItem = matchListItem(lines[lookahead]);
        if (nextItem && nextItem.indent <= baseIndent) {
          cursor = lookahead;
          break;
        }
        if (!nextItem && indentationOf(lines[lookahead]) <= baseIndent) {
          cursor = lookahead;
          break;
        }
        body.push('');
        cursor += 1;
        continue;
      }

      const nextItem = matchListItem(line);
      if (nextItem && nextItem.indent <= baseIndent) break;
      if (!nextItem && indentationOf(line) <= baseIndent) {
        if (startsBlock(line) || tableHeaderAt(lines, cursor)) break;
      }

      body.push(line);
      cursor += 1;
    }

    items.push(buildListItem(body, markerWidth));
    index = cursor;
  }

  return {
    block: { type: 'list', ordered, start: startNumber, items },
    next: index,
  };
}

function buildListItem(body: string[], markerWidth: number): MarkdownListItem {
  const [firstLine = '', ...rest] = body;
  const task = /^\[([ xX])\](?:[ \t]+|$)(.*)$/.exec(firstLine);
  const checked = task ? task[1].toLowerCase() === 'x' : undefined;
  const first = task ? (task[2] ?? '') : firstLine;
  const normalized = [first, ...rest.map((line) => deindent(line, markerWidth))];
  const blocks = parseBlocks(normalized);

  return checked === undefined ? { blocks } : { blocks, checked };
}

function matchTable(lines: string[], index: number): { block: MarkdownBlock; next: number } | null {
  const meta = tableHeaderAt(lines, index);
  if (!meta) return null;

  const rows: string[][] = [];
  let cursor = index + 2;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (!line.trim() || !line.includes('|')) break;
    const cells = splitTableRow(line).slice(0, meta.header.length);
    while (cells.length < meta.header.length) cells.push('');
    rows.push(cells);
    cursor += 1;
  }

  return {
    block: { type: 'table', header: meta.header, align: meta.align, rows },
    next: cursor,
  };
}

function tableHeaderAt(
  lines: string[],
  index: number,
): { header: string[]; align: MarkdownTableAlign[] } | null {
  const headerLine = lines[index];
  const separatorLine = lines[index + 1];
  if (!headerLine?.includes('|') || !separatorLine?.includes('|')) return null;

  const header = splitTableRow(headerLine);
  const separators = splitTableRow(separatorLine);
  if (header.length < 2 || separators.length !== header.length) return null;
  if (!separators.every((cell) => /^:?-+:?$/.test(cell))) return null;

  const align = separators.map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    return 'left';
  });

  return { header, align };
}

function splitTableRow(line: string): string[] {
  let value = line.trim();
  if (value.startsWith('|')) value = value.slice(1);
  if (value.endsWith('|') && !value.endsWith('\\|')) value = value.slice(0, -1);

  const cells: string[] = [];
  let current = '';
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '\\' && value[index + 1] === '|') {
      current += '|';
      index += 1;
      continue;
    }
    if (char === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function matchFence(line: string): Fence | null {
  const match = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match) return null;
  const marker = match[1];
  const char = marker[0] as '`' | '~';
  const info = match[2].trim();
  if (char === '`' && info.includes('`')) return null;
  const language = info.split(/\s+/)[0]?.replace(/[^\w#+.-]/g, '') || undefined;
  return { char, length: marker.length, language };
}

function isFenceClose(line: string, fence: Fence): boolean {
  const match = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(line);
  return Boolean(match && match[1][0] === fence.char && match[1].length >= fence.length);
}

function matchHeading(line: string): { level: number; text: string } | null {
  const match = /^\s{0,3}(#{1,6})[ \t]+(.*)$/.exec(line);
  if (!match) return null;
  const text = match[2].replace(/[ \t]+#+[ \t]*$/, '').trim();
  return { level: match[1].length, text };
}

function isDivider(line: string): boolean {
  return /^\s{0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(line);
}

function isQuoteLine(line: string): boolean {
  return /^\s{0,3}>/.test(line);
}

function stripQuote(line: string): string {
  return line.replace(/^\s{0,3}>[ \t]?/, '');
}

function matchListItem(line: string): ListMarker | null {
  const match = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)(.*)$/.exec(line);
  if (!match) return null;
  const indent = indentationOf(match[1]);
  return {
    indent,
    marker: match[2],
    contentIndent: indent + match[2].length + indentationOf(match[3]),
    content: match[4],
  };
}

function startsBlock(line: string): boolean {
  return (
    matchFence(line) !== null ||
    matchHeading(line) !== null ||
    isDivider(line) ||
    isQuoteLine(line) ||
    matchListItem(line) !== null
  );
}

function indentationOf(value: string): number {
  let width = 0;
  for (const char of value) {
    if (char === ' ') width += 1;
    else if (char === '\t') width += 4;
    else break;
  }
  return width;
}

function deindent(line: string, width: number): string {
  let removed = 0;
  let index = 0;
  while (index < line.length && removed < width) {
    const char = line[index];
    if (char === ' ') {
      removed += 1;
      index += 1;
      continue;
    }
    if (char === '\t') {
      removed += 4;
      index += 1;
      continue;
    }
    break;
  }
  return line.slice(index);
}

function parseInlineNodes(source: string, depth: number): MarkdownInline[] {
  const nodes: MarkdownInline[] = [];
  let buffer = '';
  let index = 0;

  const flush = (): void => {
    if (!buffer) return;
    nodes.push(...linkify(buffer));
    buffer = '';
  };

  while (index < source.length) {
    const char = source[index];

    if (char === '\\' && index + 1 < source.length && ESCAPABLE.has(source[index + 1])) {
      buffer += source[index + 1];
      index += 2;
      continue;
    }

    if (char === '`') {
      const run = runLength(source, index, '`');
      const closing = findRunClose(source, index + run, '`', run);
      if (closing >= 0) {
        flush();
        let code = source.slice(index + run, closing);
        if (code.length > 1 && code.startsWith(' ') && code.endsWith(' ') && code.trim()) {
          code = code.slice(1, -1);
        }
        nodes.push({ type: 'code', text: code });
        index = closing + run;
        continue;
      }
      buffer += source.slice(index, index + run);
      index += run;
      continue;
    }

    if (char === '!' && source[index + 1] === '[') {
      const image = matchLinkLike(source, index, depth, true);
      if (image) {
        flush();
        nodes.push(image.node);
        index = image.next;
        continue;
      }
    }

    if (char === '[') {
      const link = matchLinkLike(source, index, depth, false);
      if (link) {
        flush();
        nodes.push(link.node);
        index = link.next;
        continue;
      }
    }

    if (char === '<') {
      const autolink = matchAutolink(source, index);
      if (autolink) {
        flush();
        nodes.push(autolink.node);
        index = autolink.next;
        continue;
      }
    }

    if (char === '*' || char === '_' || char === '~') {
      const emphasis = matchEmphasis(source, index, char, depth);
      if (emphasis) {
        flush();
        nodes.push(emphasis.node);
        index = emphasis.next;
        continue;
      }
      const run = runLength(source, index, char);
      buffer += source.slice(index, index + run);
      index += run;
      continue;
    }

    buffer += char;
    index += 1;
  }

  flush();
  return nodes;
}

function matchEmphasis(
  source: string,
  start: number,
  char: string,
  depth: number,
): { node: MarkdownInline; next: number } | null {
  if (depth >= MAX_INLINE_DEPTH) return null;

  const run = runLength(source, start, char);
  if (char === '~') {
    if (run < 2) return null;
    const result = findDelimited(source, start, 2, char, depth);
    return result ? { node: { type: 'del', children: result.children }, next: result.next } : null;
  }

  const max = Math.min(run, 3);
  for (let length = max; length >= 1; length -= 1) {
    if (!canOpenEmphasis(source, start, char, length)) continue;
    const result = findDelimited(source, start, length, char, depth);
    if (!result) continue;
    if (length === 2) {
      return { node: { type: 'strong', children: result.children }, next: result.next };
    }
    if (length === 3) {
      return {
        node: { type: 'strong', children: [{ type: 'em', children: result.children }] },
        next: result.next,
      };
    }
    return { node: { type: 'em', children: result.children }, next: result.next };
  }
  return null;
}

function canOpenEmphasis(source: string, start: number, char: string, length: number): boolean {
  const next = source[start + length];
  if (!next || /\s/.test(next)) return false;
  if (next === char) return false;
  if (char === '_') {
    const previous = source[start - 1];
    if (previous && isWordChar(previous)) return false;
  }
  return true;
}

function findDelimited(
  source: string,
  start: number,
  length: number,
  char: string,
  depth: number,
): { children: MarkdownInline[]; next: number } | null {
  const marker = char.repeat(length);
  let searchFrom = start + length;

  while (searchFrom < source.length) {
    const closing = source.indexOf(marker, searchFrom);
    if (closing < 0) return null;
    searchFrom = closing + length;

    const before = source[closing - 1];
    const after = source[closing + length];
    if (before === char || after === char) continue;

    const content = source.slice(start + length, closing);
    if (!content.trim() || /\s$/.test(content)) continue;

    return { children: parseInlineNodes(content, depth + 1), next: closing + length };
  }

  return null;
}

function matchLinkLike(
  source: string,
  start: number,
  depth: number,
  image: boolean,
): LinkMatch | null {
  if (depth >= MAX_INLINE_DEPTH) return null;

  const open = image ? start + 1 : start;
  if (source[open] !== '[') return null;

  const closeBracket = findClosingBracket(source, open);
  if (closeBracket < 0 || source[closeBracket + 1] !== '(') return null;

  const closeParen = findClosingParen(source, closeBracket + 2);
  if (closeParen < 0) return null;

  const href = parseDestination(source.slice(closeBracket + 2, closeParen));
  if (!href) return null;

  const label = source.slice(open + 1, closeBracket);
  const node: MarkdownInline = image
    ? { type: 'image', href, alt: label }
    : { type: 'link', href, children: parseInlineNodes(label, depth + 1) };

  return { node, next: closeParen + 1 };
}

function findClosingBracket(source: string, open: number): number {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === '\\') {
      index += 1;
      continue;
    }
    if (char === '`') {
      const run = runLength(source, index, '`');
      const close = findRunClose(source, index + run, '`', run);
      if (close >= 0) {
        index = close + run - 1;
        continue;
      }
      index += run - 1;
      continue;
    }
    if (char === '[') depth += 1;
    else if (char === ']') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function findClosingParen(source: string, open: number): number {
  let depth = 0;
  for (let index = open - 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === '\\') {
      index += 1;
      continue;
    }
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function parseDestination(raw: string): string | null {
  let value = raw.trim();
  if (!value) return null;

  if (value.startsWith('<')) {
    const end = value.indexOf('>');
    if (end < 0) return null;
    value = value.slice(1, end);
  } else {
    const match = /^(\S+)/.exec(value);
    if (!match) return null;
    value = match[1];
  }

  value = value.replace(/\\([()<>\\])/g, '$1').trim();
  return value || null;
}

function matchAutolink(source: string, start: number): LinkMatch | null {
  const rest = source.slice(start);
  const url = /^<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^<>\s]*)>/.exec(rest);
  if (url) {
    return {
      node: { type: 'link', href: url[1], children: [{ type: 'text', text: url[1] }] },
      next: start + url[0].length,
    };
  }
  const email = /^<([^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)>/.exec(rest);
  if (email) {
    return {
      node: { type: 'link', href: `mailto:${email[1]}`, children: [{ type: 'text', text: email[1] }] },
      next: start + email[0].length,
    };
  }
  return null;
}

function linkify(text: string): MarkdownInline[] {
  if (!text.includes('://')) return [{ type: 'text', text }];

  const nodes: MarkdownInline[] = [];
  // Stop at CJK text: URLs are ASCII, so a Chinese sentence right after a URL
  // (common in assistant replies) must not be swallowed by the link.
  const pattern = /https?:\/\/[^\s<>"'`\u2e80-\u9fff\u3000-\u303f\uff00-\uffef]+/g;
  let lastIndex = 0;
  let match = pattern.exec(text);

  while (match) {
    const start = match.index;
    const url = trimUrl(match[0]);
    if (start > lastIndex) nodes.push({ type: 'text', text: text.slice(lastIndex, start) });
    if (url.length > 'https://'.length) {
      nodes.push({ type: 'link', href: url, children: [{ type: 'text', text: url }] });
    } else {
      nodes.push({ type: 'text', text: match[0] });
    }
    lastIndex = start + url.length;
    match = pattern.exec(text);
  }

  if (lastIndex < text.length) nodes.push({ type: 'text', text: text.slice(lastIndex) });
  return nodes.length > 0 ? nodes : [{ type: 'text', text }];
}

function trimUrl(value: string): string {
  let url = value;
  while (url.length > 0) {
    const last = url[url.length - 1];
    if ('.。,，;；:：!！?？、'.includes(last)) {
      url = url.slice(0, -1);
      continue;
    }
    if (last === ')' && countChar(url, '(') < countChar(url, ')')) {
      url = url.slice(0, -1);
      continue;
    }
    if (last === ']' && countChar(url, '[') < countChar(url, ']')) {
      url = url.slice(0, -1);
      continue;
    }
    if (last === '}' && countChar(url, '{') < countChar(url, '}')) {
      url = url.slice(0, -1);
      continue;
    }
    break;
  }
  return url;
}

function countChar(value: string, char: string): number {
  let count = 0;
  for (const current of value) {
    if (current === char) count += 1;
  }
  return count;
}

function runLength(source: string, start: number, char: string): number {
  let index = start;
  while (source[index] === char) index += 1;
  return index - start;
}

function findRunClose(source: string, from: number, char: string, length: number): number {
  let index = source.indexOf(char.repeat(length), from);
  while (index >= 0) {
    if (source[index + length] !== char) return index;
    index = source.indexOf(char.repeat(length), index + length);
  }
  return -1;
}

function isWordChar(char: string): boolean {
  return /[0-9A-Za-z_\u3400-\u9fff]/.test(char);
}

function blocksToPlainText(blocks: MarkdownBlock[]): string {
  return blocks
    .map(blockToPlainText)
    .filter((value) => value.length > 0)
    .join('\n\n');
}

function blockToPlainText(block: MarkdownBlock): string {
  switch (block.type) {
    case 'paragraph':
    case 'heading':
      return inlineToPlainText(parseInline(block.text));
    case 'code':
      return block.code;
    case 'list':
      return block.items
        .map((item, index) =>
          listItemToPlainText(item, block.ordered, block.start + index),
        )
        .join('\n');
    case 'quote':
      return blocksToPlainText(block.blocks);
    case 'table':
      return [block.header, ...block.rows]
        .map((row) => row.map((cell) => inlineToPlainText(parseInline(cell))).join(' | '))
        .join('\n');
    case 'divider':
      return '———';
  }
}

function listItemToPlainText(item: MarkdownListItem, ordered: boolean, number: number): string {
  const prefix = ordered ? `${number}. ` : '- ';
  const body = blocksToPlainText(item.blocks).replace(/\n{2,}/g, '\n');
  return body
    .split('\n')
    .map((line, index) => (index === 0 ? prefix + line : `  ${line}`))
    .join('\n');
}

function inlineToPlainText(nodes: MarkdownInline[]): string {
  return nodes.map((node) => {
    switch (node.type) {
      case 'text':
      case 'code':
        return node.text;
      case 'strong':
      case 'em':
      case 'del':
      case 'link':
        return inlineToPlainText(node.children);
      case 'image':
        return node.alt ? `🖼 ${node.alt}` : '🖼 图片';
    }
  }).join('');
}
