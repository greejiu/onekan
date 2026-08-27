from pathlib import Path
import re

css_path = Path('css/unified-workspace.css')
context_path = Path('js/context-menu.js')
index_path = Path('index.html')

css = css_path.read_text(encoding='utf-8')
old = '.uw-context{position:fixed;z-index:10050;display:none;min-width:150px;padding:5px;'
new = '.uw-context{position:fixed;z-index:10050;display:none;min-width:150px;max-height:min(420px,calc(100vh - 28px));overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y;padding:5px;'
if old not in css:
    raise SystemExit('uw-context anchor not found')
css = css.replace(old, new, 1)
css_path.write_text(css, encoding='utf-8')

context = context_path.read_text(encoding='utf-8')
old_list = '.context-group-list{margin:3px 0;padding:3px;border-top:1px solid var(--line,#d2d7df);border-bottom:1px solid var(--line,#d2d7df);max-height:210px;overflow:auto}'
new_list = '.context-group-list{margin:3px 0;padding:3px;border-top:1px solid var(--line,#d2d7df);border-bottom:1px solid var(--line,#d2d7df);max-height:min(260px,55vh);overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y;scrollbar-gutter:stable}'
if old_list not in context:
    raise SystemExit('context group list anchor not found')
context = context.replace(old_list, new_list, 1)
old_scroll = 'document.addEventListener("scroll", hideMenu, true);'
new_scroll = '''document.addEventListener("scroll", (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest("#globalContextMenu")) return;
    hideMenu();
  }, true);'''
if old_scroll not in context:
    raise SystemExit('scroll handler anchor not found')
context = context.replace(old_scroll, new_scroll, 1)
context_path.write_text(context, encoding='utf-8')

index = index_path.read_text(encoding='utf-8')

def bump(match):
    return f'{match.group(1)}{int(match.group(2)) + 1}{match.group(3)}'

index, css_count = re.subn(r'(css/unified-workspace\.css\?v=)(\d+)(["\'])', bump, index, count=1)
index, ctx_count = re.subn(r'(js/context-menu\.js\?v=)(\d+)(["\'])', bump, index, count=1)
if css_count != 1 or ctx_count != 1:
    raise SystemExit(f'cache bump failed css={css_count} context={ctx_count}')
index_path.write_text(index, encoding='utf-8')
