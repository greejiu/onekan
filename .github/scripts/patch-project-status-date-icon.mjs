import fs from 'node:fs';

const statusPath = 'js/project-status.js';
let src = fs.readFileSync(statusPath, 'utf8');

function replaceOnce(from, to, label) {
  if (!src.includes(from)) throw new Error(`Missing patch target: ${label}`);
  src = src.replace(from, to);
}

replaceOnce(
`    .onekan-project-period button:hover{background:#fff}\n`,
`    .onekan-project-period button:hover{background:#fff}\n    .onekan-project-period button svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}\n`,
'project period icon style'
);

replaceOnce(
'<button type="button" data-project-period="${esc(project.id)}" aria-label="기간 수정" title="기간 수정">▣</button>',
'<button type="button" data-project-period="${esc(project.id)}" aria-label="기간 수정" title="기간 수정"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="15" rx="2"></rect><path d="M8 3.5v4M16 3.5v4M3.5 10h17"></path></svg></button>',
'project period button icon'
);

fs.writeFileSync(statusPath, src);

const indexPath = 'index.html';
let index = fs.readFileSync(indexPath, 'utf8');
if (!index.includes('./js/project-status.js?v=2')) throw new Error('Missing project-status cache target');
index = index.replace('./js/project-status.js?v=2', './js/project-status.js?v=3');
fs.writeFileSync(indexPath, index);
