import fs from 'node:fs';

function replaceRequired(text,before,after,label){if(!text.includes(before))throw new Error(`missing target: ${label}`);return text.replace(before,after)}
function decoded(value){return Buffer.from(value,'base64').toString('utf8')}

let index=fs.readFileSync('index.html','utf8');
index=replaceRequired(index,'<section class="page" id="page-repeat">\n        <div class="page-head"><div><h1 class="page-title">습관</h1></div></div>\n        <p class="onekan-repeat-intro">습관만 이곳에서 관리해요. 반복 할일은 할일에서, 반복 일정은 일정에서 관리합니다.</p>\n        <div class="onekan-repeat-grid" id="repeatOverviewBody"></div>\n      </section>','<section class="page" id="page-repeat">\n        <div class="page-head"><div><h1 class="page-title">습관</h1></div><div class="seg uw-task-mode-controls" aria-label="습관 보기"><button class="active" data-habit-mode="calendar" type="button">캘린더</button><button data-habit-mode="list" type="button">목록</button></div></div>\n        <div class="uw-task-subnav" id="habitPageSubnav"></div>\n        <div id="repeatOverviewBody"></div>\n      </section>','habit page shell');
index=replaceRequired(index,'./js/repeat-overview.js?v=4','./js/repeat-overview.js?v=5','habit workspace cache');
index=replaceRequired(index,'./js/habit-history-view.js?v=2','./js/habit-history-view.js?v=3','habit history cache');
fs.writeFileSync('index.html',index);

fs.writeFileSync('js/repeat-overview.js',decoded('"+habit_b64+"'));

let history=fs.readFileSync('js/habit-history-view.js','utf8');
history=replaceRequired(history,'function habitIdFromElement(element){const row=element?.closest?.(\'.onekan-repeat-row[data-context-kind="task"][data-context-id]\');if(!row)return null;return row.querySelector(".onekan-repeat-kind")?.textContent?.trim()==="습관"?row.dataset.contextId:null}','function habitIdFromElement(element){const row=element?.closest?.(\'[data-habit-item="1"][data-context-kind="task"][data-context-id],.onekan-repeat-row[data-context-kind="task"][data-context-id]\');if(!row)return null;if(row.dataset.habitItem==="1")return row.dataset.contextId;return row.querySelector(".onekan-repeat-kind")?.textContent?.trim()==="습관"?row.dataset.contextId:null}','habit history selector');
fs.writeFileSync('js/habit-history-view.js',history);
