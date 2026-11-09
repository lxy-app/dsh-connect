"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = DebugContainer;
var React = _interopRequireWildcard(require("react"));
var _ScreenContentWrapper = _interopRequireDefault(require("./ScreenContentWrapper"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
var cache;
function _interopRequireWildcard(e, t) { if (!t && e && e.__esModule) return e; var r, c, a = Object.defineProperty, n = { __proto__: null, default: e }; if (Object(e) !== e) return n; if (cache || "function" != typeof WeakMap || (cache = new WeakMap()), cache) { if (cache.has(e)) return cache.get(e); cache.set(e, n); } for (c in e) "default" !== c && {}.hasOwnProperty.call(e, c) && ((r = a && Object.getOwnPropertyDescriptor(e, c)) && (r.get || r.set) ? a(n, c, r) : n[c] = e[c]); return n; }
function DebugContainer(props) {
  return /*#__PURE__*/React.createElement(_ScreenContentWrapper.default, props);
}
//# sourceMappingURL=DebugContainer.web.js.map