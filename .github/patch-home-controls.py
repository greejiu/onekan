from pathlib import Path
import re

index = Path('index.html')
html = index.read_text()
old_controls = '''          <div class="uw-home-view-controls" aria-label="집 보기 설정">
            <div class="uw-seg"><button data-uw-home-mode="list" type="button">목록</button><button class="active" data-uw-home-mode="timeline" type="button">타임라인</button></div>
            <div class="uw-toolbar-group"><button class="uw-icon-btn" data-uw-home-prev type="button" aria-label="이전 기간">‹</button><button class="uw-icon-btn" data-uw-home-today type="button">오늘</button><button class="uw-icon-btn" data-uw-home-next type="button" aria-label="다음 기간">›</button></div>
          </div>'''
new_controls = '''          <div class="uw-home-view-controls" aria-label="집 보기 설정">
            <div class="uw-home-controls-row uw-home-controls-primary">
              <div class="uw-seg"><button data-uw-home-mode="list" type="button">목록</button><button class="active" data-uw-home-mode="timeline" type="button">타임라인</button></div>
              <div class="uw-home-primary-actions"><button class="uw-home-today-btn" data-uw-home-today type="button">오늘</button><button class="uw-session-toggle" data-uw-toggle-sessions type="button" aria-pressed="true">시간 추적 숨기기</button></div>
            </div>
            <div class="uw-home-controls-row uw-home-controls-date">
              <button class="uw-home-nav-arrow" data-uw-home-prev type="button" aria-label="이전 기간">‹</button>
              <strong class="uw-home-date-label" id="uwHomeDateLabel"></strong>
              <button class="uw-home-nav-arrow" data-uw-home-next type="button" aria-label="다음 기간">›</button>
            </div>
          </div>'''
if old_controls not in html:
    raise SystemExit('home controls block not found')
html = html.replace(old_controls, new_controls, 1)
if 'css/unified-workspace.css?v=22' not in html:
    raise SystemExit('css cache version not found')
if 'js/unified-workspace.js?v=26' not in html:
    raise SystemExit('js cache version not found')
html = html.replace('css/unified-workspace.css?v=22', 'css/unified-workspace.css?v=23', 1)
html = html.replace('js/unified-workspace.js?v=26', 'js/unified-workspace.js?v=27', 1)
index.write_text(html)

js_path = Path('js/unified-workspace.js')
js = js_path.read_text()

replacement_list = '''function plannerListDay(d){const k=key(d),items=itemsForDay(k),head=homeDays>1?`<div class="uw-day-head"><strong>${dayLabel(d)}</strong></div>`:"";return`<section class="uw-day uw-list-day${k===todayKey()?" uw-today":""}" data-date="${k}">${head}<div class="uw-list uw-flat-day-list" data-uw-add-kind="task" data-date="${k}" data-task-drop-date="${k}">${items.map(x=>flatListMarkup(x,k)).join("")||'<div class="uw-empty-hit">＋ 할일</div>'}</div></section>`}
function plannerDay'''
js, count = re.subn(r'function plannerListDay\(d\)\{.*?\}\nfunction plannerDay', replacement_list, js, count=1, flags=re.S)
if count != 1:
    raise SystemExit(f'plannerListDay replacement count={count}')

replacement_day = '''function plannerDay(d,index=0){const k=key(d),items=timelineItemsForDay(k),untimed=items.filter(x=>!x.timed),timed=layoutTimedItems(items.filter(x=>x.timed&&x.time>=START&&x.time<END));let labels="",hits="";for(let m=START;m<END;m+=SLOT){if(m%60===0)labels+=`<span class="uw-time-label" style="top:${((m-START)/SLOT)*SLOT_H}px">${pad(m/60)}:00</span>`;hits+=`<div class="uw-time-hit" style="top:${((m-START)/SLOT)*SLOT_H}px" data-uw-add-kind="task" data-date="${k}" data-time="${m}"></div>`}const blocks=timed.map(x=>x.kind==="session"?sessionBlockMarkup(x,k):`<div class="uw-time-entry uw-item ${itemDoneOn(x.kind,x.item,k)?"done":""}" style="top:${((x.time-START)/SLOT)*SLOT_H+1}px;height:${Math.max(18,(x.duration/SLOT)*SLOT_H-2)}px;${timedColumnStyle(x)}${groupStyle(x.item)}" data-uw-kind="${x.kind}" data-id="${x.item.id}" data-date="${k}" data-time="${x.time}" data-duration="${x.duration}"><button class="uw-resize-handle top" data-uw-resize="top" type="button"></button>${checkMarkup(x.kind,x.item,k)}<span class="uw-item-title">${esc(x.item.title)}</span><button class="uw-move-handle" type="button" aria-label="길게 눌러 이동">↕</button><button class="uw-select-circle" type="button"></button><button class="uw-resize-handle bottom" data-uw-resize="bottom" type="button"></button></div>`).join("");const head=homeDays>1?`<div class="uw-day-head"><strong>${dayLabel(d)}</strong></div>`:"";return`<section class="uw-day${k===todayKey()?" uw-today":""}" data-date="${k}">${head}${allDayPanel(k,untimed)}<div class="uw-timeline" style="height:${timelineHeight()}px"><div class="uw-time-labels">${labels}</div><div class="uw-time-lane">${hits}${currentTimeMarkup(k)}${blocks}</div></div></section>`}
function renderPlanner'''
js, count = re.subn(r'function plannerDay\(d,index=0\)\{.*?\}\nfunction renderPlanner', replacement_day, js, count=1, flags=re.S)
if count != 1:
    raise SystemExit(f'plannerDay replacement count={count}')

replacement_render = '''function renderPlanner(){const card=$(".home-timeline-card");if(!card)return;$$("[data-uw-home-mode]").forEach(b=>b.classList.toggle("active",b.dataset.uwHomeMode===homeMode));const daySelect=$("[data-uw-home-days-select]");if(daySelect)daySelect.value=String(homeDays);const dateLabel=$("#uwHomeDateLabel");if(dateLabel)dateLabel.textContent=homeDays===1?dayLabel(homeCursor):`${dayLabel(homeCursor)} – ${dayLabel(addDays(homeCursor,homeDays-1))}`;const sessionButton=$(".uw-home-view-controls [data-uw-toggle-sessions]");if(sessionButton){const visible=state.ui.showSessionsOnTimeline;sessionButton.textContent=`시간 추적 ${visible?"숨기기":"보기"}`;sessionButton.setAttribute("aria-pressed",String(visible))}const dayRenderer=homeMode==="timeline"?plannerDay:plannerListDay;card.innerHTML=`<div class="uw-home-planner"><div class="uw-planner-days ${homeMode==="list"?"uw-planner-list-days":""}" style="--uw-days:${homeDays}">${Array.from({length:homeDays},(_,i)=>dayRenderer(addDays(homeCursor,i),i)).join("")}</div></div>`}
function upcomingKeys'''
js, count = re.subn(r'function renderPlanner\(\)\{.*?\}\nfunction upcomingKeys', replacement_render, js, count=1, flags=re.S)
if count != 1:
    raise SystemExit(f'renderPlanner replacement count={count}')
js_path.write_text(js)

css_path = Path('css/unified-workspace.css')
css = css_path.read_text()
marker = '/* Home planner two-row navigation */'
if marker in css:
    raise SystemExit('home planner css marker already exists')
css += '''\n\n/* Home planner two-row navigation */
.uw-home-view-controls{display:grid;align-items:stretch;gap:9px;padding:10px}
.uw-home-controls-row{display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0}
.uw-home-primary-actions{display:flex;align-items:center;justify-content:flex-end;gap:6px;min-width:0}
.uw-home-today-btn,.uw-home-view-controls .uw-session-toggle{min-height:32px;padding:5px 10px;border:1px solid var(--line);border-radius:9px;background:#fff;color:var(--text);font:inherit;font-size:10px;cursor:pointer;white-space:nowrap}
.uw-home-view-controls .uw-session-toggle{color:var(--accent-dark)}
.uw-home-controls-date{display:grid;grid-template-columns:44px minmax(0,1fr) 44px;align-items:center;border-top:1px solid color-mix(in srgb,var(--line) 70%,transparent);padding-top:7px}
.uw-home-date-label{text-align:center;font-size:13px;font-weight:750;color:var(--text)}
.uw-home-nav-arrow{display:grid;place-items:center;width:44px;height:34px;padding:0;border:0;background:transparent;color:var(--text);font:inherit;font-size:28px;line-height:1;cursor:pointer}
.uw-home-nav-arrow:last-child{justify-self:end}
.uw-home-planner>.uw-planner-days{border-top:0}
@media(max-width:600px){.uw-home-view-controls{top:54px;display:grid;gap:8px}.uw-home-primary-actions{gap:4px}.uw-home-today-btn,.uw-home-view-controls .uw-session-toggle{padding-inline:8px}.uw-home-controls-date{grid-template-columns:40px minmax(0,1fr) 40px}.uw-home-nav-arrow{width:40px}.uw-home-view-controls .uw-toolbar-group{width:auto;margin-left:0}}
'''
css_path.write_text(css)
