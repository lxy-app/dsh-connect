import { StyleSheet, Text, View } from 'react-native';

import { Typography } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import type { AttachmentDocumentAuth } from '@/lib/attachment-document';
import type { MobileAttachment } from '@shared/types/mobile';

/** Keep the native PDF reader out of the web dependency graph. */
export function AttachmentDocumentPreview({
  attachment,
  auth: _auth,
}: {
  readonly attachment: MobileAttachment;
  readonly auth: AttachmentDocumentAuth | null;
}) {
  const theme = useAppTheme();

  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: theme.text }]}>暂不支持在网页中预览此文档</Text>
      <Text style={[styles.detail, { color: theme.textSecondary }]}>{attachment.name}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  title: { fontSize: Typography.reading, fontWeight: '600', textAlign: 'center' },
  detail: { fontSize: Typography.body, textAlign: 'center' },
});
