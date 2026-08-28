from pathlib import Path

path = Path("index.html")
text = path.read_text(encoding="utf-8")
old = '  <script type="module" src="./js/appearance.js?v=4"></script>\n  <script type="module" src="./js/unified-workspace.js?v=36"></script>'
new = '  <script type="module" src="./js/appearance.js?v=4"></script>\n  <script type="module" src="./js/time-block-v2-settings.js?v=1"></script>\n  <script type="module" src="./js/unified-workspace.js?v=36"></script>'
if old not in text:
    raise SystemExit("expected script anchor not found")
if text.count(old) != 1:
    raise SystemExit("script anchor is not unique")
path.write_text(text.replace(old, new), encoding="utf-8")
