import { ConnectScreen } from '@/features/pairing/connect-screen';

/**
 * Deep-link alias for dshconnect://pair?...
 * The scanner remains available if the QR is opened from inside the App.
 */
export default function PairRoute() {
  return <ConnectScreen />;
}
