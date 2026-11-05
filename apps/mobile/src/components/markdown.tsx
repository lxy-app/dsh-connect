import { useMemo, useState, type ReactNode } from 'react';
import { Alert, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { AttachmentImage } from '@/components/attachment-image';
import { Typography, type AppTheme } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import { attachmentIdFromHref, type AttachmentImageAuth } from '@/lib/attachment-loading';
import type { MobileAttachment } from '@/types/mobile';
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
  attachments: readonly MobileAttachment[];
  attachmentAuth: AttachmentImageAuth | null;
  onOpenAttachment?: (attachmentId: string) => void;
};

const EMPTY_ATTACHMENTS: readonly MobileAttachment[] = [];

const HEADING_STYLES = [
  { fontSize: 22, lineHeight: 30 },
  { fontSize: 20, lineHeight: 28 },
  { fontSize: 18, lineHeight: 26 },
  { fontSize: Typography.title, lineHeight: 24 },
  { fontSize: Typography.reading, lineHeight: 23 },
  { fontSize: Typography.reading, lineHeight: 22 },
] as const;

/**
 * Renders assistant Markdown inside a chat bubble.
 *
 * The parser output is memoized per text/theme so streaming one message does
 * not re-tokenize every other message in the transcript on each delta.
 */
export function MarkdownText({
  text,
  streaming = false,
  attachments = EMPTY_ATTACHMENTS,
  attachmentAuth = null,
  onOpenAttachment,
}: {
  text: string;
  streaming?: boolean;
  attachments?: readonly MobileAttachment[];
  attachmentAuth?: AttachmentImageAuth | null;
  onOpenAttachment?: (attachmentId: string) => void;
}) {
  const theme = useAppTheme();
  const source = streaming ? `${text} ▍` : text;
  const context = useMemo<RenderContext>(
    () => ({ theme, color: theme.text, attachments, attachmentAuth, onOpenAttachment }),
    [theme, attachments, attachmentAuth, onOpenAttachment],
  );
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
              { ...context, theme: context.theme, color: context.theme.textSecondary },
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
  const image = standaloneImage(nodes);
  const attachmentId = image ? attachmentIdFromHref(image.href) : undefined;
  const attachment = attachmentId
    ? context.attachments.find((item) => item.attachmentId === attachmentId && item.kind === 'image')
    : undefined;
  if (attachment && context.onOpenAttachment) {
    return (
      <InlineAttachmentImage
        key={`${key}-${attachment.attachmentId}`}
        attachment={attachment}
        auth={context.attachmentAuth}
        onOpen={() => context.onOpenAttachment?.(attachment.attachmentId)}
      />
    );
  }
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

function standaloneImage(nodes: MarkdownInline[]): Extract<MarkdownInline, { type: 'image' }> | null {
  const meaningful = nodes.filter((node) => node.type !== 'text' || node.text.trim().length > 0);
  return meaningful.length === 1 && meaningful[0]?.type === 'image' ? meaningful[0] : null;
}

function InlineAttachmentImage({
  attachment,
  auth,
  onOpen,
}: {
  attachment: MobileAttachment;
  auth: AttachmentImageAuth | null;
  onOpen: () => void;
}) {
  const theme = useAppTheme();
  const [loadedDimensions, setLoadedDimensions] = useState<{ width: number; height: number } | null>(null);
  const dimensions = attachment.width && attachment.height
    ? { width: attachment.width, height: attachment.height }
    : loadedDimensions;
  const aspectRatio = dimensions && dimensions.width > 0 && dimensions.height > 0
    ? dimensions.width / dimensions.height
    : 4 / 3;
  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel={`打开图片 ${attachment.name}`}
      onPress={onOpen}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      <AttachmentImage
        attachment={attachment}
        auth={auth}
        style={[
          styles.inlineImage,
          { aspectRatio, backgroundColor: theme.surfaceMuted },
        ]}
        contentFit="contain"
        accessibilityLabel={`正文图片 ${attachment.name}`}
        onLoad={setLoadedDimensions}
      />
    </Pressable>
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
      case 'image':
        return (
          <Text
            key={key}
            accessibilityRole="link"
            onPress={() => openImage(node, context)}
            style={[styles.link, { color: context.theme.accent }]}
          >
            {node.alt ? `🖼 ${node.alt}` : '🖼 图片'}
          </Text>
        );
    }
  });
}

function containsLink(nodes: MarkdownInline[]): boolean {
  return nodes.some((node) => {
    if (node.type === 'link' || node.type === 'image') return true;
    if (node.type === 'strong' || node.type === 'em' || node.type === 'del') {
      return containsLink(node.children);
    }
    return false;
  });
}

function openImage(
  node: Extract<MarkdownInline, { type: 'image' }>,
  context: RenderContext,
): void {
  const attachmentId = attachmentIdFromHref(node.href);
  const attachment = attachmentId
    ? context.attachments.find((item) => item.attachmentId === attachmentId && item.kind === 'image')
    : undefined;
  if (attachment && context.onOpenAttachment) {
    context.onOpenAttachment(attachment.attachmentId);
    return;
  }
  openLink(node.href);
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
  inlineImage: {
    width: '100%',
    maxHeight: 520,
    borderRadius: 12,
    overflow: 'hidden',
  },
  pressed: {
    opacity: 0.85,
  },
  paragraph: {
    fontSize: Typography.reading,
    lineHeight: 24,
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
    fontSize: Typography.caption,
    lineHeight: 18,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  codeText: {
    fontFamily: MONOSPACE_FONT,
    fontSize: Typography.body,
    lineHeight: 21,
  },
  inlineCode: {
    fontFamily: MONOSPACE_FONT,
    fontSize: Typography.body,
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
    minWidth: 18,
    flexShrink: 0,
    fontSize: Typography.reading,
    lineHeight: 24,
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
    fontSize: Typography.body,
    lineHeight: 21,
  },
  tableHeaderText: {
    fontWeight: '700',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 2,
  },
});
