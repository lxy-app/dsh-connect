// M0 鸿蒙占位：上游 4.26.2 只提供 android/ios/web 的 TabsHost，鸿蒙没有对应实现。
// 这里退回一个空 View，仅用于让打包通过；DSH Connect 不使用 Tabs。
import { View } from 'react-native';
export default View;
