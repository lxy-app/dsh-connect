"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var React = _interopRequireWildcard(require("react"));
var _reactNative = require("react-native");
var _AppContainer = _interopRequireDefault(require("react-native/Libraries/ReactNative/AppContainer"));
var _ScreenContentWrapper = _interopRequireDefault(require("./ScreenContentWrapper"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
var cache;
function _interopRequireWildcard(e, t) { if (!t && e && e.__esModule) return e; var r, c, a = Object.defineProperty, n = { __proto__: null, default: e }; if (Object(e) !== e) return n; if (cache || "function" != typeof WeakMap || (cache = new WeakMap()), cache) { if (cache.has(e)) return cache.get(e); cache.set(e, n); } for (c in e) "default" !== c && {}.hasOwnProperty.call(e, c) && ((r = a && Object.getOwnPropertyDescriptor(e, c)) && (r.get || r.set) ? a(n, c, r) : n[c] = e[c]); return n; }
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); } // @ts-expect-error importing private component
/**
 * This view must *not* be flattened.
 * See https://github.com/software-mansion/react-native-screens/pull/1825
 * for detailed explanation.
 */
let DebugContainer = ({
  contentStyle,
  style,
  ...rest
}) => {
  return /*#__PURE__*/React.createElement(_ScreenContentWrapper.default, _extends({
    style: [style, contentStyle]
  }, rest));
};
if (process.env.NODE_ENV !== 'production') {
  DebugContainer = props => {
    const {
      contentStyle,
      stackPresentation,
      style,
      ...rest
    } = props;
    const content = /*#__PURE__*/React.createElement(_ScreenContentWrapper.default, _extends({
      style: [style, contentStyle]
    }, rest));
    if (_reactNative.Platform.OS === 'ios' && stackPresentation !== 'push' && stackPresentation !== 'formSheet') {
      // This is necessary for LogBox
      return /*#__PURE__*/React.createElement(_AppContainer.default, null, content);
    }
    return content;
  };
  DebugContainer.displayName = 'DebugContainer';
}
var _default = exports.default = DebugContainer;
//# sourceMappingURL=DebugContainer.js.map