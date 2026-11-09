import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { AttachmentGrid, type AttachmentAuth } from '@/components/attachment-grid';
import { AttachmentViewer } from '@/components/attachment-viewer';
import { MarkdownText } from '@/components/markdown';
import { ReadAloudButton } from '@/components/read-aloud-button';
import { Typography } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import { formatTime } from '@shared/lib/format';
import { markdownToPlainText } from '@/lib/markdown';
import type { TurnGroup } from '@shared/lib/turn-grouping';
import type { MobileMessage } from '@shared/types/mobile';

const COLLAPSE_CHARS = 700;

/**
 * One DSH turn: a header that folds the process away, the tool/narration steps
 * underneath it, and the visible reply outside the fold.
 */
export function TurnCard({
  group,
  running,
  now,
  playbackScope,
  liveText = '',
  attachmentAuth = null,
  readAloudDisabled = false,
}: {
  group: TurnGroup;
  running: boolean;
  now: number;
  playbackScope: string;
  liveText?: string;
  attachmentAuth?: AttachmentAuth | null;
  readAloudDisabled?: boolean;
}) {
  const theme = useAppTheme();
  const [open, setOpen] = useState(running);
  const manual = useRef(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (manual.current) return;
    setOpen(running);
  }, [running]);

  const finalText = group.final?.text ?? '';
  const collapsible = finalText.length > COLLAPSE_CHARS;
  const preview = useMemo(() => markdownToPlainText(finalText), [finalText]);
  const renderedAsMarkdown = !collapsible || expanded;

  const imageAttachments = useMemo(
    () => group.attachments.filter((attachment) => attachment.kind === 'image'),
    [group.attachments],
  );
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const openAttachment = useCallback((attachmentId: string) => {
    const index = imageAttachments.findIndex((attachment) => attachment.attachmentId === attachmentId);
    if (index >= 0) setViewerIndex(index);
  }, [imageAttachments]);

  const elapsed = elapsedLabel(running ? now - group.startedAt : group.endedAt - group.startedAt);
  const steps = group.steps;
  const hasBody = steps.length > 0 || Boolean(group.final) || group.attachments.length > 0;
  if (!hasBody && !liveText) return null;

  const time = group.final?.occurredAt ?? new Date(group.endedAt).toISOString();

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={running ? '收起执行过程' : open ? '收起执行过程' : '展开执行过程'}
        accessibilityState={{ expanded: open }}
        onPress={() => {
          manual.current = true;
          setOpen((current) => !current);
        }}
        style={({ pressed }) => [styles.head, pressed && styles.pressed]}
      >
        <View style={[styles.state, running ? null : { backgroundColor: theme.accentSoft }]}>
          {running
            ? <ActivityIndicator color={theme.accent} size="small" />
            : <Text style={[styles.check, { color: theme.success }]}>✓</Text>}
        </View>
        <Text style={[styles.title, { color: theme.text }]}>{running ? '深度求索中' : '已完成'}</Text>
        <Text style={[styles.meta, { color: theme.textSecondary }]}>· 用时 {elapsed}</Text>
        <Text style={[styles.chevron, { color: theme.textSecondary, transform: [{ rotate: open ? '90deg' : '0deg' }] }]}>›</Text>
      </Pressable>

      {open ? (
        <View style={styles.steps}>
          {steps.map((step) => (
            <StepRow key={`${step.seq}-${step.id}`} message={step} />
          ))}
          {liveText ? (
            <View style={styles.live}>
              <MarkdownText streaming text={liveText} />
            </View>
          ) : null}
          {steps.length === 0 && !liveText && !group.final ? (
            <Text style={[styles.empty, { color: theme.textSecondary }]}>正在等待执行步骤…</Text>
          ) : null}
        </View>
      ) : null}

      {finalText || group.attachments.length > 0 ? (
        <View style={[styles.final, open && { borderTopColor: theme.border }]}
        >
          {finalText ? (
            renderedAsMarkdown ? (
              <MarkdownText
                text={finalText}
                attachments={group.attachments}
                attachmentAuth={attachmentAuth}
                onOpenAttachment={openAttachment}
              />
            ) : (
              <Text style={[styles.finalText, { color: theme.text }]} numberOfLines={14}>
                {preview}
              </Text>
            )
          ) : null}
          <AttachmentGrid
            attachments={group.attachments}
            onOpen={(attachment) => openAttachment(attachment.attachmentId)}
          />
          {viewerIndex !== null ? (
            <AttachmentViewer
              attachments={imageAttachments}
              auth={attachmentAuth}
              initialIndex={viewerIndex}
              onClose={() => setViewerIndex(null)}
            />
          ) : null}
          {collapsible ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={expanded ? '收起长消息' : '展开长消息'}
              onPress={() => setExpanded((current) => !current)}
              style={({ pressed }) => [styles.expand, pressed && styles.pressed]}
            >
              <Text style={[styles.expandText, { color: theme.accent }]}>
                {expanded ? '收起' : `展开全文（${finalText.length} 字）`}
              </Text>
            </Pressable>
          ) : null}
          <View style={styles.foot}>
            {group.final && finalText ? (
              <ReadAloudButton text={preview} playbackKey={`${playbackScope}:turn-${group.key}`} disabled={readAloudDisabled} />
            ) : null}
            <Text style={[styles.time, { color: theme.textSecondary }]}>{formatTime(time)}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function StepRow({ message }: { message: MobileMessage }) {
  const theme = useAppTheme();
  if (message.role !== 'tool') {
    return (
      <Text style={[styles.narration, { color: theme.textSecondary }]} numberOfLines={4}>
        {message.text}
      </Text>
    );
  }
  const failed = message.status === 'error';
  const duration = typeof message.durationMs === 'number' && message.durationMs >= 1_000
    ? `${(message.durationMs / 1_000).toFixed(1)}s`
    : '';
  return (
    <View style={styles.stepRow}>
      <View style={[styles.dot, { backgroundColor: failed ? theme.danger : theme.accentSoft }]} />
      <Text style={[styles.stepLabel, { color: failed ? theme.danger : theme.text }]} numberOfLines={1}>
        {stepLabel(message.toolName)}
      </Text>
      {message.summary ? (
        <Text style={[styles.stepSummary, { color: theme.textSecondary }]} numberOfLines={1}>
          · {message.summary}
        </Text>
      ) : null}
      {duration ? <Text style={[styles.stepTime, { color: theme.textSecondary }]}>{duration}</Text> : null}
    </View>
  );
}

function stepLabel(toolName?: string): string {
  const name = (toolName ?? '').toLowerCase();
  if (/bash|shell|exec|command|terminal|run/.test(name)) return '运行命令';
  if (/read|view|open|cat|list/.test(name)) return '读取';
  if (/write|edit|create|patch|apply/.test(name)) return '写入';
  if (/grep|search|glob|find|query/.test(name)) return '检索';
  if (/fetch|http|browse|web/.test(name)) return '访问';
  if (/task|agent|subagent/.test(name)) return '调用';
  return toolName || '步骤';
}

function elapsedLabel(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1_000));
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes} 分 ${seconds % 60} 秒` : `${seconds} 秒`;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, marginTop: 12, marginBottom: 14, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, paddingVertical: 11 },
  state: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  check: { fontSize: 13, fontWeight: '700' },
  title: { fontSize: Typography.control, fontWeight: '700' },
  meta: { flex: 1, fontSize: Typography.body, fontVariant: ['tabular-nums'] },
  chevron: { fontSize: 18, lineHeight: 18 },
  steps: { paddingHorizontal: 12, paddingBottom: 8, gap: 6 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 24 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  stepLabel: { fontSize: Typography.body, fontWeight: '600' },
  stepSummary: { flex: 1, fontSize: Typography.body },
  stepTime: { fontSize: Typography.caption, fontVariant: ['tabular-nums'] },
  narration: { fontSize: Typography.body, lineHeight: 22, paddingLeft: 13 },
  live: { paddingTop: 2 },
  empty: { fontSize: Typography.body, paddingVertical: 4 },
  final: { paddingHorizontal: 12, paddingBottom: 10, borderTopWidth: 1, borderTopColor: 'transparent' },
  finalText: { fontSize: Typography.reading, lineHeight: 24 },
  expand: { alignSelf: 'flex-start', paddingVertical: 6 },
  expandText: { fontSize: Typography.body, fontWeight: '600' },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
  time: { marginLeft: 'auto', fontSize: Typography.caption, fontVariant: ['tabular-nums'] },
  pressed: { opacity: 0.6 },
});
