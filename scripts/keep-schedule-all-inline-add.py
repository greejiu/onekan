from pathlib import Path

u=Path('js/unified-workspace.js')
i=Path('index.html')
text=u.read_text()
html=i.read_text()
old='''    const ordered=[...rows].sort((a,b)=>String(b.date||"").localeCompare(String(a.date||""))||manualOrderValue(a.item)-manualOrderValue(b.item)||new Date(a.item.start)-new Date(b.item.start)||String(a.item.title||"").localeCompare(String(b.item.title||""),"ko"));
    return `<div class="uw-schedule-list"><div class="uw-list uw-task-main-list uw-flat-all-list">${ordered.map(row=>itemMarkup("event",row.item,row.date,false,false,dayLabel(fromKey(row.date)))).join("")}</div></div>`
'''
new='''    const ordered=[...rows].sort((a,b)=>String(b.date||"").localeCompare(String(a.date||""))||manualOrderValue(a.item)-manualOrderValue(b.item)||new Date(a.item.start)-new Date(b.item.start)||String(a.item.title||"").localeCompare(String(b.item.title||""),"ko"));
    const add=`<div class="uw-list uw-task-main-list" data-uw-add-kind="event" data-date="${todayKey()}" data-task-drop-date="${todayKey()}">${scheduleInput(todayKey())}</div>`;
    return `<div class="uw-schedule-list">${add}<div class="uw-list uw-task-main-list uw-flat-all-list">${ordered.map(row=>itemMarkup("event",row.item,row.date,false,false,dayLabel(fromKey(row.date)))).join("")}</div></div>`
'''
assert old in text
text=text.replace(old,new,1)
assert './js/unified-workspace.js?v=74' in html
html=html.replace('./js/unified-workspace.js?v=74','./js/unified-workspace.js?v=75',1)
u.write_text(text)
i.write_text(html)
print('kept schedule all inline add')
