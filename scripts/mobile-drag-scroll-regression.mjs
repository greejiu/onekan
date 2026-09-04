import assert from 'node:assert/strict';
import fs from 'node:fs';

const workspace=fs.readFileSync('js/unified-workspace.js','utf8');
const css=fs.readFileSync('css/unified-workspace.css','utf8');
const index=fs.readFileSync('index.html','utf8');

assert.match(workspace,/const DRAG_MOUSE_DISTANCE=6,TOUCH_HANDLE_DISTANCE=4,TOUCH_SCROLL_DISTANCE=10,TOUCH_HOLD_MS=450,TOUCH_HANDLE_HOLD_MS=180/,'drag controller must keep separate mouse, touch-scroll and touch-handle thresholds');
assert.match(workspace,/const sharedDragRow=!coarsePointer&&!interactive&&movableRow/,'a coarse pointer must not turn the scrollable card body into a drag surface');
assert.match(workspace,/if\(g\.coarse&&g\.dedicatedHandle\)\{\s*e\.preventDefault\(\);\s*g\.timer=setTimeout\(\(\)=>activate\(g\),TOUCH_HANDLE_HOLD_MS\)/,'the mobile handle must claim touch before the browser starts scrolling');
assert.match(workspace,/if\(g\.coarse&&g\.dedicatedHandle&&distance>=TOUCH_HANDLE_DISTANCE\)activate\(g\)/,'moving a mobile handle must activate drag without waiting for a full long press');
assert.match(workspace,/document\.addEventListener\("pointercancel",\(\)=>clear\(gesture\)\)/,'cancelled browser gestures must always clear drag state');
assert.match(css,/@media\(hover:none\),\(pointer:coarse\)\{\.uw-item\{touch-action:pan-y\}/,'mobile card bodies must retain native vertical scrolling');
assert.match(css,/\.uw-item\.selected \.uw-move-handle[^\{]*\{[^}]*touch-action:none!important/,'the visible mobile move handle must opt out of browser scrolling before pointerdown');
assert.match(index,/unified-workspace\.css\?v=\d+/,'mobile drag CSS cache must be refreshed');
assert.match(workspace,/function timeBlockV2ItemMarkup[\s\S]*?uw-move-handle[\s\S]*?function timeBlockV2ManualGroup/,'time-block list cards must expose the mobile move handle');
assert.doesNotMatch(workspace,/function timeBlockV2TimelinePlanItemMarkup[\s\S]*?replace\(\/<button class="uw-move-handle"[\s\S]*?function timeBlockV2TimelineProjection/,'projected time-block cards must retain the mobile move handle');
assert.match(index,/unified-workspace\.js\?v=\d+/,'mobile drag JavaScript cache must be refreshed');

console.log('mobile drag scroll regression: ok');
