"use strict";
'use client';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _react = _interopRequireDefault(require("react"));
var _utils = require("../utils");
var _reactNative = require("react-native");
var _SearchBarNativeComponent = _interopRequireWildcard(require("../fabric/SearchBarNativeComponent"));
var cache;
function _interopRequireWildcard(e, t) { if (!t && e && e.__esModule) return e; var r, c, a = Object.defineProperty, n = { __proto__: null, default: e }; if (Object(e) !== e) return n; if (cache || "function" != typeof WeakMap || (cache = new WeakMap()), cache) { if (cache.has(e)) return cache.get(e); cache.set(e, n); } for (c in e) "default" !== c && {}.hasOwnProperty.call(e, c) && ((r = a && Object.getOwnPropertyDescriptor(e, c)) && (r.get || r.set) ? a(n, c, r) : n[c] = e[c]); return n; }
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); } // Native components
const NativeSearchBar = _SearchBarNativeComponent.default;
const NativeSearchBarCommands = _SearchBarNativeComponent.Commands;
function SearchBar(props, forwardedRef) {
  const searchBarRef = _react.default.useRef(null);
  _react.default.useImperativeHandle(forwardedRef, () => ({
    blur: () => {
      _callMethodWithRef(ref => NativeSearchBarCommands.blur(ref));
    },
    focus: () => {
      _callMethodWithRef(ref => NativeSearchBarCommands.focus(ref));
    },
    toggleCancelButton: flag => {
      _callMethodWithRef(ref => NativeSearchBarCommands.toggleCancelButton(ref, flag));
    },
    clearText: () => {
      _callMethodWithRef(ref => NativeSearchBarCommands.clearText(ref));
    },
    setText: text => {
      _callMethodWithRef(ref => NativeSearchBarCommands.setText(ref, text));
    },
    cancelSearch: () => {
      _callMethodWithRef(ref => NativeSearchBarCommands.cancelSearch(ref));
    }
  }));
  const _callMethodWithRef = _react.default.useCallback(method => {
    const ref = searchBarRef.current;
    if (ref) {
      method(ref);
    } else {
      console.warn('Reference to native search bar component has not been updated yet');
    }
  }, [searchBarRef]);
  if (!_utils.isSearchBarAvailableForCurrentPlatform) {
    console.warn('Importing SearchBar is only valid on iOS and Android devices.');
    return _reactNative.View;
  }
  const {
    obscureBackground,
    hideNavigationBar,
    onFocus,
    onBlur,
    onSearchButtonPress,
    onCancelButtonPress,
    onChangeText,
    ...rest
  } = props;
  return /*#__PURE__*/_react.default.createElement(NativeSearchBar, _extends({
    ref: searchBarRef
  }, rest, {
    obscureBackground: (0, _utils.parseBooleanToOptionalBooleanNativeProp)(obscureBackground),
    hideNavigationBar: (0, _utils.parseBooleanToOptionalBooleanNativeProp)(hideNavigationBar),
    onSearchFocus: onFocus,
    onSearchBlur: onBlur,
    onSearchButtonPress: onSearchButtonPress,
    onCancelButtonPress: onCancelButtonPress,
    onChangeText: onChangeText
  }));
}
var _default = exports.default = /*#__PURE__*/_react.default.forwardRef(SearchBar);
//# sourceMappingURL=SearchBar.js.map