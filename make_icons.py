import os
from PIL import Image, ImageDraw

S = 512
BLUE = (24, 95, 165, 255)
WHITE = (255, 255, 255, 255)
GREEN = (29, 158, 117, 255)

img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# 圆角背景
d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=BLUE)

# 白色表格底板
pad_x, pad_y = int(S * 0.17), int(S * 0.19)
box = [pad_x, pad_y, S - pad_x, int(S * 0.72)]
d.rounded_rectangle(box, radius=int(S * 0.03), fill=WHITE)

# 网格线（3 列 x 3 行）
x0, y0, x1, y1 = box
lw = int(S * 0.032)
for i in (1, 2):
    x = x0 + (x1 - x0) * i // 3
    d.rectangle([x - lw // 2, y0, x + lw // 2, y1], fill=BLUE)
for j in (1, 2):
    y = y0 + (y1 - y0) * j // 3
    d.rectangle([x0, y - lw // 2, x1, y + lw // 2], fill=BLUE)

# 右下角绿色下载圆标
r = int(S * 0.17)
cx, cy = int(S * 0.76), int(S * 0.76)
d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=GREEN, outline=WHITE, width=int(S * 0.022))

# 白色向下箭头
aw = int(r * 0.20)
stem_top = cy - int(r * 0.52)
stem_bot = cy + int(r * 0.10)
d.rectangle([cx - aw, stem_top, cx + aw, stem_bot], fill=WHITE)
head = int(r * 0.48)
d.polygon(
    [(cx - head, stem_bot), (cx + head, stem_bot), (cx, stem_bot + int(r * 0.62))],
    fill=WHITE,
)

out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icons")
os.makedirs(out_dir, exist_ok=True)
for size in (16, 32, 48, 128):
    img.resize((size, size), Image.LANCZOS).save(os.path.join(out_dir, "icon%d.png" % size))
print("icons ok:", sorted(os.listdir(out_dir)))
