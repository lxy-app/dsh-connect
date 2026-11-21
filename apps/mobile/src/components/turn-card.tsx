import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { AttachmentGrid, type AttachmentAuth } from '@/components/attachment-grid';
import { AttachmentViewer } from '@/components/attachment-viewer';
import { MarkdownText } from '@/components/markdown';
import { ReadAloudButton } from '@/components/read-aloud-button';
import { Typography } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import { markdownToPlainText } from '@/lib/markdown';
import { attachmentPreviewKind } from '@/lib/attachment-preview';
import {
  processGroupOpen,
  processGroupTitle,
  toolStepLabel,
  type TurnGroup,
  type TurnProcessGroup,
} from '@shared/lib/turn-grouping';
import type { MobileAttachment, MobileMessage } from '@shared/types/mobile';

const COLLAPSE_CHARS = 700;

/**
 * A turn has a passive status row, not a global fold. Process groups own their
 * disclosure state and every visible assistant response stays outside them.
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
  const [expanded, setExpanded] = useState(false);
  const [groupOpen, setGroupOpen] = useState<Readonly<Record<string, boolean>>>({});

  const finalText = group.final?.text ?? '';
  const collapsible = finalText.length > COLLAPSE_CHARS;
  const preview = useMemo(() => markdownToPlainText(finalText), [finalText]);
  const renderedAsMarkdown = !collapsible || expanded;

  const imageAttachments = useMemo(
    () => group.attachments.filter((attachment) => attachmentPreviewKind(attachment) === 'image'),
    [group.attachments],
  );
  const [viewer, setViewer] = useState<{
    readonly attachments: readonly MobileAttachment[];
    readonly index: number;
  } | null>(null);
  const openAttachment = useCallback((attachmentId: string) => {
    const selected = group.attachments.find((attachment) => attachment.attachmentId === attachmentId);
    if (!selected) return;
    const previewKind = attachmentPreviewKind(selected);
    if (previewKind !== 'image' && selected.state === 'unavailable') return;
    if (previewKind === 'image') {
      const index = imageAttachments.findIndex((attachment) => attachment.attachmentId === attachmentId);
      if (index >= 0) setViewer({ attachments: imageAttachments, index });
      return;
    }
    setViewer({ attachments: [selected], index: 0 });
  }, [group.attachments, imageAttachments]);

  const elapsed = elapsedLabel(running ? now - group.startedAt : group.endedAt - group.startedAt);
  const parts = group.parts;
  const latestProcessKey = useMemo(
    () => [...parts].reverse().find((part) => part.kind === 'process')?.key,
    [parts],
  );
  const hasBody = parts.length > 0 || Boolean(group.final) || group.attachments.length > 0;
  if (!hasBody && !liveText) return null;

  const toggleGroup = (key: string) => {
    setGroupOpen((current) => ({
      ...current,
      [key]: !processGroupOpen(current[key], running, key === latestProcessKey),
    }));
  };

  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <View style={styles.head}>
          {running ? <ActivityIndicator color={theme.textSecondary} size="small" /> : null}
          <Text style={[styles.title, { color: theme.textSecondary }]}>{running ? '深度求索中' : '已完成'}</Text>
        </View>
        {group.final && finalText ? (
          <ReadAloudButton text={preview} playbackKey={`${playbackScope}:turn-${group.key}`} disabled={readAloudDisabled} style={styles.tts} />
        ) : null}
      </View>

      {parts.length > 0 ? (
        <View style={styles.parts}>
          {parts.map((part) => part.kind === 'process' ? (
            <ProcessGroupSection
              key={part.key}
              group={part.process}
              open={processGroupOpen(groupOpen[part.key], running, part.key === latestProcessKey)}
              onToggle={() => toggleGroup(part.key)}
            />
          ) : part.message.text.trim() ? (
            <View key={part.key} style={styles.response}>
              <MarkdownText
                text={part.message.text}
                attachments={group.attachments}
                attachmentAuth={attachmentAuth}
                onOpenAttachment={openAttachment}
              />
            </View>
          ) : null)}
        </View>
      ) : null}

      {liveText ? (
        <View style={styles.live}>
          <MarkdownText streaming text={liveText} />
        </View>
      ) : null}
      {parts.length === 0 && !liveText && !group.final ? (
        <Text style={[styles.empty, { color: theme.textSecondary }]}>正在等待执行步骤…</Text>
      ) : null}
      <Text style={[styles.elapsed, { color: theme.textSecondary }]}>用时 {elapsed}</Text>

      {finalText || group.attachments.length > 0 ? (
        <View style={styles.final}>
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
          {viewer !== null ? (
            <AttachmentViewer
              attachments={viewer.attachments}
              auth={attachmentAuth}
              initialIndex={viewer.index}
              onClose={() => setViewer(null)}
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
        </View>
      ) : null}
    </View>
  );
}

function ProcessGroupSection({
  group,
  open,
  onToggle,
}: {
  readonly group: TurnProcessGroup;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  const theme = useAppTheme();
  const title = processGroupTitle(group);
  return (
    <View style={styles.processGroup}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${open ? '收起' : '展开'}${title}`}
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={({ pressed }) => [styles.processHead, pressed && styles.pressed]}
      >
        <View style={[styles.dot, { backgroundColor: theme.accentSoft }]} />
        <Text style={[styles.processTitle, { color: theme.text }]}>{title}</Text>
        <Text style={[styles.processCount, { color: theme.textSecondary }]}>{group.steps.length} 项</Text>
        <Text style={[styles.chevron, { color: theme.textSecondary, transform: [{ rotate: open ? '90deg' : '0deg' }] }]}>›</Text>
      </Pressable>
      {open ? (
        <View style={styles.groupSteps}>
          {group.steps.map((step) => (
            <StepRow key={`${step.seq}-${step.id}`} message={step} />
          ))}
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
        {toolStepLabel(message.toolName)}
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

function elapsedLabel(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1_000));
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes} 分 ${seconds % 60} 秒` : `${seconds} 秒`;
}

const styles = StyleSheet.create({
  card: { marginTop: 10, marginBottom: 6 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, alignSelf: 'flex-start' },
  tts: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, paddingVertical: 4, borderRadius: 8 },
  title: { fontSize: Typography.control, fontWeight: '600' },
  chevron: { fontSize: 17, lineHeight: 18 },
  parts: { gap: 4 },
  processGroup: { paddingVertical: 2 },
  processHead: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 30, alignSelf: 'flex-start' },
  processTitle: { fontSize: Typography.body, fontWeight: '600' },
  processCount: { fontSize: Typography.caption },
  groupSteps: { paddingBottom: 4, gap: 6 },
  elapsed: { fontSize: Typography.caption, lineHeight: 18, marginTop: 2 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 24 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  stepLabel: { fontSize: Typography.body, fontWeight: '600' },
  stepSummary: { flex: 1, fontSize: Typography.body },
  stepTime: { fontSize: Typography.caption, fontVariant: ['tabular-nums'] },
  narration: { fontSize: Typography.body, lineHeight: 22, paddingLeft: 13 },
  response: { paddingVertical: 2 },
  live: { paddingTop: 2 },
  empty: { fontSize: Typography.body, paddingVertical: 4 },
  final: { paddingBottom: 2 },
  finalText: { fontSize: Typography.reading, lineHeight: 24 },
  expand: { alignSelf: 'flex-start', paddingVertical: 6 },
  expandText: { fontSize: Typography.body, fontWeight: '600' },
  pressed: { opacity: 0.6 },
});
