import { useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { AttachmentImage } from '@/components/attachment-image';
import type { MobileAttachment } from '@/types/mobile';

export type ViewerAuth = { readonly serverUrl: string; readonly accessToken: string };

/**
 * Full-screen image viewer: horizontal paging, pinch/zoom through ScrollView
 * (which keeps native gesture behaviour instead of re-implementing it) and a
 * counter for multi-image turns.
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
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(Math.min(initialIndex, Math.max(0, attachments.length - 1)));
  const current = attachments[index];

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
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

        <View style={styles.header} pointerEvents="box-none">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="关闭图片预览"
            onPress={onClose}
            style={styles.close}
          >
            <Text style={styles.closeText}>关闭</Text>
          </Pressable>
          {attachments.length > 1 ? (
            <Text style={styles.counter}>
              {index + 1} / {attachments.length}
            </Text>
          ) : null}
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
  close: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.16)' },
  closeText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  counter: { color: '#fff', fontSize: 14, fontWeight: '600' },
  footer: { position: 'absolute', bottom: 40, left: 0, right: 0, alignItems: 'center', gap: 4 },
  caption: { color: 'rgba(255,255,255,0.86)', fontSize: 13 },
});
