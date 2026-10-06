"""Генерация дефолтной аватарки PeakHunter.

Картинка нужна статикой в frontend/public/img/avatar-default.png:
она подставляется, когда у пользователя avatar_url IS NULL.
Рисуем кодом, а не держим бинарник «из фотошопа», чтобы источник
картинки был в репозитории и её можно было перегенерировать.

Запуск: python make-default-avatar.py <каталог frontend/public/img>
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw

# Фон — из палитры приложения (тот же синий, что в theme_color манифеста).
BG = (11, 61, 145, 255)
FG = (255, 255, 255, 255)

# Маска: аватарка круглая, поэтому рисуем по суперсэмплингу и уменьшаем —
# так край круга остаётся гладким, без «лестницы».
SCALE = 4


def draw_default(size: int) -> Image.Image:
    """Круг с силуэтом человека — нейтральный дефолт без букв."""
    big = size * SCALE
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    d.ellipse((0, 0, big - 1, big - 1), fill=BG)

    # Голова.
    head_r = big * 0.155
    head_cx, head_cy = big / 2, big * 0.375
    d.ellipse(
        (head_cx - head_r, head_cy - head_r, head_cx + head_r, head_cy + head_r),
        fill=FG,
    )

    # Плечи: круг, срезанный нижней границей аватарки.
    body_w = big * 0.62
    body_top = big * 0.60
    d.ellipse(
        (big / 2 - body_w / 2, body_top, big / 2 + body_w / 2, body_top + body_w),
        fill=FG,
    )

    # Всё, что вылезло за пределы аватарки, отрезаем.
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, big - 1, big - 1), fill=255)
    out = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)

    return out.resize((size, size), Image.LANCZOS)


def main() -> None:
    out_dir = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    out_dir.mkdir(parents=True, exist_ok=True)

    # Один размер на все случаи: 512 в шапке и профиле избыточен,
    # но запас нужен для Retina и будущих крупных мест (превью профиля).
    # Файл показывается в 32–128 px, вес картинки после оптимизации
    # PNG — единицы килобайт, поэтому плодить размеры незачем.
    path = out_dir / "avatar-default.png"
    draw_default(512).save(path, "PNG", optimize=True)
    print(f"{path} — {path.stat().st_size} байт")


if __name__ == "__main__":
    main()
