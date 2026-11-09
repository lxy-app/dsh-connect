"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = StackHeaderItem;
var _react = _interopRequireWildcard(require("react"));
var _StackHeaderItemIOSNativeComponent = _interopRequireDefault(require("../../../../../fabric/gamma/stack/StackHeaderItemIOSNativeComponent"));
var _reactNative = require("react-native");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
var cache;
function _interopRequireWildcard(e, t) { if (!t && e && e.__esModule) return e; var r, c, a = Object.defineProperty, n = { __proto__: null, default: e }; if (Object(e) !== e) return n; if (cache || "function" != typeof WeakMap || (cache = new WeakMap()), cache) { if (cache.has(e)) return cache.get(e); cache.set(e, n); } for (c in e) "default" !== c && {}.hasOwnProperty.call(e, c) && ((r = a && Object.getOwnPropertyDescriptor(e, c)) && (r.get || r.set) ? a(n, c, r) : n[c] = e[c]); return n; }
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function StackHeaderItem(props) {
  const {
    render,
    onPress,
    ...rest
  } = props;

  // `rest.menu` includes some JS callback within nested menu specification
  // codegen strips JS functions and replaces them with NULLT and keys of such type
  // are omitted inside RNSConvertFollyDynamicToId so we can safely pass `rest.menu` as-is

  const handlePress = (0, _react.useCallback)(_event => {
    onPress?.();
  }, [onPress]);
  return /*#__PURE__*/_react.default.createElement(_StackHeaderItemIOSNativeComponent.default, _extends({}, rest, {
    // We need to tell iOS that we want the handler to be attached only when we actually require it
    // because doing so makes the menu appear on long press instead of tap
    respondsToOnPress: !!onPress,
    onHeaderItemPress: handlePress,
    style: styles.config
  }), render?.());
}
const styles = _reactNative.StyleSheet.create({
  config: {
    position: 'absolute',
    left: 0,
    top: 0
  }
});
//# sourceMappingURL=StackHeaderItem.ios.js.map