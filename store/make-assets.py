"""Builds the Chrome Web Store images with headless Edge or Chrome.

    py store/make-assets.py

Output in store/assets/: tile-<lang>.png (440x280) and
screenshot-<n>-<lang>.png (1280x800). The cards in store/cards/ are real
captures of the extension; this script only sets them on a plain page.
"""
import pathlib
import subprocess
import sys
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parent
EXT = ROOT.parent
OUT = ROOT / "assets"
BROWSERS = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
]

TEXTS = {
    "en": {
        "tag": "Tips at the right moment for ChatGPT, Claude, Gemini and Mistral.",
        "shots": [
            ("data", "Spot sensitive data before you send it",
             "An IBAN, a card number, a secret key: a button swaps it for an example."),
            ("references", "Check every reference",
             "AI models sometimes make up sources. A reminder when you ask for them."),
            ("long", "Start over without losing anything",
             "When a conversation gets long, one click prepares a summary."),
            ("mode", "Pick the quick mode",
             "A one-line question does not need deep reasoning. Same answer, faster."),
        ],
        "foot": "Free, open source. Nothing leaves your browser.",
    },
    "fr": {
        "tag": "Des conseils au bon moment pour ChatGPT, Claude, Gemini et Mistral.",
        "shots": [
            ("data", "Repérez les données sensibles avant l’envoi",
             "Un IBAN, un numéro de carte, une clé secrète : un bouton les remplace par un exemple."),
            ("references", "Vérifiez chaque référence",
             "Les modèles d’IA inventent parfois des sources. Un rappel quand vous en demandez."),
            ("long", "Repartez sans rien perdre",
             "Quand une conversation s’allonge, un clic prépare un résumé."),
            ("mode", "Choisissez le mode rapide",
             "Une question d’une ligne n’a pas besoin de réflexion approfondie. Même réponse, plus vite."),
        ],
        "foot": "Gratuit, open source. Rien ne quitte votre navigateur.",
    },
}

FONT = (EXT / "fonts" / "onest-latin-ext-wght-normal.woff2").as_uri()
FONT_LATIN = (EXT / "fonts" / "onest-latin-wght-normal.woff2").as_uri()
CSS = f"""
@font-face {{ font-family: Onest; src: url({FONT_LATIN}); font-weight: 100 900; }}
@font-face {{ font-family: Onest; src: url({FONT}); font-weight: 100 900; unicode-range: U+0100-02AF; }}
* {{ box-sizing: border-box; margin: 0; }}
body {{ font-family: Onest, sans-serif; color: #131312; background: #f7f7f5; overflow: hidden; }}
"""


def shot_html(lang, card, title, sub, foot):
    img = (ROOT / "cards" / f"carte-{card}-{lang}.png").as_uri()
    return f"""<!doctype html><meta charset=utf-8><style>{CSS}
body {{ width: 1280px; height: 800px; display: flex; align-items: center; padding: 0 96px; gap: 72px; }}
.txt {{ flex: 1; }}
.logo {{ display: flex; align-items: center; gap: 14px; font-weight: 600; font-size: 22px; margin-bottom: 44px; }}
.logo img {{ width: 48px; height: 48px; }}
h1 {{ font-size: 54px; line-height: 1.08; font-weight: 650; letter-spacing: -0.02em; }}
p {{ margin-top: 24px; font-size: 24px; line-height: 1.4; color: #5a5955; }}
.foot {{ margin-top: 48px; font-size: 18px; color: #b54d00; font-weight: 550; }}
.card {{ width: 480px; flex: none; border-radius: 22px; overflow: hidden; box-shadow: 0 18px 40px rgba(19,19,18,.16); }}
.card img {{ width: 522px; display: block; margin: -21px; }}
</style>
<div class=txt>
<div class=logo><img src="{(EXT / 'icons' / 'icon-128.png').as_uri()}">Optidome Companion</div>
<h1>{title}</h1><p>{sub}</p><div class=foot>{foot}</div></div>
<div class=card><img src="{img}"></div>"""


def tile_html(lang, tag):
    return f"""<!doctype html><meta charset=utf-8><style>{CSS}
body {{ width: 440px; height: 280px; padding: 32px 36px; display: flex; flex-direction: column; justify-content: center; }}
img {{ width: 64px; height: 64px; }}
h1 {{ margin-top: 18px; font-size: 34px; line-height: 1.05; font-weight: 650; letter-spacing: -0.02em; }}
p {{ margin-top: 12px; font-size: 16px; line-height: 1.35; color: #5a5955; }}
</style>
<img src="{(EXT / 'icons' / 'icon-128.png').as_uri()}">
<h1>Optidome Companion</h1><p>{tag}</p>"""


def render(browser, html, size, dest):
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        page = pathlib.Path(tmp) / "p.html"
        page.write_text(html, encoding="utf-8")
        subprocess.run(
            [browser, "--headless", "--disable-gpu", "--hide-scrollbars",
             f"--user-data-dir={tmp}/profile",
             "--allow-file-access-from-files", f"--window-size={size[0]},{size[1]}",
             "--virtual-time-budget=2000", f"--screenshot={dest}", page.as_uri()],
            check=True, capture_output=True)
        for _ in range(50):
            if pathlib.Path(dest).exists():
                break
            time.sleep(0.2)


def main():
    browser = next((b for b in BROWSERS if pathlib.Path(b).exists()), None)
    if not browser:
        sys.exit("No Edge or Chrome found")
    OUT.mkdir(exist_ok=True)
    for lang, t in TEXTS.items():
        render(browser, tile_html(lang, t["tag"]), (440, 280), OUT / f"tile-{lang}.png")
        for n, (card, title, sub) in enumerate(t["shots"], 1):
            render(browser, shot_html(lang, card, title, sub, t["foot"]), (1280, 800),
                   OUT / f"screenshot-{n}-{lang}.png")
    print("ok", len(list(OUT.glob("*.png"))), "images")


main()
