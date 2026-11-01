import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionButton } from '@/components/action-button';

type PairingScannerProps = {
  onClose: () => void;
  /**
   * Returns an error message when the QR payload is invalid. Returning null
   * transfers control back to the parent, which normally closes the scanner.
   */
  onScan: (data: string) => string | null;
};

export function PairingScanner({ onClose, onScan }: PairingScannerProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleBarcode = (result: BarcodeScanningResult) => {
    if (locked) {
      return;
    }
    setLocked(true);
    const scanError = onScan(result.data);
    if (scanError) {
      setError(scanError);
    }
  };

  const retry = () => {
    setError(null);
    setLocked(false);
  };

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="fullScreen"
      visible
    >
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Text style={styles.title}>扫描配对二维码</Text>
          <Pressable
            accessibilityRole="button"
            hitSlop={12}
            onPress={onClose}
            style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
          >
            <Text style={styles.closeText}>关闭</Text>
          </Pressable>
        </View>

        {!permission ? (
          <View style={styles.centered}>
            <ActivityIndicator color="#FFFFFF" />
          </View>
        ) : !permission.granted ? (
          <View style={styles.centered}>
            <Text accessibilityRole="header" style={styles.permissionTitle}>
              需要相机权限
            </Text>
            <Text style={styles.permissionText}>
              DSH Connect 只使用相机读取配对二维码，不会拍照或录像。
            </Text>
            {permission.canAskAgain ? (
              <ActionButton
                label="允许相机访问"
                onPress={() => {
                  void requestPermission();
                }}
              />
            ) : (
              <Text style={styles.permissionText}>
                相机权限已被关闭，请前往系统设置允许 DSH Connect 使用相机。
              </Text>
            )}
          </View>
        ) : (
          <View style={styles.cameraContainer}>
            <CameraView
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              facing="back"
              onBarcodeScanned={handleBarcode}
              onMountError={({ message }) => {
                setLocked(true);
                setError(`相机启动失败：${message}`);
              }}
              style={StyleSheet.absoluteFill}
            />
            <View pointerEvents="none" style={styles.overlay}>
              <View style={styles.scanFrame} />
              <Text style={styles.hint}>将管理后台生成的配对二维码放入框内</Text>
            </View>
            {error ? (
              <View style={styles.errorPanel}>
                <Text style={styles.errorText}>{error}</Text>
                <ActionButton label="重新扫描" onPress={retry} />
              </View>
            ) : null}
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#080A0F',
  },
  header: {
    minHeight: 58,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  title: {
    color: '#F7F8FC',
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '600',
  },
  closeButton: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  closeText: {
    color: '#B8C0CF',
    fontSize: 15,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.65,
  },
  centered: {
    flex: 1,
    paddingHorizontal: 32,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
  },
  permissionTitle: {
    color: '#FFFFFF',
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '700',
    textAlign: 'center',
  },
  permissionText: {
    color: '#A9B2C2',
    fontSize: 15,
    lineHeight: 23,
    textAlign: 'center',
    maxWidth: 360,
  },
  cameraContainer: {
    flex: 1,
    overflow: 'hidden',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 22,
  },
  scanFrame: {
    width: 260,
    height: 260,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: 'transparent',
  },
  hint: {
    color: '#FFFFFF',
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    paddingHorizontal: 32,
    textShadowColor: 'rgba(0, 0, 0, 0.85)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  errorPanel: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 32,
    borderRadius: 18,
    backgroundColor: 'rgba(8, 10, 15, 0.94)',
    borderWidth: 1,
    borderColor: '#343B49',
    padding: 18,
    gap: 14,
  },
  errorText: {
    color: '#FFB4BA',
    fontSize: 14,
    lineHeight: 21,
  },
});
