"""Генерация графики PeakHunter.

Источники — в `scripts/assets/`:

  * `logo.png`   — иллюстрация проекта (двое у горы), от неё идут все
    крупные растровые версии: иконки PWA, логотип для писем и картинка
    на странице входа;
  * `zhdun.png`  — рисунок для дефолтной аватарки.

Мелочь (знак в шапке `logo.svg` и `favicon.ico`) по-прежнему рисуется
кодом: в 16–28 px иллюстрация превращается в пятно, а простой знак
читается. Поэтому в проекте две сущности, и это не расхождение:
иллюстрация — для крупного, знак — для мелкого.

Что делает:
  1. frontend/public/logo.svg   — знак проекта для шапки;
  2. frontend/public/logo-1024.png — иллюстрация растром: письма,
     соцсети, превью, где SVG не всегда можно;
  3. frontend/public/icons/*.png — иконки PWA: 192, 512 и maskable.
     Размеры и имена заданы в manifest (см. vite.config.ts);
  4. frontend/public/img/site-logo.webp — иллюстрация для страницы входа
     (WebP: 692 px в PNG весят 800 КБ, а на странице нужен ~240 px);
  5. frontend/public/img/avatar-default-{512,192,96}.png — дефолтная
     аватарка из `zhdun.png`. Три размера под Retina;
  6. frontend/public/favicon.ico — знак, 16–64 px.

Запуск: python generate-assets.py <каталог frontend/public>
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

# ─── палитра знака ───
# Фиксированная, а не из сезонных тем: логотип не должен менять цвет
# при смене сезона, иначе перестаёт быть логотипом.
BLUE_DARK = (11, 61, 145)
BLUE_MID = (47, 111, 176)
BLUE_LIGHT = (108, 160, 214)
SUN = (245, 166, 35)
SNOW = (234, 242, 251)
SILHOUETTE = (26, 42, 61)

# Бумажный фон иллюстрации — подложка для maskable-иконки.
PAPER = (250, 249, 243)

# Исходники графики: рядом со скриптом, а не в public/. В public/ едет
# только то, что нужно браузеру, — иначе исходник на 800 КБ качался бы
# пользователями как есть.
ASSETS = Path(__file__).parent / "assets"


def load_source(name: str) -> Image.Image:
    """Открыть исходник из `scripts/assets`."""
    path = ASSETS / name
    if not path.exists():
        raise SystemExit(f"Нет исходника графики: {path}")
    return Image.open(path).convert("RGBA")


def resized(image: Image.Image, size: int) -> Image.Image:
    """Квадрат нужного размера: LANCZOS, иначе края рвутся."""
    return image.resize((size, size), Image.LANCZOS)


def draw_logo(size: int) -> Image.Image:
    """Знак проекта: две вершины и солнце на синем скруглённом квадрате."""
    big = size * 4  # суперсэмплинг: иначе края скруглений и вершин рвутся
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

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
        fill=(20, 78, 168),
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


def draw_avatar(size: int) -> Image.Image:
    """Дефолтная аватарка: рисунок из `assets/zhdun.png`.

    Раньше персонажа рисовали кодом — мешковатое тело, короткие руки,
    хобот, панама и рюкзак на фоне хребта. Теперь исходник прислан
    рисунком, и повторять его примитивами незачем: детали вроде штриховки
    всё равно не воспроизвести, а расхождение с оригиналом заметно.

    Круглую форму по-прежнему даёт CSS (`rounded-full`), картинка
    квадратная.
    """
    return resized(load_source("zhdun.png"), size)


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

    logo = load_source("logo.png")

    # Мелкое — из знака: в шапке 28 px и в favicon 16 px иллюстрация
    # превращается в пятно, а простой знак читается.
    (public / "logo.svg").write_text(logo_svg(), encoding="utf-8")
    draw_logo(64).save(public / "favicon.ico", sizes=[(16, 16), (32, 32), (64, 64)])

    # Крупное — из иллюстрации: письма и соцсети (1024), иконки PWA
    # (192 и 512), картинка на странице входа.
    resized(logo, 1024).save(public / "logo-1024.png", "PNG", optimize=True)
    resized(logo, 192).save(public / "icons" / "icon-192.png", "PNG", optimize=True)
    resized(logo, 512).save(public / "icons" / "icon-512.png", "PNG", optimize=True)

    # Maskable: Android обрезает такую иконку своей маской, поэтому важное
    # должно попасть в центральные ~80 %. Иллюстрация — круглая виньетка
    # на прозрачном фоне, поэтому кладём её на бумажный фон рисунка с
    # запасом по краям: под любой маской останется целая картинка.
    maskable = Image.new("RGBA", (512, 512), PAPER)
    inner = resized(logo, 430)
    maskable.alpha_composite(inner, ((512 - 430) // 2, (512 - 430) // 2))
    maskable.save(public / "icons" / "icon-maskable.png", "PNG", optimize=True)

    # Страница входа: WebP, потому что исходник в PNG весит 800 КБ,
    # а на странице картинка показывается около 240 px.
    resized(logo, 320).save(
        public / "img" / "site-logo.webp", "WEBP", quality=88, method=6
    )

    # Дефолтная аватарка: три размера. 512 — для кабинета (400 px при 1.25x
    # уже требуют больше, чем 400), 192 — с запасом для шапки, 96 — мелкие
    # места. В srcset браузер выберет сам.
    for size in (512, 192, 96):
        draw_avatar(size).save(
            public / "img" / f"avatar-default-{size}.png", "PNG", optimize=True
        )

    for path in sorted(public.rglob("*")):
        if path.is_file():
            print(f"{path} — {path.stat().st_size} байт")


if __name__ == "__main__":
    main()
