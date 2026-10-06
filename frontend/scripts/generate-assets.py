"""Генерация графики PeakHunter.

Рисуем кодом, а не держим бинарники «из редактора»: источник картинки
остаётся в репозитории, любую можно поправить и перегенерировать.
Интернет для этого не нужен — ни загрузок, ни лицензий.

Что делает:
  1. frontend/public/logo.svg  — знак проекта (его же просит index.html);
  2. frontend/public/logo-*.png — тот же знак растром, для писем и
     соцсетей, где SVG не всегда можно;
  3. frontend/public/icons/*.png — иконки PWA: 192, 512 и maskable.
     Размеры и имена заданы в manifest (см. vite.config.ts);
  4. frontend/public/img/avatar-default-{512,192,96}.png — дефолтная
     аватарка в хайкинг-стиле, три размера под Retina.

Иконки PWA: 192 и 512 — «any» (браузер рисует поверх свою форму),
maskable — с запасом по краям, потому что Android обрезает такую иконку
по своей маске (круг, скруглённый квадрат) и важное должно попасть
в центральные ~80 %.

Запуск: python generate-assets.py <каталог frontend/public>
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

# ─── палитра ───
# Фиксированная, а не из сезонных тем: логотип не должен менять цвет
# при смене сезона, иначе перестаёт быть логотипом.
BLUE_DARK = (11, 61, 145)
BLUE_MID = (47, 111, 176)
BLUE_LIGHT = (108, 160, 214)
SUN = (245, 166, 35)
SNOW = (234, 242, 251)
WHITE = (255, 255, 255)
SILHOUETTE = (26, 42, 61)

# Фон дефолтной аватарки: нежно-голубое небо к горизонту.
SKY_TOP = (214, 233, 247)
SKY_BOTTOM = (240, 247, 252)


def linear_gradient(size: tuple[int, int], top: tuple, bottom: tuple) -> Image.Image:
    """Вертикальный градиент. Pillow такого не умеет — рисуем построчно."""
    width, height = size
    img = Image.new("RGB", size)
    draw = ImageDraw.Draw(img)
    for y in range(height):
        k = y / max(height - 1, 1)
        color = tuple(round(top[i] + (bottom[i] - top[i]) * k) for i in range(3))
        draw.line([(0, y), (width, y)], fill=color)
    return img


def draw_logo(size: int) -> Image.Image:
    """Знак проекта: две вершины и солнце на синем скруглённом квадрате."""
    big = size * 4  # суперсэмплинг: иначе края скруглений и вершин рвутся
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Скруглённый квадрат-подложка.
    d.rounded_rectangle((0, 0, big - 1, big - 1), radius=big * 0.22, fill=BLUE_DARK)

    # Солнце.
    r = big * 0.11
    cx, cy = big * 0.69, big * 0.30
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=SUN)

    # Дальняя вершина (светлее) и ближняя (темнее) — так читается глубина.
    d.polygon(
        [(big * 0.03, big * 0.82), (big * 0.34, big * 0.31), (big * 0.66, big * 0.82)],
        fill=BLUE_MID,
    )
    d.polygon(
        [(big * 0.30, big * 0.82), (big * 0.60, big * 0.42), (big * 0.97, big * 0.82)],
        fill=BLUE_DARK if False else (20, 78, 168),
    )
    # Снег на дальней вершине.
    d.polygon(
        [
            (big * 0.34, big * 0.31),
            (big * 0.42, big * 0.45),
            (big * 0.37, big * 0.46),
            (big * 0.34, big * 0.42),
            (big * 0.31, big * 0.46),
            (big * 0.26, big * 0.45),
        ],
        fill=SNOW,
    )

    return img.resize((size, size), Image.LANCZOS)


def draw_maskable(size: int) -> Image.Image:
    """Иконка под маску Android: важное — в центральных 80 %."""
    big = size * 4
    img = Image.new("RGBA", (big, big), BLUE_DARK)
    d = ImageDraw.Draw(img)

    # Солнце и вершины — мельче и ближе к центру, чем в обычном знаке.
    r = big * 0.09
    cx, cy = big * 0.66, big * 0.34
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=SUN)

    d.polygon(
        [(big * 0.14, big * 0.76), (big * 0.38, big * 0.36), (big * 0.62, big * 0.76)],
        fill=BLUE_MID,
    )
    d.polygon(
        [(big * 0.36, big * 0.76), (big * 0.58, big * 0.46), (big * 0.86, big * 0.76)],
        fill=(20, 78, 168),
    )
    d.polygon(
        [
            (big * 0.38, big * 0.36),
            (big * 0.44, big * 0.47),
            (big * 0.40, big * 0.48),
            (big * 0.38, big * 0.45),
            (big * 0.35, big * 0.48),
            (big * 0.31, big * 0.47),
        ],
        fill=SNOW,
    )

    return img.resize((size, size), Image.LANCZOS)


def draw_avatar(size: int) -> Image.Image:
    """Дефолтная аватарка: хайкер на хребте в горах.

    Круглую форму не рисуем — её даёт CSS (`rounded-full`). Поэтому
    картинка квадратная: если однажды понадобится квадратная аватарка,
    она уже готова.
    """
    big = size * 4
    img = linear_gradient((big, big), SKY_TOP, SKY_BOTTOM).convert("RGBA")
    d = ImageDraw.Draw(img)

    # Солнце.
    r = big * 0.10
    d.ellipse((big * 0.70 - r, big * 0.20 - r, big * 0.70 + r, big * 0.20 + r), fill=SUN)

    # Дальний хребет.
    d.polygon(
        [
            (0, big * 0.78),
            (big * 0.22, big * 0.52),
            (big * 0.40, big * 0.74),
            (big * 0.56, big * 0.58),
            (big, big * 0.82),
            (big, big),
            (0, big),
        ],
        fill=BLUE_LIGHT,
    )
    # Ближний хребет — темнее, он на переднем плане.
    d.polygon(
        [
            (0, big * 0.86),
            (big * 0.30, big * 0.66),
            (big * 0.52, big * 0.84),
            (big * 0.74, big * 0.70),
            (big, big * 0.88),
            (big, big),
            (0, big),
        ],
        fill=(70, 120, 176),
    )

    # ─── хайкер ───
    # Идёт по ближнему хребту. Стоит близко к центру: аватарка круглая,
    # и всё, что ушло к краю, при обрезке уезжает за пределы круга.
    # Масштаб — от размера картинки, поэтому силуэт читается и на 96 px:
    # это силуэт, а не деталь.
    scale = big / 512
    base_x, base_y = big * 0.44, big * 0.86
    figure_h = 120 * scale

    head_r = figure_h * 0.10
    # Голова.
    d.ellipse(
        (
            base_x - head_r,
            base_y - figure_h,
            base_x + head_r,
            base_y - figure_h + head_r * 2,
        ),
        fill=SILHOUETTE,
    )
    # Корпус.
    d.line(
        [
            (base_x, base_y - figure_h + head_r * 2),
            (base_x, base_y - figure_h * 0.42),
        ],
        fill=SILHOUETTE,
        width=max(2, round(10 * scale)),
    )
    # Рюкзак — за спиной, слева.
    d.rounded_rectangle(
        (
            base_x - 4 * scale - 17 * scale,
            base_y - figure_h * 0.87,
            base_x - 4 * scale,
            base_y - figure_h * 0.51,
        ),
        radius=5 * scale,
        fill=SILHOUETTE,
    )
    # Ноги: шаг.
    d.line(
        [
            (base_x, base_y - figure_h * 0.42),
            (base_x - 17 * scale, base_y),
        ],
        fill=SILHOUETTE,
        width=max(2, round(9 * scale)),
    )
    d.line(
        [
            (base_x, base_y - figure_h * 0.42),
            (base_x + 16 * scale, base_y),
        ],
        fill=SILHOUETTE,
        width=max(2, round(9 * scale)),
    )
    # Рука с палкой.
    d.line(
        [
            (base_x, base_y - figure_h * 0.70),
            (base_x + 18 * scale, base_y - figure_h * 0.48),
        ],
        fill=SILHOUETTE,
        width=max(2, round(7 * scale)),
    )
    d.line(
        [
            (base_x + 18 * scale, base_y - figure_h * 0.58),
            (base_x + 23 * scale, base_y - figure_h * 0.02),
        ],
        fill=SILHOUETTE,
        width=max(2, round(4 * scale)),
    )

    return img.resize((size, size), Image.LANCZOS)


def logo_svg() -> str:
    """Тот же знак вектором — для шапки, favicon и писем."""
    return """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="PeakHunter">
  <title>PeakHunter</title>
  <rect width="64" height="64" rx="14" fill="#0b3d91"/>
  <circle cx="44" cy="19" r="7" fill="#f5a623"/>
  <path d="M2 52 L22 20 L42 52 Z" fill="#2f6fb0"/>
  <path d="M22 20 L27 29 L24 30 L22 27 L20 30 L17 29 Z" fill="#eaf2fb"/>
  <path d="M19 52 L38 27 L62 52 Z" fill="#144ea8"/>
</svg>
"""


def main() -> None:
    public = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    (public / "icons").mkdir(parents=True, exist_ok=True)
    (public / "img").mkdir(parents=True, exist_ok=True)

    # Логотип: SVG плюс растр на 1024 (писем и превью хватает с запасом).
    (public / "logo.svg").write_text(logo_svg(), encoding="utf-8")
    draw_logo(1024).save(public / "logo-1024.png", "PNG", optimize=True)

    # Иконки PWA: имена и размеры обязаны совпадать с manifest.
    draw_logo(192).save(public / "icons" / "icon-192.png", "PNG", optimize=True)
    draw_logo(512).save(public / "icons" / "icon-512.png", "PNG", optimize=True)
    draw_maskable(512).save(
        public / "icons" / "icon-maskable.png", "PNG", optimize=True
    )

    # Дефолтная аватарка: три размера. 512 — для кабинета (80 px при 3x
    # это 240), 192 — с запасом для шапки, 96 — для мелких мест.
    for size in (512, 192, 96):
        draw_avatar(size).save(
            public / "img" / f"avatar-default-{size}.png", "PNG", optimize=True
        )

    # Favicon: из знака, 64 px достаточно (браузер сам масштабирует).
    draw_logo(64).save(public / "favicon.ico", sizes=[(16, 16), (32, 32), (64, 64)])

    for path in sorted(public.rglob("*")):
        if path.is_file():
            print(f"{path} — {path.stat().st_size} байт")


if __name__ == "__main__":
    main()
