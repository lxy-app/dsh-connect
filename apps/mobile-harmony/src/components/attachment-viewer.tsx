import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AttachmentDocumentViewer } from '@/components/attachment-document-viewer';
import { AttachmentImage } from '@/components/attachment-image';
import { AttachmentPreviewFeedback, usePreviewFeedback } from '@/components/attachment-preview-feedback';
import { useAppTheme } from '@/hooks/use-app-theme';
import { downloadOriginalFile } from '@/lib/attachment-original';
import { saveOriginalAttachment } from '@/lib/attachment-save';
import type { MobileAttachment } from '@shared/types/mobile';

export type ViewerAuth = { readonly serverUrl: string; readonly accessToken: string };
export type AttachmentViewerSelection =
  | {
    readonly kind: 'image';
    readonly attachments: readonly MobileAttachment[];
    readonly initialIndex: number;
  }
  | {
    readonly kind: 'document';
    readonly attachment: MobileAttachment;
  };

/** One modal owner for images and documents; only images enter the pager. */
export function AttachmentViewer({
  selection,
  auth,
  onClose,
}: {
  selection: AttachmentViewerSelection;
  auth: ViewerAuth | null;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const { message, notify } = usePreviewFeedback();
  const saveController = useRef<AbortController | null>(null);
  useEffect(() => () => saveController.current?.abort(), []);
  const [index, setIndex] = useState(() => selection.kind === 'image'
    ? Math.min(selection.initialIndex, Math.max(0, selection.attachments.length - 1))
    : 0);
  const [saving, setSaving] = useState(false);
  const current = selection.kind === 'image' ? selection.attachments[index] : selection.attachment;

  const handleSave = useCallback(async () => {
    if (!current || !auth || saving) return;
    setSaving(true);
    const controller = new AbortController();
    saveController.current = controller;
    try {
      const { file } = await downloadOriginalFile(current, auth, { signal: controller.signal });
      const result = await saveOriginalAttachment(file.uri, current.name);
      if (controller.signal.aborted) return;
      if (result === 'saved') {
        if (selection.kind === 'document') notify('已保存到所选位置');
        else Alert.alert('保存成功', `“${current.name}”已保存到你选择的位置。`);
      }
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) return;
      Alert.alert('保存失败', error instanceof Error ? error.message : '请检查网络或本机存储后重试。');
    } finally {
      if (!controller.signal.aborted) setSaving(false);
    }
  }, [current, auth, saving, selection.kind, notify]);

  if (selection.kind === 'document') {
    return (
      <Modal visible animationType="fade" transparent onRequestClose={onClose} statusBarTranslucent>
        <View style={[styles.documentBackdrop, {
          backgroundColor: theme.surface,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        }]}>
          <View style={[styles.documentToolbar, { borderColor: theme.border }]}>
            <Pressable accessibilityRole="button" accessibilityLabel="关闭文档预览" onPress={onClose}
              style={({ pressed }) => [styles.documentAction, pressed && styles.pressed]}>
              <Text style={[styles.documentActionText, { color: theme.text }]}>关闭</Text>
            </Pressable>
            <Text numberOfLines={1} ellipsizeMode="middle" accessibilityLabel={selection.attachment.name}
              style={[styles.documentTitle, { color: theme.text }]}>{selection.attachment.name}</Text>
            <View style={styles.documentAction}>
              {auth ? (
                <Pressable accessibilityRole="button"
                  accessibilityLabel={saving ? '正在保存文件' : '保存原文件到本地'}
                  accessibilityState={{ disabled: saving, busy: saving }}
                  disabled={saving} onPress={() => void handleSave()}
                  style={({ pressed }) => [styles.documentAction, pressed && styles.pressed]}>
                  {saving ? <ActivityIndicator size="small" color={theme.text} />
                    : <Text style={[styles.documentActionText, { color: theme.text }]}>保存</Text>}
                </Pressable>
              ) : null}
            </View>
          </View>
          <View style={[styles.documentPage, { backgroundColor: theme.background }]}>
            <AttachmentDocumentViewer attachment={selection.attachment} auth={auth} />
          </View>
          <AttachmentPreviewFeedback message={message} bottom={insets.bottom + 20} />
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
          <FlatList
            data={selection.attachments}
            horizontal
            pagingEnabled
            initialScrollIndex={index}
            getItemLayout={(_data, itemIndex) => ({ length: width, offset: width * itemIndex, index: itemIndex })}
            keyExtractor={(item) => item.attachmentId}
            onMomentumScrollEnd={(event) => {
              const next = Math.round(event.nativeEvent.contentOffset.x / Math.max(1, width));
              setIndex(Math.max(0, Math.min(next, selection.attachments.length - 1)));
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
                  accessibilityLabel={`第 ${itemIndex + 1} 张图片，共 ${selection.attachments.length} 张，${item.name}`}
                />
              </ScrollView>
            )}
          />

        <View style={styles.header} pointerEvents="box-none">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="关闭图片预览"
            onPress={onClose}
            style={styles.close}
          >
            <Text style={styles.closeText}>关闭</Text>
          </Pressable>
          <View style={styles.headerRight}>
            {selection.kind === 'image' && selection.attachments.length > 1 ? (
              <Text style={styles.counter}>
                {index + 1} / {selection.attachments.length}
              </Text>
            ) : null}
            {current && auth ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={saving ? `正在保存 ${current.name}` : `保存原文件 ${current.name} 到本地`}
                disabled={saving}
                onPress={() => void handleSave()}
                style={({ pressed }) => [styles.download, pressed && styles.pressed]}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.downloadText}>保存</Text>
                )}
              </Pressable>
            ) : null}
          </View>
        </View>

        <View style={styles.footer} pointerEvents="none">
          <Text numberOfLines={1} style={styles.caption}>
            {current?.name ?? ''}
          </Text>
          {current?.state === 'failed' || current?.state === 'unavailable' ? (
            <Text style={styles.caption}>
              {current?.errorCode === 'attachment_denied' ? '桌面拒绝提供该文件' : '该文件当前不可用'}
            </Text>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000' },
  page: { alignItems: 'center', justifyContent: 'center' },
  documentBackdrop: { flex: 1 },
  documentPage: { flex: 1 },
  documentToolbar: { minHeight: 56, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  documentAction: { minWidth: 56, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  documentActionText: { fontSize: 15, fontWeight: '500' },
  documentTitle: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '500', textAlign: 'center' },
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
  footer: { position: 'absolute', bottom: 40, left: 0, right: 0, alignItems: 'center', gap: 4 },
  caption: { color: 'rgba(255,255,255,0.86)', fontSize: 13 },
});
