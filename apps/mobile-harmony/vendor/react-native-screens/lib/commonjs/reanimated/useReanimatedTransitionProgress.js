"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = useReanimatedTransitionProgress;
var React = _interopRequireWildcard(require("react"));
var _ReanimatedTransitionProgressContext = _interopRequireDefault(require("./ReanimatedTransitionProgressContext"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
var cache;
function _interopRequireWildcard(e, t) { if (!t && e && e.__esModule) return e; var r, c, a = Object.defineProperty, n = { __proto__: null, default: e }; if (Object(e) !== e) return n; if (cache || "function" != typeof WeakMap || (cache = new WeakMap()), cache) { if (cache.has(e)) return cache.get(e); cache.set(e, n); } for (c in e) "default" !== c && {}.hasOwnProperty.call(e, c) && ((r = a && Object.getOwnPropertyDescriptor(e, c)) && (r.get || r.set) ? a(n, c, r) : n[c] = e[c]); return n; }
function useReanimatedTransitionProgress() {
  const progress = React.useContext(_ReanimatedTransitionProgressContext.default);
  if (progress === undefined) {
    throw new Error("Couldn't find values for reanimated transition progress. Are you inside a screen in Native Stack?");
  }
  return progress;
}
//# sourceMappingURL=useReanimatedTransitionProgress.js.map