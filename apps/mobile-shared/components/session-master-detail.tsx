import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

/** Keeps the session browser outside the keyed/chat detail lifecycle. */
export function SessionMasterDetail({
  master,
  masterWidth,
  borderColor,
  children,
}: {
  master: ReactNode;
  masterWidth: number;
  borderColor: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.row}>
      {masterWidth > 0 ? (
        <View style={[styles.master, { width: masterWidth, borderColor }]}>{master}</View>
      ) : null}
      <View style={styles.detail}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flex: 1,
    flexDirection: 'row',
    minWidth: 0,
  },
  master: {
    flexGrow: 0,
    flexShrink: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  detail: {
    flex: 1,
    minWidth: 0,
  },
});
