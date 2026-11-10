#!/usr/bin/env python3
"""从选定的鲲主题候选图生成 Expo / iOS / Android 图标资源。

源图：kun-B-connection-ring.png（2048×2048，白色鲲标 + 靛蓝底）
输出：暖白底（#F4F6F8）+ 炭黑鲲标（#232529），保留源图解混出的抗锯齿边缘。
产物：assets/images/*.png 与 assets/expo.icon/（iOS 26 Icon Composer 包）

设计约束（平台规则决定的，不是审美偏好）：
- iOS / App Store 要求图标为不透明正方形，圆角由系统裁切，禁止 alpha 通道。
- Android 自适应图标 = 不透明背景层 + 透明前景层（内容落在中间 66% 安全区）+ 单色层。
因此"圆角 + 背景透明"只体现在前景层与展示用预览图上。

用法：python3 build-icon-assets.py
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
ASSETS = HERE.parent
IMAGES = ASSETS / "images"
SOURCE = HERE / "kun-B-connection-ring.png"

# 前景/单色层：标记宽度占画布比例（Android 自适应图标安全区为中间 66%）
MARK_RATIO = 0.62
ALPHA_FLOOR = 0.06
ICON_BACKGROUND = (244, 246, 248)  # 暖白，不使用纯白
ICON_MARK = (35, 37, 41, 255)  # 炭黑，不使用纯黑


def estimate_background(im: Image.Image) -> tuple[int, int, int]:
    """用四边像素的中位数估计纯色底，避免边缘反光影响。"""
    px = im.load()
    w, h = im.size
    samples = []
    for x in range(0, w, 7):
        for y in (2, 3, h - 3, h - 4):
            samples.append(px[x, y])
    for y in range(0, h, 7):
        for x in (2, 3, w - 3, w - 4):
            samples.append(px[x, y])
    return tuple(sorted(s[i] for s in samples)[len(samples) // 2] for i in range(3))


def extract_mark(im: Image.Image, bg: tuple[int, int, int]) -> Image.Image:
    """把白色标记从纯色底中解混出来，输出白字透明底 RGBA。

    observed = a*white + (1-a)*bg  =>  a = (C-bg)/(255-bg)
    底纹有 ±10 级噪声，所以先用硬阈值定位图标范围，再在范围内保留抗锯齿软边，
    避免整幅画布残留半透明噪点（作为 Android 前景层会变成一层白雾）。
    """
    arr = np.asarray(im.convert("RGB")).astype(np.float32)
    base = np.asarray(bg, dtype=np.float32)
    a = ((arr - base) / (255.0 - base)).mean(axis=2).clip(0, 1)

    hard = a > 0.5
    ys, xs = np.nonzero(hard)
    pad = 4
    y0, y1 = max(0, ys.min() - pad), min(a.shape[0], ys.max() + 1 + pad)
    x0, x1 = max(0, xs.min() - pad), min(a.shape[1], xs.max() + 1 + pad)

    alpha = np.zeros_like(a)
    alpha[y0:y1, x0:x1] = a[y0:y1, x0:x1]
    alpha = np.clip((alpha - ALPHA_FLOOR) / (1.0 - ALPHA_FLOOR), 0, 1)
    alpha_img = Image.fromarray((alpha * 255).astype(np.uint8), "L")
    alpha_img = alpha_img.filter(ImageFilter.MedianFilter(3))

    mark = Image.new("RGBA", im.size, (255, 255, 255, 0))
    mark.putalpha(alpha_img)
    return mark


def fit(mark: Image.Image, canvas: int, ratio: float, color=None, pad_ratio=0.0) -> Image.Image:
    """把标记按目标宽度比例缩放到 canvas 画布中央。"""
    bbox = mark.getbbox()
    if not bbox:
        raise SystemExit("标记提取为空，检查阈值")
    cropped = mark.crop(bbox)
    target_w = int(canvas * ratio)
    scale = target_w / cropped.width
    target_h = max(1, round(cropped.height * scale))
    resized = cropped.resize((target_w, target_h), Image.LANCZOS)
    if color is not None:
        solid = Image.new("RGBA", resized.size, color)
        solid.putalpha(resized.getchannel("A"))
        resized = solid
    out = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    out.paste(resized, ((canvas - target_w) // 2, (canvas - target_h) // 2), resized)
    return out


def rounded_preview(icon: Image.Image, radius_ratio: float = 0.2237) -> Image.Image:
    """展示用：iOS 风格圆角 + 外部透明。不用于提交 App Store。"""
    size = icon.size[0]
    radius = int(size * radius_ratio)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius, fill=255)
    out = icon.convert("RGBA")
    out.putalpha(mask)
    return out


def main() -> None:
    src = Image.open(SOURCE).convert("RGB")
    source_bg = estimate_background(src)
    mark = extract_mark(src, source_bg)
    bbox = mark.getbbox()
    print(f"源图背景 #{source_bg[0]:02X}{source_bg[1]:02X}{source_bg[2]:02X}，标记 bbox={bbox}")
    print("目标配色：背景 #F4F6F8，鲲标 #232529")

    # iOS / 通用图标：从透明轮廓重新合成，避免直接改色留下紫色边缘。
    icon = Image.new("RGBA", src.size, ICON_BACKGROUND + (255,))
    mark_layer = Image.new("RGBA", src.size, ICON_MARK)
    mark_layer.putalpha(mark.getchannel("A"))
    icon = Image.alpha_composite(icon, mark_layer).convert("RGB")
    icon = icon.resize((1024, 1024), Image.LANCZOS)
    icon.save(IMAGES / "icon.png", optimize=True)

    # favicon：不透明小图
    icon.resize((48, 48), Image.LANCZOS).save(IMAGES / "favicon.png", optimize=True)

    # Android 自适应：炭黑透明前景 + 不透明暖白背景。
    fit(mark, 512, MARK_RATIO, color=ICON_MARK).save(IMAGES / "android-icon-foreground.png", optimize=True)
    Image.new("RGB", (512, 512), ICON_BACKGROUND).save(IMAGES / "android-icon-background.png", optimize=True)
    # 单色层是系统重新着色的掩膜，必须保留纯黑，不作为直接显示的品牌色。
    fit(mark, 432, MARK_RATIO, color=(0, 0, 0, 255)).save(
        IMAGES / "android-icon-monochrome.png", optimize=True
    )

    # 启动图：浅色页用炭黑鲲标，深色页用暖白鲲标，均为透明底。
    fit(mark, 456, 0.86, color=ICON_MARK).save(IMAGES / "splash-icon.png", optimize=True)
    fit(mark, 456, 0.86, color=ICON_BACKGROUND + (255,)).save(
        IMAGES / "splash-icon-dark.png", optimize=True
    )

    # iOS 26 Icon Composer 包：暖白底 + 炭黑标记图层
    expo_icon = ASSETS / "expo.icon"
    (expo_icon / "Assets").mkdir(parents=True, exist_ok=True)
    fit(mark, 1024, 0.66, color=ICON_MARK).save(expo_icon / "Assets" / "kun-mark.png", optimize=True)
    fill = "extended-srgb:{:.5f},{:.5f},{:.5f},1.00000".format(
        *(channel / 255 for channel in ICON_BACKGROUND)
    )
    (expo_icon / "icon.json").write_text(
        "{\n"
        '  "fill" : {\n'
        f'    "automatic-gradient" : "{fill}"\n'
        "  },\n"
        '  "groups" : [\n'
        "    {\n"
        '      "layers" : [\n'
        "        {\n"
        '          "image-name" : "kun-mark.png",\n'
        '          "name" : "kun"\n'
        "        }\n"
        "      ]\n"
        "    }\n"
        "  ],\n"
        '  "supported-platforms" : {\n'
        '    "circles" : [\n'
        '      "watchOS"\n'
        "    ],\n"
        '    "squares" : "shared"\n'
        "  }\n"
        "}\n",
        encoding="utf-8",
    )

    # 展示用圆角透明版（README / 官网 / 商店截图），不能当 iOS 源图
    rounded_preview(icon).save(HERE / "kun-B-app-icon-rounded.png", optimize=True)

    for path in sorted(IMAGES.glob("*.png")) + [expo_icon / "Assets" / "kun-mark.png"]:
        with Image.open(path) as im:
            print(f"{path.relative_to(ASSETS)}  {im.size[0]}x{im.size[1]}  {im.mode}")


if __name__ == "__main__":
    main()
