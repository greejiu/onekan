if (!window.__onekanTrackingContextMenuInstalled) {
  window.__onekanTrackingContextMenuInstalled = true;

  function trackableRecord(target) {
    const item = target?.closest?.('.uw-item[data-uw-kind]');
    if (!item) return null;

    const rawKind = item.dataset.uwKind || '';
    if (rawKind !== 'task' && rawKind !== 'habit') return null;

    const id = item.dataset.id || item.dataset.contextId || '';
    if (!id) return null;

    const unifiedHabit = item.dataset.habitItem === '1';
    const title = item.querySelector('.uw-item-title,.uw-habit-title,.habit-title')?.textContent?.trim() || '이름 없는 항목';

    // 새 습관 화면은 task 객체 + isHabit 구조라 timer에서는 task:{id}로 연결한다.
    const sourceKind = rawKind === 'habit' ? 'habit' : 'task';
    const displayKind = unifiedHabit || rawKind === 'habit' ? 'habit' : 'task';
    return { id, title, sourceKind, displayKind };
  }

  function ensureTrackingOption(record) {
    const select = document.querySelector('#timerTaskSelect');
    if (!select) return false;

    const value = `${record.sourceKind}:${record.id}`;
    let option = [...select.options].find((entry) => entry.value === value);
    if (!option) {
      const groupLabel = record.displayKind === 'habit' ? '습관' : '할일';
      let group = [...select.querySelectorAll('optgroup')].find((entry) => entry.label === groupLabel);
      if (!group) {
        group = document.createElement('optgroup');
        group.label = groupLabel;
        select.appendChild(group);
      }
      option = document.createElement('option');
      option.value = value;
      option.textContent = record.title;
      group.appendChild(option);
    }

    select.value = value;
    const custom = document.querySelector('#timerCustomTitle');
    if (custom) custom.value = '';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    const label = document.querySelector('#timerTaskLabel');
    if (label) label.textContent = record.title;

    const start = document.querySelector('#timerStart');
    if (start) {
      try { start.focus({ preventScroll: true }); } catch { start.focus(); }
      start.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    return true;
  }

  function openTracking(record) {
    const nav = document.querySelector('.nav-item[data-page="tracking"]');
    nav?.click();

    let attempts = 0;
    const apply = () => {
      attempts += 1;
      if (ensureTrackingOption(record) || attempts >= 8) return;
      setTimeout(apply, 80);
    };
    setTimeout(apply, 0);
  }

  document.addEventListener('contextmenu', (event) => {
    const record = trackableRecord(event.target);
    if (!record) return;

    // 기존 우클릭 핸들러가 메뉴를 그린 뒤 마지막에 항목만 덧붙인다.
    setTimeout(() => {
      const menu = document.querySelector('#uwContext');
      if (!menu) return;

      menu.querySelector('[data-onekan-track-now]')?.remove();
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.onekanTrackNow = '1';
      button.dataset.trackId = record.id;
      button.dataset.trackSourceKind = record.sourceKind;
      button.dataset.trackDisplayKind = record.displayKind;
      button.dataset.trackTitle = record.title;
      button.textContent = '시간추적하기';

      const danger = menu.querySelector('.danger');
      if (danger) menu.insertBefore(button, danger);
      else menu.appendChild(button);

      if (!menu.classList.contains('open')) {
        menu.style.left = `${Math.min(innerWidth - 170, event.clientX)}px`;
        menu.style.top = `${Math.min(innerHeight - 190, event.clientY)}px`;
        menu.classList.add('open');
      }
    }, 0);
  });

  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-onekan-track-now]');
    if (!button) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const record = {
      id: button.dataset.trackId || '',
      sourceKind: button.dataset.trackSourceKind || 'task',
      displayKind: button.dataset.trackDisplayKind || 'task',
      title: button.dataset.trackTitle || '이름 없는 항목',
    };
    document.querySelector('#uwContext')?.classList.remove('open');
    if (record.id) openTracking(record);
  }, true);
}
