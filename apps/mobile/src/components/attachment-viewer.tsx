import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import * as Sharing from 'expo-sharing';

import { AttachmentDocumentPreview } from '@/components/attachment-document-preview';
import { AttachmentImage } from '@/components/attachment-image';
import { useAppTheme } from '@/hooks/use-app-theme';
import { saveOriginalFileToAndroid } from '@/lib/attachment-android-save';
import { attachmentPreviewKind } from '@/lib/attachment-preview';
import { downloadOriginalFile } from '@/lib/attachment-original';
import { attachmentMimeType, attachmentUti } from '@/lib/attachment-save-utils';
import type { MobileAttachment } from '@shared/types/mobile';

export type ViewerAuth = { readonly serverUrl: string; readonly accessToken: string };

/**
 * Shared full-screen attachment entry. Images retain horizontal paging/zoom;
 * callers pass a singleton collection for a document so it never joins paging.
 */
export function AttachmentViewer({
  attachments,
  auth,
  initialIndex,
  onClose,
}: {
  attachments: readonly MobileAttachment[];
  auth: ViewerAuth | null;
  initialIndex: number;
  onClose: () => void;
}) {
  const theme = useAppTheme();
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(Math.min(initialIndex, Math.max(0, attachments.length - 1)));
  const [downloading, setDownloading] = useState(false);
  const current = attachments[index];
  const documentMode = current !== undefined && attachmentPreviewKind(current) !== 'image';

  const handleDownload = useCallback(async () => {
    if (!current || !auth || downloading) return;
    setDownloading(true);
    try {
      const { file } = await downloadOriginalFile(current, auth);
      if (Platform.OS === 'android') {
        const result = await saveOriginalFileToAndroid(file, current);
        if (result.status === 'saved') {
          Alert.alert('已保存', `“${result.fileName}”已保存到所选目录。`);
        }
        return;
      }

      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert('无法导出', '当前设备无法打开系统导出面板。');
        return;
      }
      const UTI = attachmentUti(current);
      // iOS presents the system activity sheet; the user explicitly chooses
      // “存储到文件” or another destination. No silent-save success is claimed.
      await Sharing.shareAsync(file.uri, {
        mimeType: attachmentMimeType(current),
        dialogTitle: `存储到文件或导出 ${current.name}`,
        ...(UTI ? { UTI } : {}),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      Alert.alert(
        Platform.OS === 'android' ? '保存失败' : '导出失败',
        error instanceof Error ? error.message : '请检查网络后重试。',
      );
    } finally {
      setDownloading(false);
    }
  }, [current, auth, downloading]);

  return (
    <Modal
      visible
      animationType="fade"
      transparent={!documentMode}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={[styles.backdrop, documentMode && { backgroundColor: theme.background }]}>
        {documentMode && current ? (
          <View style={styles.documentPage}>
            <AttachmentDocumentPreview attachment={current} auth={auth} />
          </View>
        ) : (
          <FlatList
            data={attachments}
            horizontal
            pagingEnabled
            initialScrollIndex={index}
            getItemLayout={(_data, itemIndex) => ({ length: width, offset: width * itemIndex, index: itemIndex })}
            keyExtractor={(item) => item.attachmentId}
            onMomentumScrollEnd={(event) => {
              const next = Math.round(event.nativeEvent.contentOffset.x / Math.max(1, width));
              setIndex(Math.max(0, Math.min(next, attachments.length - 1)));
            }}
            renderItem={({ item, index: itemIndex }) => (
              <ScrollView
                style={{ width }}
                contentContainerStyle={styles.page}
                maximumZoomScale={3}
                minimumZoomScale={1}
                centerContent
                showsHorizontalScrollIndicator={false}
                showsVerticalScrollIndicator={false}
              >
                <AttachmentImage
                  attachment={item}
                  auth={auth}
                  style={{ width, height: height * 0.72 }}
                  contentFit="contain"
                  accessibilityLabel={`第 ${itemIndex + 1} 张图片，共 ${attachments.length} 张，${item.name}`}
                />
              </ScrollView>
            )}
          />
        )}

        <View style={styles.header} pointerEvents="box-none">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={documentMode ? '关闭附件预览' : '关闭图片预览'}
            onPress={onClose}
            style={[styles.close, documentMode && { backgroundColor: theme.surfaceMuted }]}
          >
            <Text style={[styles.closeText, documentMode && { color: theme.text }]}>关闭</Text>
          </Pressable>
          <View style={styles.headerRight}>
            {!documentMode && attachments.length > 1 ? (
              <Text style={styles.counter}>
                {index + 1} / {attachments.length}
              </Text>
            ) : null}
            {current && auth ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={Platform.OS === 'android'
                  ? `保存原文件到本地 ${current.name}`
                  : `导出原文件 ${current.name}，可选择存储到文件`}
                disabled={downloading}
                onPress={() => void handleDownload()}
                style={({ pressed }) => [
                  styles.download,
                  documentMode && { backgroundColor: theme.surfaceMuted },
                  pressed && styles.pressed,
                ]}
              >
                {downloading ? (
                  <ActivityIndicator size="small" color={documentMode ? theme.text : '#fff'} />
                ) : (
                  <Text style={[styles.downloadText, documentMode && { color: theme.text }]}>保存</Text>
                )}
              </Pressable>
            ) : null}
          </View>
        </View>

        <View style={styles.footer} pointerEvents="none">
          <Text numberOfLines={1} style={[styles.caption, documentMode && { color: theme.textSecondary }]}>
            {current?.name ?? ''}
          </Text>
          {current?.state === 'failed' || current?.state === 'unavailable' ? (
            <Text style={[styles.caption, documentMode && { color: theme.textSecondary }]}>
              {current?.errorCode === 'attachment_denied'
                ? '桌面拒绝提供该文件'
                : documentMode
                  ? '该文件当前不可用，可重试获取'
                  : '该文件当前不可用'}
            </Text>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000' },
  documentPage: { flex: 1, paddingTop: 108, paddingBottom: 82 },
  page: { alignItems: 'center', justifyContent: 'center' },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 56,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  close: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.16)' },
  closeText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  counter: { color: '#fff', fontSize: 14, fontWeight: '600' },
  download: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.16)' },
  downloadText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  pressed: { opacity: 0.7 },
  footer: { position: 'absolute', bottom: 40, left: 16, right: 16, alignItems: 'center', gap: 4 },
  caption: { color: 'rgba(255,255,255,0.86)', fontSize: 13 },
});
