from pathlib import Path

path = Path("index.html")
text = path.read_text(encoding="utf-8")
old = './js/time-block-v2-settings.js?v=1'
new = './js/time-block-v2-settings.js?v=2'
if old not in text:
    raise SystemExit("time block V2 settings cache anchor not found")
if text.count(old) != 1:
    raise SystemExit("time block V2 settings cache anchor is not unique")
path.write_text(text.replace(old, new), encoding="utf-8")
