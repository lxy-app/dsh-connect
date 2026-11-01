import { useMemo, type ReactNode } from 'react';
import { Alert, Linking, Platform, StyleSheet, Text, View } from 'react-native';

import type { AppTheme } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  parseInline,
  parseMarkdown,
  type MarkdownBlock,
  type MarkdownInline,
  type MarkdownListItem,
  type MarkdownTableAlign,
} from '@/lib/markdown';

const MONOSPACE_FONT = Platform.select({ ios: 'Menlo', default: 'monospace' });

type RenderContext = {
  theme: AppTheme;
  color: string;
};

const HEADING_STYLES = [
  { fontSize: 19, lineHeight: 26 },
  { fontSize: 17, lineHeight: 24 },
  { fontSize: 15.5, lineHeight: 22 },
  { fontSize: 15, lineHeight: 21 },
  { fontSize: 14.5, lineHeight: 21 },
  { fontSize: 14, lineHeight: 21 },
] as const;

/**
 * Renders assistant Markdown inside a chat bubble.
 *
 * The parser output is memoized per text/theme so streaming one message does
 * not re-tokenize every other message in the transcript on each delta.
 */
export function MarkdownText({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const theme = useAppTheme();
  const source = streaming ? `${text} ▍` : text;
  const context = useMemo<RenderContext>(() => ({ theme, color: theme.text }), [theme]);
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  const content = useMemo(
    () => blocks.map((block, index) => renderBlock(block, `block-${index}`, context, 0)),
    [blocks, context],
  );

  return <View style={styles.root}>{content}</View>;
}

function renderBlock(
  block: MarkdownBlock,
  key: string,
  context: RenderContext,
  depth: number,
): ReactNode {
  switch (block.type) {
    case 'paragraph':
      return renderParagraph(block.text, key, context);
    case 'heading':
      return renderHeading(block, key, context);
    case 'code':
      return renderCode(block, key, context);
    case 'list':
      return renderList(block, key, context, depth);
    case 'quote':
      return (
        <View key={key} style={[styles.quote, { borderLeftColor: context.theme.border }]}>
          {block.blocks.map((child, index) =>
            renderBlock(
              child,
              `${key}-quote-${index}`,
              { theme: context.theme, color: context.theme.textSecondary },
              depth + 1,
            ),
          )}
        </View>
      );
    case 'table':
      return renderTable(block, key, context);
    case 'divider':
      return <View key={key} style={[styles.divider, { backgroundColor: context.theme.border }]} />;
  }
}

function renderParagraph(text: string, key: string, context: RenderContext): ReactNode {
  const nodes = parseInline(text);
  return (
    <Text
      key={key}
      selectable={!containsLink(nodes)}
      style={[styles.paragraph, { color: context.color }]}
    >
      {renderInline(nodes, key, context)}
    </Text>
  );
}

function renderHeading(
  block: Extract<MarkdownBlock, { type: 'heading' }>,
  key: string,
  context: RenderContext,
): ReactNode {
  const size = HEADING_STYLES[Math.min(Math.max(block.level, 1), 6) - 1];
  return (
    <Text
      key={key}
      accessibilityRole="header"
      selectable
      style={[styles.heading, size, { color: context.color }]}
    >
      {renderInline(parseInline(block.text), key, context)}
    </Text>
  );
}

function renderCode(
  block: Extract<MarkdownBlock, { type: 'code' }>,
  key: string,
  context: RenderContext,
): ReactNode {
  return (
    <View
      key={key}
      style={[
        styles.codeBlock,
        { backgroundColor: context.theme.surfaceMuted, borderColor: context.theme.border },
      ]}
    >
      {block.language ? (
        <Text style={[styles.codeLanguage, { color: context.theme.textSecondary }]}>
          {block.language}
        </Text>
      ) : null}
      <Text selectable style={[styles.codeText, { color: context.color }]}>
        {block.code}
      </Text>
    </View>
  );
}

function renderList(
  block: Extract<MarkdownBlock, { type: 'list' }>,
  key: string,
  context: RenderContext,
  depth: number,
): ReactNode {
  return (
    <View key={key} style={[styles.list, depth > 0 && styles.nestedList]}>
      {block.items.map((item, index) => (
        <View key={`${key}-item-${index}`} style={styles.listItem}>
          <Text selectable={false} style={[styles.listMarker, { color: context.color }]}>
            {listMarker(item, block, index)}
          </Text>
          <View style={styles.listBody}>
            {item.blocks.map((child, childIndex) =>
              renderBlock(child, `${key}-item-${index}-${childIndex}`, context, depth + 1),
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

function listMarker(
  item: MarkdownListItem,
  block: Extract<MarkdownBlock, { type: 'list' }>,
  index: number,
): string {
  if (item.checked === true) return '☑';
  if (item.checked === false) return '☐';
  return block.ordered ? `${block.start + index}.` : '•';
}

function renderTable(
  block: Extract<MarkdownBlock, { type: 'table' }>,
  key: string,
  context: RenderContext,
): ReactNode {
  const columns = block.header.length;
  return (
    <View key={key} style={[styles.table, { borderColor: context.theme.border }]}>
      <View style={[styles.tableRow, { backgroundColor: context.theme.surfaceMuted }]}>
        {block.header.map((cell, index) =>
          renderTableCell(
            cell,
            `${key}-head-${index}`,
            context,
            block.align[index],
            true,
            index === columns - 1,
          ),
        )}
      </View>
      {block.rows.map((row, rowIndex) => (
        <View
          key={`${key}-row-${rowIndex}`}
          style={[
            styles.tableRow,
            { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: context.theme.border },
          ]}
        >
          {row.map((cell, cellIndex) =>
            renderTableCell(
              cell,
              `${key}-cell-${rowIndex}-${cellIndex}`,
              context,
              block.align[cellIndex],
              false,
              cellIndex === columns - 1,
            ),
          )}
        </View>
      ))}
    </View>
  );
}

function renderTableCell(
  cell: string,
  key: string,
  context: RenderContext,
  align: MarkdownTableAlign | undefined,
  header: boolean,
  last: boolean,
): ReactNode {
  return (
    <View
      key={key}
      style={[
        styles.tableCell,
        !last && {
          borderRightWidth: StyleSheet.hairlineWidth,
          borderRightColor: context.theme.border,
        },
      ]}
    >
      <Text
        selectable
        style={[
          styles.tableCellText,
          { color: context.color, textAlign: align ?? 'left' },
          header && styles.tableHeaderText,
        ]}
      >
        {renderInline(parseInline(cell), key, context)}
      </Text>
    </View>
  );
}

function renderInline(
  nodes: MarkdownInline[],
  keyPrefix: string,
  context: RenderContext,
): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-inline-${index}`;
    switch (node.type) {
      case 'text':
        return node.text;
      case 'code':
        return (
          <Text
            key={key}
            style={[styles.inlineCode, { backgroundColor: context.theme.surfaceMuted }]}
          >
            {node.text}
          </Text>
        );
      case 'strong':
        return (
          <Text key={key} style={styles.strong}>
            {renderInline(node.children, key, context)}
          </Text>
        );
      case 'em':
        return (
          <Text key={key} style={styles.em}>
            {renderInline(node.children, key, context)}
          </Text>
        );
      case 'del':
        return (
          <Text key={key} style={styles.del}>
            {renderInline(node.children, key, context)}
          </Text>
        );
      case 'link':
        return (
          <Text
            key={key}
            accessibilityRole="link"
            onPress={() => openLink(node.href)}
            style={[styles.link, { color: context.theme.accent }]}
          >
            {renderInline(node.children, key, context)}
          </Text>
        );
    }
  });
}

function containsLink(nodes: MarkdownInline[]): boolean {
  return nodes.some((node) => {
    if (node.type === 'link') return true;
    if (node.type === 'strong' || node.type === 'em' || node.type === 'del') {
      return containsLink(node.children);
    }
    return false;
  });
}

function openLink(href: string): void {
  if (!/^(https?:\/\/|mailto:)/i.test(href)) {
    Alert.alert(
      '无法打开链接',
      href.startsWith('#') ? '这是文档内部锚点，请在桌面端查看。' : '这个链接不是可以在手机上打开的网页地址。',
    );
    return;
  }
  Linking.openURL(href).catch(() => {
    Alert.alert('打开链接失败', href);
  });
}

const styles = StyleSheet.create({
  root: {
    gap: 8,
  },
  paragraph: {
    fontSize: 14,
    lineHeight: 21,
  },
  heading: {
    fontWeight: '700',
  },
  codeBlock: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  codeLanguage: {
    fontSize: 9,
    lineHeight: 13,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  codeText: {
    fontFamily: MONOSPACE_FONT,
    fontSize: 12.5,
    lineHeight: 18,
  },
  inlineCode: {
    fontFamily: MONOSPACE_FONT,
    fontSize: 13,
  },
  strong: {
    fontWeight: '700',
  },
  em: {
    fontStyle: 'italic',
  },
  del: {
    textDecorationLine: 'line-through',
  },
  link: {
    textDecorationLine: 'underline',
  },
  list: {
    gap: 4,
  },
  nestedList: {
    marginTop: 4,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  listMarker: {
    minWidth: 14,
    flexShrink: 0,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'right',
    fontWeight: '600',
  },
  listBody: {
    flex: 1,
    gap: 4,
  },
  quote: {
    borderLeftWidth: 3,
    paddingLeft: 10,
    gap: 6,
  },
  table: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    overflow: 'hidden',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  tableCell: {
    flex: 1,
    paddingHorizontal: 7,
    paddingVertical: 6,
  },
  tableCellText: {
    fontSize: 12.5,
    lineHeight: 18,
  },
  tableHeaderText: {
    fontWeight: '700',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 2,
  },
});
