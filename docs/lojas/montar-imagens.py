# Monta as imagens das lojas a partir das capturas do simulador.
# Uso: python3 docs/lojas/montar-imagens.py <pasta-capturas> <icone.png> <saida>
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

src, icon_path, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
BG = (23, 24, 27)
INK = (245, 245, 245)
GREEN = (63, 179, 127)
MUTED = (170, 172, 178)
FONT = "/System/Library/Fonts/HelveticaNeue.ttc"
BOLD, REGULAR = 1, 0

SHOTS = [
    ("01-inicio", "raw-01-inicio.png", "O dinheiro da família", "num olhar só"),
    ("02-contas", "raw-02-contas.png", "Contas e cartões", "sempre em dia"),
    ("03-lancamentos", "raw-03-lancamentos.png", "Todo lançamento", "do mês, mês a mês"),
    ("04-novo-lancamento", "raw-04-novo.png", "Lance um gasto", "em segundos"),
    ("05-avisos", "raw-05-avisos.png", "Saiba o que vence", "antes de vencer"),
    ("06-perfil", "raw-06-perfil.png", "Sem anúncios,", "seus dados são seus"),
]


def font(size, weight):
    return ImageFont.truetype(FONT, size, index=weight)


def rounded(img, radius):
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, *img.size), radius, fill=255)
    img = img.convert("RGBA")
    img.putalpha(mask)
    return img


def frame(size, shot, line1, line2):
    w, h = size
    canvas = Image.new("RGB", size, BG)
    draw = ImageDraw.Draw(canvas)
    s1 = int(w * 0.082)
    top = int(h * 0.055)
    for text, color, y in ((line1, INK, top), (line2, GREEN, top + int(s1 * 1.18))):
        f = font(s1, BOLD)
        tw = draw.textlength(text, font=f)
        draw.text(((w - tw) / 2, y), text, font=f, fill=color)
    phone_w = int(w * 0.84)
    scale = phone_w / shot.width
    phone = shot.resize((phone_w, int(shot.height * scale)), Image.LANCZOS)
    phone = rounded(phone, int(phone_w * 0.11))
    border = Image.new("RGBA", (phone.width + 16, phone.height + 16), (0, 0, 0, 0))
    ImageDraw.Draw(border).rounded_rectangle(
        (0, 0, *border.size), int(phone_w * 0.11) + 8, fill=(60, 62, 68, 255)
    )
    border.paste(phone, (8, 8), phone)
    y = top + int(s1 * 2.75)
    canvas.paste(border, ((w - border.width) // 2, y), border)
    return canvas


ios = out / "ios-6.9"
play = out / "play"
ios.mkdir(parents=True, exist_ok=True)
play.mkdir(parents=True, exist_ok=True)
for name, raw, l1, l2 in SHOTS:
    shot = Image.open(src / raw).convert("RGB")
    frame((1320, 2868), shot, l1, l2).save(ios / f"{name}.png", optimize=True)
    frame((1080, 1920), shot, l1, l2).save(play / f"{name}.png", optimize=True)

icon = Image.open(icon_path).convert("RGBA").resize((512, 512), Image.LANCZOS)
icon.save(play / "icone-512.png", optimize=True)

feat = Image.new("RGB", (1024, 500), BG)
d = ImageDraw.Draw(feat)
ic = Image.open(icon_path).convert("RGBA").resize((220, 220), Image.LANCZOS)
ic = rounded(ic, 48)
feat.paste(ic, (90, 140), ic)
x = 360
d.text((x, 150), "Organize", font=font(84, BOLD), fill=INK)
d.text((x + d.textlength("Organize", font=font(84, BOLD)), 150), "Up", font=font(84, BOLD), fill=GREEN)
d.text((x, 265), "As finanças da família", font=font(40, REGULAR), fill=MUTED)
d.text((x, 315), "no bolso, sempre em dia.", font=font(40, REGULAR), fill=MUTED)
feat.save(play / "destaque-1024x500.png", optimize=True)
print("ok")
