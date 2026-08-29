from pathlib import Path

path = Path("index.html")
text = path.read_text()
old = '''        <button class="nav-item active" data-page="home" type="button"><span class="nav-icon">⌂</span><span class="nav-label">집</span></button>
        <button class="nav-item" data-page="calendar" type="button"><span class="nav-icon">□</span><span class="nav-label">일정</span></button>
        <button class="nav-item" data-page="tasks" type="button"><span class="nav-icon">✓</span><span class="nav-label">할일</span></button>
        <button class="nav-item" data-page="projects" type="button"><span class="nav-icon">▦</span><span class="nav-label">프로젝트</span></button>
        <button class="nav-item" data-page="plan" type="button"><span class="nav-icon">☷</span><span class="nav-label">계획 세우기</span></button>
        <button class="nav-item" data-page="repeat" type="button"><span class="nav-icon">↻</span><span class="nav-label">반복</span></button>
        <button class="nav-item" data-page="tracking" type="button"><span class="nav-icon">◷</span><span class="nav-label">시간추적</span></button>'''
new = '''        <button class="nav-item active" data-page="home" type="button"><span class="nav-icon">⌂</span><span class="nav-label">집</span></button>
        <button class="nav-item" data-page="calendar" type="button"><span class="nav-icon">□</span><span class="nav-label">일정</span></button>
        <button class="nav-item" data-page="tasks" type="button"><span class="nav-icon">✓</span><span class="nav-label">할일</span></button>
        <button class="nav-item" data-page="repeat" type="button"><span class="nav-icon">↻</span><span class="nav-label">반복 관리</span></button>
        <button class="nav-item" data-page="plan" type="button"><span class="nav-icon">☷</span><span class="nav-label">계획세우기</span></button>
        <button class="nav-item" data-page="projects" type="button"><span class="nav-icon">▦</span><span class="nav-label">프로젝트</span></button>
        <button class="nav-item" data-page="tracking" type="button"><span class="nav-icon">◷</span><span class="nav-label">시간추적</span></button>'''
if old not in text:
    raise SystemExit("sidebar block not found")
path.write_text(text.replace(old, new, 1))
