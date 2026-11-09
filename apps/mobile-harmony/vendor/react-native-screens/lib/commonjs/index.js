"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
var _exportNames = {
  enableScreens: true,
  enableFreeze: true,
  screensEnabled: true,
  freezeEnabled: true,
  Screen: true,
  InnerScreen: true,
  ScreenContext: true,
  ScreenStackHeaderConfig: true,
  ScreenStackHeaderSubview: true,
  ScreenStackHeaderLeftView: true,
  ScreenStackHeaderCenterView: true,
  ScreenStackHeaderRightView: true,
  ScreenStackHeaderBackButtonImage: true,
  ScreenStackHeaderSearchBarView: true,
  SearchBar: true,
  ScreenContainer: true,
  ScreenStack: true,
  ScreenStackItem: true,
  FullWindowOverlay: true,
  ScreenFooter: true,
  ScreenContentWrapper: true,
  isSearchBarAvailableForCurrentPlatform: true,
  executeNativeBackPress: true,
  compatibilityFlags: true,
  featureFlags: true,
  useTransitionProgress: true
};
Object.defineProperty(exports, "FullWindowOverlay", {
  enumerable: true,
  get: function () {
    return _FullWindowOverlay.default;
  }
});
Object.defineProperty(exports, "InnerScreen", {
  enumerable: true,
  get: function () {
    return _Screen.InnerScreen;
  }
});
Object.defineProperty(exports, "Screen", {
  enumerable: true,
  get: function () {
    return _Screen.default;
  }
});
Object.defineProperty(exports, "ScreenContainer", {
  enumerable: true,
  get: function () {
    return _ScreenContainer.default;
  }
});
Object.defineProperty(exports, "ScreenContentWrapper", {
  enumerable: true,
  get: function () {
    return _ScreenContentWrapper.default;
  }
});
Object.defineProperty(exports, "ScreenContext", {
  enumerable: true,
  get: function () {
    return _Screen.ScreenContext;
  }
});
Object.defineProperty(exports, "ScreenFooter", {
  enumerable: true,
  get: function () {
    return _ScreenFooter.default;
  }
});
Object.defineProperty(exports, "ScreenStack", {
  enumerable: true,
  get: function () {
    return _ScreenStack.default;
  }
});
Object.defineProperty(exports, "ScreenStackHeaderBackButtonImage", {
  enumerable: true,
  get: function () {
    return _ScreenStackHeaderConfig.ScreenStackHeaderBackButtonImage;
  }
});
Object.defineProperty(exports, "ScreenStackHeaderCenterView", {
  enumerable: true,
  get: function () {
    return _ScreenStackHeaderConfig.ScreenStackHeaderCenterView;
  }
});
Object.defineProperty(exports, "ScreenStackHeaderConfig", {
  enumerable: true,
  get: function () {
    return _ScreenStackHeaderConfig.ScreenStackHeaderConfig;
  }
});
Object.defineProperty(exports, "ScreenStackHeaderLeftView", {
  enumerable: true,
  get: function () {
    return _ScreenStackHeaderConfig.ScreenStackHeaderLeftView;
  }
});
Object.defineProperty(exports, "ScreenStackHeaderRightView", {
  enumerable: true,
  get: function () {
    return _ScreenStackHeaderConfig.ScreenStackHeaderRightView;
  }
});
Object.defineProperty(exports, "ScreenStackHeaderSearchBarView", {
  enumerable: true,
  get: function () {
    return _ScreenStackHeaderConfig.ScreenStackHeaderSearchBarView;
  }
});
Object.defineProperty(exports, "ScreenStackHeaderSubview", {
  enumerable: true,
  get: function () {
    return _ScreenStackHeaderConfig.ScreenStackHeaderSubview;
  }
});
Object.defineProperty(exports, "ScreenStackItem", {
  enumerable: true,
  get: function () {
    return _ScreenStackItem.default;
  }
});
Object.defineProperty(exports, "SearchBar", {
  enumerable: true,
  get: function () {
    return _SearchBar.default;
  }
});
Object.defineProperty(exports, "compatibilityFlags", {
  enumerable: true,
  get: function () {
    return _flags.compatibilityFlags;
  }
});
Object.defineProperty(exports, "enableFreeze", {
  enumerable: true,
  get: function () {
    return _core.enableFreeze;
  }
});
Object.defineProperty(exports, "enableScreens", {
  enumerable: true,
  get: function () {
    return _core.enableScreens;
  }
});
Object.defineProperty(exports, "executeNativeBackPress", {
  enumerable: true,
  get: function () {
    return _utils.executeNativeBackPress;
  }
});
Object.defineProperty(exports, "featureFlags", {
  enumerable: true,
  get: function () {
    return _flags.featureFlags;
  }
});
Object.defineProperty(exports, "freezeEnabled", {
  enumerable: true,
  get: function () {
    return _core.freezeEnabled;
  }
});
Object.defineProperty(exports, "isSearchBarAvailableForCurrentPlatform", {
  enumerable: true,
  get: function () {
    return _utils.isSearchBarAvailableForCurrentPlatform;
  }
});
Object.defineProperty(exports, "screensEnabled", {
  enumerable: true,
  get: function () {
    return _core.screensEnabled;
  }
});
Object.defineProperty(exports, "useTransitionProgress", {
  enumerable: true,
  get: function () {
    return _useTransitionProgress.default;
  }
});
require("./fabric/NativeScreensModule");
var _core = require("./core");
var _Screen = _interopRequireWildcard(require("./components/Screen"));
var _ScreenStackHeaderConfig = require("./components/ScreenStackHeaderConfig");
var _SearchBar = _interopRequireDefault(require("./components/SearchBar"));
var _ScreenContainer = _interopRequireDefault(require("./components/ScreenContainer"));
var _ScreenStack = _interopRequireDefault(require("./components/ScreenStack"));
var _ScreenStackItem = _interopRequireDefault(require("./components/ScreenStackItem"));
var _FullWindowOverlay = _interopRequireDefault(require("./components/FullWindowOverlay"));
var _ScreenFooter = _interopRequireDefault(require("./components/ScreenFooter"));
var _ScreenContentWrapper = _interopRequireDefault(require("./components/ScreenContentWrapper"));
var _utils = require("./utils");
var _flags = require("./flags");
var _useTransitionProgress = _interopRequireDefault(require("./useTransitionProgress"));
var _tabs = require("./components/tabs");
Object.keys(_tabs).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _tabs[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _tabs[key];
    }
  });
});
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
var cache;
function _interopRequireWildcard(e, t) { if (!t && e && e.__esModule) return e; var r, c, a = Object.defineProperty, n = { __proto__: null, default: e }; if (Object(e) !== e) return n; if (cache || "function" != typeof WeakMap || (cache = new WeakMap()), cache) { if (cache.has(e)) return cache.get(e); cache.set(e, n); } for (c in e) "default" !== c && {}.hasOwnProperty.call(e, c) && ((r = a && Object.getOwnPropertyDescriptor(e, c)) && (r.get || r.set) ? a(n, c, r) : n[c] = e[c]); return n; }
//# sourceMappingURL=index.js.map