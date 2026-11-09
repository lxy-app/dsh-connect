import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { Typography } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import type { MobileInteraction, MobileInteractionAnswer } from '@shared/types/mobile';

type InteractionCardProps = {
  interaction: MobileInteraction;
  busy: boolean;
  onDecision: (decision: { decision?: 'allow-once' | 'reject'; answers?: MobileInteractionAnswer[] }) => void;
};

/**
 * One pending DSH interaction rendered above the composer. Answers are one-shot:
 * the card disappears as soon as the Server accepts the decision, and the
 * desktop keeps its own prompt until DSH records the outcome.
 */
export function InteractionCard({ interaction, busy, onDecision }: InteractionCardProps) {
  const theme = useAppTheme();
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const questions = interaction.questions ?? [];
  const isApproval = interaction.kind === 'approval';

  const toggleOption = (questionId: string, label: string, multi: boolean) => {
    setSelected((current) => {
      const existing = current[questionId] ?? [];
      if (!multi) return { ...current, [questionId]: existing.includes(label) ? [] : [label] };
      return {
        ...current,
        [questionId]: existing.includes(label)
          ? existing.filter((item) => item !== label)
          : [...existing, label],
      };
    });
  };

  const submitQuestion = () => {
    onDecision({
      answers: questions.map((question) => {
        const text = custom[question.id]?.trim() ?? '';
        return {
          id: question.id,
          selected: selected[question.id] ?? [],
          ...(text ? { custom: text } : {}),
        };
      }),
    });
  };

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.accent }]}>
      <View style={styles.head}>
        <View style={[styles.badge, { backgroundColor: theme.accentSoft }]}>
          <Text style={[styles.badgeText, { color: theme.accent }]}>
            {isApproval ? '工具审批' : '需要回答'}
          </Text>
        </View>
        <Text numberOfLines={1} style={[styles.meta, { color: theme.textSecondary }]}>
          {[interaction.deviceName, interaction.workspaceName].filter(Boolean).join(' · ') || '桌面 DSH'}
        </Text>
      </View>

      <Text style={[styles.title, { color: theme.text }]} numberOfLines={3}>
        {interaction.title || (isApproval ? 'DSH 请求批准一次工具调用' : 'DSH 需要你的回答')}
      </Text>
      {interaction.reason ? (
        <Text style={[styles.reason, { color: theme.textSecondary }]}>{interaction.reason}</Text>
      ) : null}

      {isApproval ? (
        <View style={styles.actions}>
          <ActionButton
            label="拒绝"
            variant="danger"
            disabled={busy}
            onPress={() => onDecision({ decision: 'reject' })}
          />
          <ActionButton
            label="允许一次"
            disabled={busy}
            loading={busy}
            onPress={() => onDecision({ decision: 'allow-once' })}
          />
        </View>
      ) : (
        <View style={styles.questions}>
          {questions.map((question) => {
            const chosen = selected[question.id] ?? [];
            return (
              <View key={question.id} style={styles.question}>
                {question.header ? (
                  <Text style={[styles.questionHeader, { color: theme.textSecondary }]}>
                    {question.header}
                  </Text>
                ) : null}
                <Text style={[styles.questionText, { color: theme.text }]}>{question.question}</Text>
                {question.detail ? (
                  <Text style={[styles.questionDetail, { color: theme.textSecondary }]}>
                    {question.detail}
                  </Text>
                ) : null}
                {question.options?.length ? (
                  <View style={styles.options}>
                    {question.options.map((option) => {
                      const active = chosen.includes(option.label);
                      return (
                        <Pressable
                          accessibilityRole="radio"
                          accessibilityState={{ checked: active }}
                          key={option.label}
                          onPress={() => toggleOption(question.id, option.label, question.multiSelect === true)}
                          style={[
                            styles.option,
                            {
                              borderColor: active ? theme.accent : theme.border,
                              backgroundColor: active ? theme.accentSoft : theme.surface,
                            },
                          ]}
                        >
                          <Text style={[styles.optionText, { color: active ? theme.accent : theme.text }]}>
                            {option.label}
                          </Text>
                          {option.description ? (
                            <Text style={[styles.optionHelp, { color: theme.textSecondary }]}>
                              {option.description}
                            </Text>
                          ) : null}
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
                <TextInput
                  accessibilityLabel={`补充回答：${question.question}`}
                  multiline
                  maxLength={4_096}
                  placeholder="输入你的答案（可选）"
                  placeholderTextColor={theme.textSecondary}
                  value={custom[question.id] ?? ''}
                  onChangeText={(text) => setCustom((current) => ({ ...current, [question.id]: text }))}
                  style={[
                    styles.input,
                    { color: theme.text, borderColor: theme.border, backgroundColor: theme.background },
                  ]}
                />
              </View>
            );
          })}
          <ActionButton label="提交回答" loading={busy} disabled={busy} onPress={submitQuestion} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 10,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: {
    fontSize: Typography.caption,
    lineHeight: 18,
    fontWeight: '700',
  },
  meta: {
    flex: 1,
    fontSize: Typography.caption,
    lineHeight: 18,
  },
  title: {
    fontSize: Typography.reading,
    fontWeight: '700',
    lineHeight: 22,
  },
  reason: {
    fontSize: Typography.body,
    lineHeight: 21,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  questions: {
    gap: 12,
  },
  question: {
    gap: 6,
  },
  questionHeader: {
    fontSize: Typography.secondary,
    lineHeight: 19,
    fontWeight: '700',
  },
  questionText: {
    fontSize: Typography.control,
    fontWeight: '600',
    lineHeight: 21,
  },
  questionDetail: {
    fontSize: Typography.body,
    lineHeight: 21,
  },
  options: {
    gap: 8,
  },
  option: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    gap: 2,
  },
  optionText: {
    fontSize: Typography.control,
    lineHeight: 21,
    fontWeight: '600',
  },
  optionHelp: {
    fontSize: Typography.secondary,
    lineHeight: 20,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: Typography.reading,
    lineHeight: 24,
    minHeight: 42,
    textAlignVertical: 'top',
  },
});
