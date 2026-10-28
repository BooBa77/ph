"""Генерация графики PeakHunter.

Источники — в `scripts/assets/`:

  * `logo.png`   — иллюстрация проекта (двое у горы): от неё идут все
    крупные растровые версии — иконки PWA, логотип для писем и картинка
    на странице входа;
  * `zhdun.png`  — рисунок для дефолтной аватарки.

Знак в шапке этот скрипт больше не делает: с 28.10.2026 там сама
иллюстрация (`src/assets/logo-mark.png`, 288×288 с запасом на тройную
плотность). Векторный знак — синяя плашка, гора и две красные фигуры —
удалён вместе с ней: он был нужен, пока в шапке стоял 28-пиксельный SVG.
Кодом рисуется только `favicon.ico`: в 16 px от рисунка остаётся пятно,
а «PH» на плашке читается.

Что делает:
  1. frontend/public/logo-1024.png — иллюстрация растром: письма,
     соцсети, превью, где SVG не всегда можно;
  2. frontend/public/icons/*.png — иконки PWA: 192, 512 и maskable.
     Размеры и имена заданы в manifest (см. vite.config.ts);
  3. frontend/public/img/site-logo.webp — иллюстрация для страницы входа
     (WebP: 692 px в PNG весят 800 КБ, а на странице нужен ~240 px);
  4. frontend/public/img/avatar-default-{512,192,96}.png — дефолтная
     аватарка из `zhdun.png`. Три размера под Retina;
  5. frontend/public/favicon.ico — знак, 16–64 px.

Запуск: python generate-assets.py <каталог frontend/public>
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

# ─── палитра знака ───
# Фиксированная, а не из сезонных тем: логотип не должен менять цвет
# при смене сезона, иначе перестаёт быть логотипом. Синий и красный сняты
# с присланной иллюстрации (`assets/logo.png`) и прежнего знака проекта,
# чтобы шапка не выбивалась из бренда.
BADGE = (47, 111, 176)  # синий фон знака
RIDGE_FAR = (244, 248, 253)  # дальняя вершина — почти белая
RIDGE_NEAR = (30, 75, 134)  # ближняя вершина — глубокий синий
SNOW = (255, 255, 255)
RED = (207, 46, 59)  # куртки с рисунка
RED_LIGHT = (239, 122, 112)  # сомкнутые руки: светлее, чтобы читались

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
    """Знак для `favicon.ico`: две фигуры у горы — по мотивам иллюстрации.

    Единственное место, где простой знак ещё нужен: в 16 px от рисунка
    с двумя фигурами и штриховкой остаётся пятно. Здесь те же две фигуры
    и та же гора, но четырьмя примитивами и без деталей.

    В шапке с 28.10.2026 стоит сама иллюстрация, поэтому второго описания
    знака (SVG) больше нет: расходиться нечему.
    """
    k = (size * 4) / 64  # суперсэмплинг ×4 и система координат 64×64
    big = round(64 * k)
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    def box(x0: float, y0: float, x1: float, y1: float):
        return (x0 * k, y0 * k, x1 * k, y1 * k)

    # Скруглённый квадрат-бейдж: у знака должна быть своя форма, иначе
    # на светлой теме он растворяется в фоне.
    d.rounded_rectangle(box(0, 0, 64, 64), radius=14 * k, fill=BADGE)

    # Дальняя вершина (светлая) и ближняя (сине-серая) — так читается глубина.
    d.polygon(
        [(2 * k, 52 * k), (22 * k, 18 * k), (42 * k, 52 * k)],
        fill=RIDGE_FAR,
    )
    d.polygon(
        [(20 * k, 52 * k), (38 * k, 26 * k), (62 * k, 52 * k)],
        fill=RIDGE_NEAR,
    )

    # Снег на дальней вершине.
    d.polygon(
        [
            (22 * k, 18 * k),
            (26 * k, 25 * k),
            (23.5 * k, 26 * k),
            (22 * k, 23.5 * k),
            (20.5 * k, 26 * k),
            (17.5 * k, 25 * k),
        ],
        fill=SNOW,
    )

    # Две фигуры: корпуса, головы и сомкнутые в центре руки.
    #
    # Руки — неширокая перекладина между корпусами: широкая сливала бы
    # обе фигуры в одно красное пятно уже на 28 px, а без неё пропадает
    # сам жест — рукопожатие с иллюстрации.
    d.rounded_rectangle(box(12, 40, 26, 60), radius=7 * k, fill=RED)
    d.rounded_rectangle(box(38, 40, 52, 60), radius=7 * k, fill=RED)
    d.ellipse(box(13, 30, 25, 42), fill=RED)
    d.ellipse(box(39, 30, 51, 42), fill=RED)
    d.rounded_rectangle(box(26, 44, 38, 48), radius=2 * k, fill=RED_LIGHT)

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


def main() -> None:
    public = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    (public / "icons").mkdir(parents=True, exist_ok=True)
    (public / "img").mkdir(parents=True, exist_ok=True)

    logo = load_source("logo.png")

    # Знак остался только во вкладке браузера: favicon рисуем растром
    # из примитивов — SVG-иконку (public/favicon.svg) заказчик сделал
    # отдельно, «PH» на плашке.
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
