from pathlib import Path
p=Path('index.html')
s=p.read_text()
old='일정·할일·습관·프로젝트에서 공통으로 사용하는 영역입니다. 위아래 버튼으로 순서를 바꿀 수 있어요.'
new='일정·할일·습관·프로젝트에서 공통으로 사용하는 영역입니다. 왼쪽 손잡이를 끌어서 순서를 바꿀 수 있어요.'
if old not in s:
    raise SystemExit('area description not found')
p.write_text(s.replace(old,new,1))
