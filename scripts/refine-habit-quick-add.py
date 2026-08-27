from pathlib import Path

ROOT = Path('.')

def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 occurrence, got {count}')
    return text.replace(old, new, 1)

# index.html
path = ROOT / 'index.html'
text = path.read_text()
old_form = '''        <form class="habit-page-add uw-habit-add-form" id="habitPageForm">
          <input id="habitPageTitle" placeholder="새 습관" aria-label="새 습관" required />
          <label class="uw-habit-icon-field" title="시간"><span aria-hidden="true">◷</span><input id="habitPageTime" type="time" step="1800" aria-label="습관 시간" /></label>
          <label class="uw-habit-icon-field" title="그룹"><span aria-hidden="true">◉</span><select id="habitPageGroup" aria-label="습관 그룹"></select></label>
          <label class="uw-habit-range-field"><span>시작</span><input id="habitPageStartDate" type="date" aria-label="습관 시작일" /></label>
          <label class="uw-habit-range-field"><span>종료</span><input id="habitPageEndDate" type="date" aria-label="습관 종료일" /></label>
          <label class="uw-habit-duration-field"><span>길이</span><select id="habitPageDuration" aria-label="습관 길이"><option value="30">30분</option><option value="60">1시간</option><option value="90">1시간 30분</option><option value="120">2시간</option></select></label>
          <button class="primary-btn" type="submit">추가</button>
        </form>'''
new_form = '''        <form class="habit-page-add uw-habit-add-form" id="habitPageForm">
          <input id="habitPageTitle" placeholder="새 습관" aria-label="새 습관" required />
          <label class="uw-habit-icon-field" title="그룹"><span aria-hidden="true">◉</span><select id="habitPageGroup" aria-label="습관 그룹"></select></label>
          <div class="uw-habit-period-control" id="habitPagePeriodControl">
            <button class="uw-habit-period-button" id="habitPagePeriodButton" type="button" aria-expanded="false" title="습관 기간 설정"><span aria-hidden="true">▦</span><span id="habitPagePeriodLabel">오늘부터</span></button>
            <div class="uw-habit-period-pop" id="habitPagePeriodPanel" hidden>
              <strong>기간</strong>
              <label><span>시작일</span><input id="habitPageStartDate" type="date" aria-label="습관 시작일" /></label>
              <label><span>종료일</span><input id="habitPageEndDate" type="date" aria-label="습관 종료일" /></label>
              <small>종료일을 비우면 계속 반복돼요.</small>
            </div>
          </div>
          <div class="uw-habit-repeat-control" id="habitPageRepeatControl"></div>
          <button class="primary-btn" type="submit">추가</button>
        </form>'''
text = replace_once(text, old_form, new_form, 'habit quick add markup')
text = replace_once(text, 'css/unified-workspace.css?v=30', 'css/unified-workspace.css?v=31', 'css cache')
text = replace_once(text, 'js/unified-workspace.js?v=31', 'js/unified-workspace.js?v=32', 'js cache')
path.write_text(text)

# js/unified-workspace.js
path = ROOT / 'js/unified-workspace.js'
text = path.read_text()
start = text.index('function wireHabitForm(){')
end = text.index('\nfunction wireOverdueActions()', start)
old_wire = text[start:end]
new_wire = '''function wireHabitForm(){
  const form=$("#habitPageForm");if(!form||form.dataset.uwBound)return;form.dataset.uwBound="1";
  const startInput=$("#habitPageStartDate"),endInput=$("#habitPageEndDate"),periodButton=$("#habitPagePeriodButton"),periodPanel=$("#habitPagePeriodPanel"),periodLabel=$("#habitPagePeriodLabel");
  if(startInput&&!startInput.value)startInput.value=todayKey();
  const shortDate=value=>{if(!value)return"";const d=fromKey(value);return`${d.getMonth()+1}/${d.getDate()}`};
  const refreshPeriodLabel=()=>{if(!periodLabel)return;const startDate=startInput?.value||todayKey(),endDate=endInput?.value||"";periodLabel.textContent=endDate?`${shortDate(startDate)}–${shortDate(endDate)}`:startDate===todayKey()?"오늘부터":`${shortDate(startDate)}부터`};
  const closePeriod=()=>{if(periodPanel)periodPanel.hidden=true;periodButton?.setAttribute("aria-expanded","false")};
  const closeRepeat=()=>{const panel=$("#habitPageRepeatPanel"),button=$("#habitPageRepeatButton");if(panel)panel.hidden=true;button?.setAttribute("aria-expanded","false")};
  endInput?.addEventListener("input",()=>{endInput.setCustomValidity("");refreshPeriodLabel()});
  startInput?.addEventListener("input",()=>{endInput?.setCustomValidity("");refreshPeriodLabel()});
  periodButton?.addEventListener("click",()=>{const open=periodPanel?.hidden!==false;closeRepeat();if(periodPanel)periodPanel.hidden=!open;periodButton.setAttribute("aria-expanded",String(open))});
  refreshPeriodLabel();

  const control=$("#habitPageRepeatControl");
  const installRepeat=()=>{
    if(!control)return;
    control.innerHTML=`<button class="uw-habit-repeat-button active" id="habitPageRepeatButton" type="button" aria-expanded="false" title="반복 설정">↻ <span>매일</span></button><div class="uw-habit-repeat-pop" id="habitPageRepeatPanel" hidden>${recurrenceEditorMarkup({recurrence:{frequency:"daily",interval:1}},"daily",false,false)}<div class="uw-habit-time-plan"><button class="uw-habit-time-add" id="habitPageTimeAdd" type="button">＋ 시간 추가</button><div class="uw-habit-time-fields" id="habitPageTimeFields" hidden><label><span>시간</span><input id="habitPageTime" type="time" step="1800" aria-label="습관 시간"></label><label><span>길이</span><select id="habitPageDuration" aria-label="습관 길이"><option value="30">30분</option><option value="60">1시간</option><option value="90">1시간 30분</option><option value="120">2시간</option></select></label><button class="uw-habit-time-remove" id="habitPageTimeRemove" type="button">시간 제거</button></div></div></div>`;
    const panel=$("#habitPageRepeatPanel"),button=$("#habitPageRepeatButton"),timeAdd=$("#habitPageTimeAdd"),timeFields=$("#habitPageTimeFields"),timeInput=$("#habitPageTime"),durationInput=$("#habitPageDuration"),timeRemove=$("#habitPageTimeRemove");
    wireRecurrenceEditor(panel,startInput?.value||todayKey());
    const refreshLabel=()=>{const recurrence=recurrenceFromEditor(panel,startInput?.value||todayKey(),{includeUntil:false});const label=recurrenceLabel({recurrence})||"매일";$("span",button).textContent=label;button.classList.toggle("active",!!recurrence)};
    const showTimeFields=show=>{if(timeFields)timeFields.hidden=!show;if(timeAdd)timeAdd.hidden=show;if(show)requestAnimationFrame(()=>{try{timeInput?.showPicker()}catch{timeInput?.focus()}})};
    button.addEventListener("click",()=>{const open=panel.hidden;closePeriod();panel.hidden=!open;button.setAttribute("aria-expanded",String(open))});
    timeAdd?.addEventListener("click",()=>showTimeFields(true));
    timeRemove?.addEventListener("click",()=>{if(timeInput)timeInput.value="";if(durationInput)durationInput.value="30";showTimeFields(false)});
    panel.addEventListener("change",refreshLabel);panel.addEventListener("uw-repeat-refresh",refreshLabel);refreshLabel()
  };
  installRepeat();
  document.addEventListener("pointerdown",event=>{if(!form.contains(event.target)){closePeriod();closeRepeat()}},true);
  form.addEventListener("submit",async event=>{
    event.preventDefault();
    const title=$("#habitPageTitle")?.value.trim(),time=$("#habitPageTime")?.value||"",duration=Math.max(SLOT,+$("#habitPageDuration")?.value||SLOT),groupId=$("#habitPageGroup")?.value||state?.eventGroups?.[0]?.id||"default",startDate=startInput?.value||todayKey(),endDate=endInput?.value||"",panel=$("#habitPageRepeatPanel"),button=form.querySelector('button[type="submit"]');
    if(!title)return;
    if(endDate&&endDate<startDate){endInput?.setCustomValidity("종료일은 시작일과 같거나 이후여야 해요.");endInput?.reportValidity();return}
    const original=button.dataset.defaultLabel||button.textContent;button.dataset.defaultLabel=original;button.disabled=true;button.textContent="추가 중…";
    try{
      await write(current=>{const habit={id:uid(),title,groupId,startDate};if(endDate)habit.endDate=endDate;const recurrence=recurrenceFromEditor(panel,startDate,{includeUntil:false})||{frequency:"daily",interval:1};recurrence.anchorDate=startDate;habit.recurrence=recurrence;if(time){const[hour,minute]=time.split(":").map(Number);habit.startMinute=hour*60+minute;habit.duration=duration}current.habitTemplates.push(habit)});
      form.reset();$("#habitPageGroup").value=groupId;if(startInput)startInput.value=todayKey();if(endInput)endInput.value="";refreshPeriodLabel();closePeriod();installRepeat()
    }catch(error){console.error("습관 추가 실패",error);button.textContent="다시 시도"}
    finally{button.disabled=false;if(button.textContent!=="다시 시도")button.textContent=original}
  })
}'''
text = text[:start] + new_wire + text[end:]
path.write_text(text)

# css/unified-workspace.css
path = ROOT / 'css/unified-workspace.css'
text = path.read_text()
text += '''\n\n/* Habit compact quick add */\n#habitPageForm.uw-habit-add-form{position:relative;display:grid!important;grid-template-columns:minmax(220px,1fr) auto auto auto auto;align-items:center;gap:8px;overflow:visible}#habitPageForm>#habitPageTitle{min-width:0;width:100%}#habitPageForm>.uw-habit-icon-field{min-width:112px}.uw-habit-period-control,.uw-habit-repeat-control{position:relative;display:inline-flex;align-items:center;min-width:0}.uw-habit-period-button,.uw-habit-repeat-button{display:inline-flex;align-items:center;justify-content:center;gap:5px;height:36px;padding:5px 10px;border:1px solid var(--line);border-radius:9px;background:#fff;color:var(--muted);font:inherit;font-size:10px;white-space:nowrap;cursor:pointer}.uw-habit-period-button[aria-expanded="true"],.uw-habit-repeat-button[aria-expanded="true"],.uw-habit-repeat-button.active{border-color:color-mix(in srgb,var(--accent) 55%,var(--line));background:var(--accent-soft);color:var(--accent-dark)}.uw-habit-period-pop{position:absolute;z-index:95;top:calc(100% + 6px);left:0;width:min(290px,calc(100vw - 30px));display:grid;gap:9px;padding:11px;border:1px solid var(--line);border-radius:12px;background:#fff;box-shadow:0 12px 34px #0002}.uw-habit-period-pop[hidden]{display:none!important}.uw-habit-period-pop>strong{font-size:11px}.uw-habit-period-pop>label{display:grid;grid-template-columns:56px minmax(0,1fr);align-items:center;gap:8px;color:var(--muted);font-size:10px}.uw-habit-period-pop input{min-width:0;width:100%;height:34px;padding:4px 6px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--text);font:inherit;font-size:10px}.uw-habit-period-pop>small{color:var(--muted);font-size:9px}.uw-habit-time-plan{display:grid;gap:8px;padding-top:9px;border-top:1px solid var(--line)}.uw-habit-time-add{min-height:34px;padding:5px 9px;border:1px dashed color-mix(in srgb,var(--accent) 45%,var(--line));border-radius:8px;background:color-mix(in srgb,var(--accent) 5%,#fff);color:var(--accent-dark);font:inherit;font-size:10px;cursor:pointer}.uw-habit-time-add[hidden]{display:none!important}.uw-habit-time-fields{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;align-items:end;gap:7px}.uw-habit-time-fields[hidden]{display:none!important}.uw-habit-time-fields label{display:grid;gap:4px;color:var(--muted);font-size:9px}.uw-habit-time-fields input,.uw-habit-time-fields select{min-width:0;width:100%;height:34px;padding:4px 6px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--text);font:inherit;font-size:10px}.uw-habit-time-remove{height:34px;padding:4px 8px;border:0;border-radius:8px;background:var(--soft);color:var(--muted);font:inherit;font-size:9px;cursor:pointer}.uw-habit-repeat-pop{right:0;left:auto}.uw-habit-repeat-pop .uw-repeat-custom{flex-wrap:wrap}\n@media(max-width:760px){#habitPageForm.uw-habit-add-form{display:flex!important;flex-wrap:wrap;gap:7px}#habitPageForm>#habitPageTitle{flex:1 0 100%;height:40px}#habitPageForm>.uw-habit-icon-field,.uw-habit-period-control,.uw-habit-repeat-control{flex:1 1 auto}#habitPageForm>.primary-btn{flex:0 0 auto}.uw-habit-period-button,.uw-habit-repeat-button{width:100%;height:38px}.uw-habit-period-control,.uw-habit-repeat-control{position:static}.uw-habit-period-pop,.uw-habit-repeat-pop{position:fixed;right:12px;bottom:14px;left:12px;top:auto;width:auto;max-height:70vh;overflow-y:auto}.uw-habit-time-fields{grid-template-columns:1fr 1fr}.uw-habit-time-remove{grid-column:1/-1}}\n'''
path.write_text(text)

print('refined habit quick add')
