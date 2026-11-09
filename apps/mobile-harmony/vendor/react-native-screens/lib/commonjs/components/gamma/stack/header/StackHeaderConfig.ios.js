"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = StackHeaderConfig;
var _react = _interopRequireWildcard(require("react"));
var _StackHeaderConfigIOSNativeComponent = _interopRequireDefault(require("../../../../fabric/gamma/stack/StackHeaderConfigIOSNativeComponent"));
var _StackHeaderItemSpacer = _interopRequireDefault(require("./ios/StackHeaderItemSpacer.ios"));
var _StackHeaderItem = _interopRequireDefault(require("./ios/StackHeaderItem.ios"));
var _reactNative = require("react-native");
var _utils = require("./utils");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
var cache;
function _interopRequireWildcard(e, t) { if (!t && e && e.__esModule) return e; var r, c, a = Object.defineProperty, n = { __proto__: null, default: e }; if (Object(e) !== e) return n; if (cache || "function" != typeof WeakMap || (cache = new WeakMap()), cache) { if (cache.has(e)) return cache.get(e); cache.set(e, n); } for (c in e) "default" !== c && {}.hasOwnProperty.call(e, c) && ((r = a && Object.getOwnPropertyDescriptor(e, c)) && (r.get || r.set) ? a(n, c, r) : n[c] = e[c]); return n; }
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * EXPERIMENTAL API, MIGHT CHANGE W/O ANY NOTICE
 */
function StackHeaderConfig(props) {
  // android props are safely dropped
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const {
    ios,
    android,
    ...restProps
  } = props;
  const {
    leadingItems,
    trailingItems,
    titleItem,
    subtitleItem,
    largeSubtitleItem,
    largeTitle,
    largeSubtitle,
    largeTitleEnabled
  } = ios ?? {};
  const handleMenuItemPress = (0, _react.useCallback)(event => {
    const items = Array.of(...(leadingItems ?? []).filter(it => it && it.type === 'item'), ...(trailingItems ?? []).filter(it => it && it.type === 'item'));
    const menuElement = (0, _utils.findMenuElementByIdInItems)(items, event.nativeEvent.menuItemId);
    if (menuElement && menuElement.type === 'menuItem') {
      menuElement.onPress?.();
    }
  }, [leadingItems, trailingItems]);
  const allMenuItems = [...(leadingItems ?? []), ...(trailingItems ?? [])].filter(it => it && it.type === 'item');
  const handleSelectionChange = (0, _react.useCallback)(event => {
    const {
      menuId,
      selectedMenuItemIds
    } = event.nativeEvent;
    const menu = (0, _utils.findMenuElementByIdInItems)(allMenuItems, menuId);
    if (menu && menu.type === 'menu') {
      menu.onSelectionChange?.(selectedMenuItemIds);
    }
  }, [allMenuItems]);
  (0, _react.useEffect)(() => {
    for (const item of allMenuItems) {
      if ('menu' in item && item.menu) {
        (0, _utils.validateMenuCallbacks)(item.menu);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadingItems, trailingItems]);
  return /*#__PURE__*/_react.default.createElement(_StackHeaderConfigIOSNativeComponent.default, _extends({}, restProps, {
    collapsable: false,
    largeTitle: largeTitle,
    largeSubtitle: largeSubtitle,
    largeTitleEnabled: !!largeTitleEnabled,
    style: styles.config,
    onMenuItemPress: handleMenuItemPress,
    onMenuSelectionChange: handleSelectionChange
  }), leadingItems?.map(item => makeItemViewFromItem(item, 'leading')), titleItem && makeItemViewFromItem(titleItem, 'title'), subtitleItem && makeItemViewFromItem(subtitleItem, 'subtitle'), largeSubtitleItem && makeItemViewFromItem(largeSubtitleItem, 'largeSubtitle'), trailingItems?.map(item => makeItemViewFromItem(item, 'trailing')));
}
function makeItemViewFromItem(item, placement) {
  if ('type' in item && item.type === 'spacer') {
    const {
      id,
      ...rest
    } = item;
    if (!(placement === 'leading' || placement === 'trailing')) {
      console.warn(`[Stack] Invalid placement for spacer: "${placement}", defaulting to "trailing"`);
      placement = 'trailing';
    }
    return /*#__PURE__*/_react.default.createElement(_StackHeaderItemSpacer.default, _extends({
      key: id,
      placement: placement
    }, rest));
  }
  const {
    id,
    ...rest
  } = item;
  return /*#__PURE__*/_react.default.createElement(_StackHeaderItem.default, _extends({
    key: id,
    itemId: id,
    placement: placement
  }, rest));
}
const styles = _reactNative.StyleSheet.create({
  config: {
    position: 'absolute',
    left: 0,
    top: 0
  }
});
//# sourceMappingURL=StackHeaderConfig.ios.js.map