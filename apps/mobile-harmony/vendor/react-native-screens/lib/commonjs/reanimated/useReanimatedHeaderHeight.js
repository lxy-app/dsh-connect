"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = useReanimatedHeaderHeight;
var React = _interopRequireWildcard(require("react"));
var _ReanimatedHeaderHeightContext = _interopRequireDefault(require("./ReanimatedHeaderHeightContext"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
var cache;
function _interopRequireWildcard(e, t) { if (!t && e && e.__esModule) return e; var r, c, a = Object.defineProperty, n = { __proto__: null, default: e }; if (Object(e) !== e) return n; if (cache || "function" != typeof WeakMap || (cache = new WeakMap()), cache) { if (cache.has(e)) return cache.get(e); cache.set(e, n); } for (c in e) "default" !== c && {}.hasOwnProperty.call(e, c) && ((r = a && Object.getOwnPropertyDescriptor(e, c)) && (r.get || r.set) ? a(n, c, r) : n[c] = e[c]); return n; }
function useReanimatedHeaderHeight() {
  const height = React.useContext(_ReanimatedHeaderHeightContext.default);
  if (height === undefined) {
    throw new Error("Couldn't find the header height using Reanimated. Are you inside a screen in a navigator with a header and your NavigationContainer is wrapped in ReanimatedScreenProvider?");
  }
  return height;
}
//# sourceMappingURL=useReanimatedHeaderHeight.js.map