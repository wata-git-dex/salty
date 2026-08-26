from pathlib import Path
import shutil

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.colors import HexColor
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
TMP = ROOT / "tmp" / "pdfs"
RUNTIME_PY = Path("/Users/sodium/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12")
APP_VERSION = "1.92"
PHOTO = ROOT / "tmp" / "pdfs" / "get-clips-photo.jpg"

W, H = 540, 675
NAVY = HexColor("#07151E")
CARD = HexColor("#122937")
LINE = HexColor("#24475B")
FOAM = HexColor("#F4F0E8")
MUTED = HexColor("#8FA8B7")
AMBER = HexColor("#FFA632")
BLUE = HexColor("#59B9EF")
MINT = HexColor("#52DDA2")
INK = HexColor("#07151E")


def font(size, bold=False):
    name = "Arial Bold.ttf" if bold else "Arial.ttf"
    return ImageFont.truetype(f"/System/Library/Fonts/Supplemental/{name}", size)


def update_existing_one_pager(source_name, output_name, label):
    source = Image.open(DOCS / source_name).convert("RGB")
    draw = ImageDraw.Draw(source)
    width, height = source.size
    scale = width / 540
    draw.rectangle((0, height - round(58 * scale), width, height), fill="#07151E")
    text = f"SALTYVIEW PRODUCTIONS  /  {label}  /  APP V{APP_VERSION}"
    draw.text((width - round(30 * scale), height - round(34 * scale)), text,
              fill="#8FA8B7", font=font(round(7.2 * scale)), anchor="ra")
    png = DOCS / output_name
    source.save(png, optimize=True)
    pdf = png.with_suffix(".pdf")
    source.save(pdf, "PDF", resolution=150.0, title=label, author="Saltyview Productions")
    return png, pdf


def cover_crop(path, size, focus_y=0.5):
    image = Image.open(path).convert("RGB")
    tw, th = size
    target_ratio = tw / th
    src_ratio = image.width / image.height
    if src_ratio > target_ratio:
        nw = int(image.height * target_ratio)
        left = (image.width - nw) // 2
        image = image.crop((left, 0, left + nw, image.height))
    else:
        nh = int(image.width / target_ratio)
        top = max(0, min(image.height - nh, int((image.height - nh) * focus_y)))
        image = image.crop((0, top, image.width, top + nh))
    return image.resize(size, Image.Resampling.LANCZOS)


def rounded_image(c, path, x, y, width, height, radius=12):
    c.saveState()
    shape = c.beginPath()
    shape.roundRect(x, y, width, height, radius)
    c.clipPath(shape, stroke=0, fill=0)
    c.drawImage(ImageReader(str(path)), x, y, width, height, mask="auto")
    c.restoreState()
    c.setStrokeColor(LINE)
    c.roundRect(x, y, width, height, radius, stroke=1, fill=0)


def step(c, number, title, body, y, accent):
    c.setFillColor(CARD)
    c.setStrokeColor(LINE)
    c.roundRect(30, y, 480, 49, 11, stroke=1, fill=1)
    c.setFillColor(accent)
    c.circle(52, y + 24.5, 11, stroke=0, fill=1)
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 8.5)
    c.drawCentredString(52, y + 21.5, str(number))
    c.setFillColor(FOAM)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(72, y + 28, title)
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 7.5)
    c.drawString(72, y + 13, body)


def build_get_clips():
    pdf = DOCS / "SODIUM_Get_Your_Clips_One_Pager_V2.pdf"
    hero = Path("/private/tmp/sodium-get-clips-v2-photo.jpg")
    cover_crop(PHOTO, (640, 810), 0.50).save(hero, quality=94)
    c = canvas.Canvas(str(pdf), pagesize=(W, H))
    c.setTitle("SODIUM - Get Your Clips")
    c.setAuthor("Saltyview Productions")
    c.setSubject(f"Member and guest clip delivery guide for Sodium v{APP_VERSION}")
    c.setFillColor(NAVY); c.rect(0, 0, W, H, stroke=0, fill=1)
    c.drawImage(ImageReader(str(ROOT / "icon-512.png")), 30, 624, width=28, height=28, mask="auto")
    c.setFillColor(FOAM); c.setFont("Helvetica-Bold", 20); c.drawString(66, 630, "sodium")
    c.setFillColor(MUTED); c.setFont("Helvetica-Bold", 7.5); c.drawRightString(510, 637, "ONE JOB / ONE PAGE")
    c.setFillColor(AMBER); c.setFont("Helvetica-Bold", 8); c.drawString(30, 598, "NO INSTAGRAM. NO LOST LINKS.")
    c.setFillColor(FOAM); c.setFont("Helvetica-Bold", 23); c.drawString(30, 567, "Open your clips.")
    c.setFillColor(MUTED); c.setFont("Helvetica", 8.5); c.drawString(30, 546, "Members and guests use the same clean handoff. Joining is optional.")

    c.setFillColor(CARD); c.setStrokeColor(LINE); c.roundRect(30, 322, 309, 201, 14, stroke=1, fill=1)
    c.setFillColor(AMBER); c.setFont("Helvetica-Bold", 7.5); c.drawString(50, 494, "SODIUM CLIPS")
    c.setFillColor(MUTED); c.setFont("Helvetica", 8); c.drawString(50, 469, "CYRUS SENT YOU")
    c.setFillColor(FOAM); c.setFont("Helvetica-Bold", 18); c.drawString(50, 444, "Your clips")
    c.setFillColor(MUTED); c.setFont("Helvetica", 8); c.drawString(50, 426, "C Street · Ventura")
    c.setFillColor(FOAM); c.setFont("Helvetica-Bold", 12); c.drawString(50, 400, "22 of 22")
    c.setFillColor(MINT); c.setFont("Helvetica-Bold", 7); c.drawRightString(319, 402, "CLIPS READY")
    c.setFillColor(LINE); c.roundRect(50, 384, 269, 7, 3.5, stroke=0, fill=1)
    c.setFillColor(MINT); c.roundRect(50, 384, 269, 7, 3.5, stroke=0, fill=1)
    c.setFillColor(AMBER); c.roundRect(50, 342, 269, 31, 9, stroke=0, fill=1)
    c.setFillColor(INK); c.setFont("Helvetica-Bold", 10); c.drawCentredString(184.5, 353, "OPEN YOUR CLIPS")
    rounded_image(c, hero, 351, 322, 159, 201, 14)

    step(c, 1, "TAP THE PRIVATE LINK", "It opens this one Sodium delivery—not the community or anyone else's clips.", 253, AMBER)
    step(c, 2, "OPEN THE FOLDER", "Tap Open your clips. Drive, Dropbox, iCloud, or the shared folder opens next.", 192, BLUE)
    step(c, 3, "NO ACCOUNT NEEDED", "Guests can get the files immediately. There is no signup wall and no delivery chat.", 131, MINT)
    step(c, 4, "JOIN ONLY IF YOU WANT", "Members save the delivery in Sodium. Guests can ignore the optional Join button.", 70, AMBER)
    c.setFillColor(MUTED); c.setFont("Helvetica", 7); c.drawString(30, 47, "Clip totals may include waves, B-roll, wipeouts, and other footage—not only makes.")
    c.setFillColor(MUTED); c.setFont("Helvetica", 7); c.drawRightString(510, 31, f"SALTYVIEW PRODUCTIONS  /  GET YOUR CLIPS V2  /  APP V{APP_VERSION}")
    c.showPage(); c.save()
    png = pdf.with_suffix(".png")
    render_pdf_page(pdf, png)
    return png, pdf


def render_pdf_page(pdf, png, scale=2.0):
    import pypdfium2 as pdfium
    document = pdfium.PdfDocument(str(pdf))
    image = document[0].render(scale=scale).to_pil().convert("RGB")
    image.save(png, optimize=True)


def execute_transformed(source_path, replacements):
    source = source_path.read_text()
    for old, new in replacements:
        if old not in source:
            raise AssertionError(f"Missing expected guide source text: {old[:80]}")
        source = source.replace(old, new)
    exec(compile(source, str(source_path), "exec"), {"__name__": "__main__", "__file__": str(source_path)})


def build_quick_start():
    source = TMP / "build_salty_quick_start_v6.py"
    execute_transformed(source, [
        ("ROOT / 'output/pdf/SODIUM_Quick_Start_Guide_V13.pdf'", "ROOT / 'docs/SODIUM_Quick_Start_Guide_V14.pdf'"),
        ("ROOT / 'tmp/pdfs/SODIUM_Quick_Start_Guide_V13_raw.pdf'", "Path('/private/tmp/SODIUM_Quick_Start_Guide_V14_raw.pdf')"),
        ("V13", "V14"),
        ("APP V1.62", "APP V1.92"),
        ("v1.62", "v1.92"),
        ("Path('/tmp/codex-remote-attachments/01a01b39-bf81-75f3-a40c-3a3051a9ed1b/DB555BDB-C008-49D9-829F-032DE06A2F5B/1-Photo-1.jpg')", "ROOT / 'tmp/pdfs/salty-guide-v8-hero.jpg'"),
        ("Share photos or clips up to 90 seconds / 50 MB. Credit the filmer; add the board brand, model, and dimensions. You can edit or delete your post.", "Share up to 10 photos or up to 5 clips. Each clip can be up to 5 minutes / 1 GB. Credit the photographer or filmer."),
        ("Members receive it in Sodium; guests can open a private delivery-only link and reply without an account.", "Members receive it in Sodium; guests open a private delivery-only link with no account. Joining is optional."),
        ("'POINTS + STREAKS'", "'STOKENS + STREAKS'"),
        ("'points.png', 20, 'Points'", "'points.png', 20, 'Stokens'"),
        ("organizer points", "organizer Stokens"),
    ])
    pdf = DOCS / "SODIUM_Quick_Start_Guide_V14.pdf"
    guide_dir = DOCS / "guide-v14"
    guide_dir.mkdir(exist_ok=True)
    import pypdfium2 as pdfium
    document = pdfium.PdfDocument(str(pdf))
    for index in range(len(document)):
        image = document[index].render(scale=2.3).to_pil().convert("RGB")
        image.save(guide_dir / f"page-{index + 1:02d}.jpg", quality=91, optimize=True)
    (guide_dir / "README.md").write_text(
        f"# Sodium Quick Start Guide V14\n\nFour in-app guide pages for Sodium v{APP_VERSION}. They use Cyrus's supplied surf photography and current member/guest clip-delivery behavior.\n"
    )
    return pdf


def build_master_manual():
    source = TMP / "build_sodium_master_manual.py"
    execute_transformed(source, [
        ('output/pdf/SODIUM_Master_Instruction_Manual_V1.pdf', 'docs/SODIUM_Master_Instruction_Manual_V2.pdf'),
        ('docs/SODIUM_Master_Instruction_Manual_V1.pdf', 'docs/SODIUM_Master_Instruction_Manual_V2.pdf'),
        ('V1.72', 'V1.92'),
        ('link, progress, session connection, and conversation.', 'link, progress, and session connection.'),
        ('resend it, or use its Sodium message thread.', 'resend it, or open the folder again.'),
        ('Sodium separates the regional community conversation, private text messages, and clip-delivery conversations.', 'Sodium separates the regional community conversation and private text messages. Clip deliveries are clean folder handoffs, not chats.'),
        ('story.append(card("Delivery messages", "Every clip delivery has its own Messages row. Use it for a missing wave, wrong folder, added clip, or any question specific to that handoff.", color=GREEN))', 'story.append(card("Clip deliveries", "Clip links open the saved folder. If you need to talk, use a normal DM or text—the delivery itself has no message thread.", color=GREEN))'),
        ('Photos: upload a carousel of up to 10 images.', 'Photos: upload a carousel of up to 10 images in original, square, portrait, or landscape shape.'),
        ('Video: upload one clip up to 90 seconds and 50 MB on the current free-storage setup.', 'Video: upload up to 5 clips. Each clip can be up to 5 minutes and 1 GB through Cloudflare Stream.'),
        ('Filmer credit is required. Surfer, board brand/dimensions, spot, location, and caption are optional.', 'Choose Photo or Clips first. Credit the photographer or filmer; tags, location, and caption are optional.'),
        ('points, active streak, Stoke shared, sessions surfed, sessions filmed, sessions organized, and locations surfed.', 'Stokens, active streak, Stoke posts, surf/film time, sessions organized, combined locations, clip handoffs, and clips delivered/received.'),
        ('08 · Points, streaks, and credit', '08 · Stokens, streaks, and credit'),
        ('Points encourage surfing, filming, sharing, and showing up.', 'Stokens reward surfing, filming, sharing, and showing up.'),
        ('Current points', 'Current Stokens'),
        ('15 points: share Stoke.', '15 Stokens: share Stoke.'),
    ])
    return DOCS / "SODIUM_Master_Instruction_Manual_V2.pdf"


def main():
    DOCS.mkdir(exist_ok=True)
    overview = update_existing_one_pager("SODIUM_App_Overview_One_Pager_V9.png", "SODIUM_App_Overview_One_Pager_V10.png", "OVERVIEW V10")
    setup = update_existing_one_pager("SODIUM_Setup_One_Pager_V2.png", "SODIUM_Setup_One_Pager_V3.png", "SETUP V3")
    plan = update_existing_one_pager("SODIUM_Plan_A_Surf_One_Pager_V1.png", "SODIUM_Plan_A_Surf_One_Pager_V2.png", "PLAN A SURF V2")
    clips = build_get_clips()
    quick = build_quick_start()
    master = build_master_manual()
    outputs = [overview[1], setup[1], plan[1], clips[1], quick, master]
    for path in outputs:
        if not path.exists() or path.stat().st_size < 10_000:
            raise AssertionError(f"Guide output missing or too small: {path}")
    print("\n".join(str(path) for path in outputs))


if __name__ == "__main__":
    main()
