if (!window.__onekanTrackingContextMenuInstalled) {
  window.__onekanTrackingContextMenuInstalled = true;

  function trackableRecord(target) {
    if (!(target instanceof Element)) return null;

    const explicit = target.closest('[data-context-kind][data-context-id]');
    if (explicit) {
      const rawKind = explicit.dataset.contextKind || '';
      if (rawKind === 'task' || rawKind === 'habit') {
        const id = explicit.dataset.contextId || '';
        if (!id) return null;
        const unifiedHabit = explicit.dataset.habitItem === '1' || Boolean(explicit.closest('#page-repeat'));
        const title = explicit.querySelector('.uw-item-title,.uw-habit-title,.habit-title,.row-title,.workspace-task-title,strong')?.textContent?.trim() || '이름 없는 항목';
        return {
          id,
          title,
          sourceKind: rawKind === 'habit' ? 'habit' : 'task',
          displayKind: unifiedHabit || rawKind === 'habit' ? 'habit' : 'task',
        };
      }
    }

    const unified = target.closest('[data-uw-kind="task"][data-id],[data-uw-kind="habit"][data-id]');
    if (unified) {
      const rawKind = unified.dataset.uwKind || 'task';
      const id = unified.dataset.id || '';
      if (!id) return null;
      const unifiedHabit = unified.dataset.habitItem === '1' || Boolean(unified.closest('#page-repeat'));
      const title = unified.querySelector('.uw-item-title,.uw-habit-title,.habit-title,strong')?.textContent?.trim() || '이름 없는 항목';
      return {
        id,
        title,
        sourceKind: rawKind === 'habit' ? 'habit' : 'task',
        displayKind: unifiedHabit || rawKind === 'habit' ? 'habit' : 'task',
      };
    }

    const legacyTask = target.closest('#taskList .row[data-id]');
    if (legacyTask) {
      const id = legacyTask.dataset.id || '';
      const title = legacyTask.querySelector('.row-title,strong')?.textContent?.trim() || '이름 없는 할일';
      return id ? { id, title, sourceKind: 'task', displayKind: 'task' } : null;
    }

    const somedayTask = target.closest('#featureSomedayList .row[data-task-id]');
    if (somedayTask) {
      const id = somedayTask.dataset.taskId || '';
      const title = somedayTask.querySelector('.row-title,strong')?.textContent?.trim() || '이름 없는 할일';
      return id ? { id, title, sourceKind: 'task', displayKind: 'task' } : null;
    }

    return null;
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
      if (ensureTrackingOption(record) || attempts >= 10) return;
      setTimeout(apply, 80);
    };
    setTimeout(apply, 0);
  }

  document.addEventListener('contextmenu', (event) => {
    const record = trackableRecord(event.target);
    if (!record) return;

    // 기존 context-menu.js가 capture 단계에서 전파를 멈추므로
    // 이 리스너도 capture에서 같은 이벤트를 받아 실제 전역 메뉴에 항목을 넣는다.
    setTimeout(() => {
      const menu = document.querySelector('#globalContextMenu');
      if (!menu) return;

      menu.querySelector('[data-onekan-track-now]')?.remove();
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.dataset.onekanTrackNow = '1';
      button.dataset.trackId = record.id;
      button.dataset.trackSourceKind = record.sourceKind;
      button.dataset.trackDisplayKind = record.displayKind;
      button.dataset.trackTitle = record.title;
      button.textContent = '시간추적하기';

      const deleteButton = menu.querySelector('[data-context-action="delete"]');
      if (deleteButton) menu.insertBefore(button, deleteButton);
      else menu.appendChild(button);

      // 기존 메뉴가 이미 열린 뒤 버튼이 추가되므로 위치를 한 번 더 화면 안으로 맞춘다.
      if (menu.classList.contains('open')) {
        const rect = menu.getBoundingClientRect();
        const currentLeft = Number.parseFloat(menu.style.left) || event.clientX;
        const currentTop = Number.parseFloat(menu.style.top) || event.clientY;
        menu.style.left = `${Math.max(8, Math.min(currentLeft, innerWidth - rect.width - 8))}px`;
        menu.style.top = `${Math.max(8, Math.min(currentTop, innerHeight - rect.height - 8))}px`;
      }
    }, 0);
  }, true);

  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-onekan-track-now]') : null;
    if (!button) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const record = {
      id: button.dataset.trackId || '',
      sourceKind: button.dataset.trackSourceKind || 'task',
      displayKind: button.dataset.trackDisplayKind || 'task',
      title: button.dataset.trackTitle || '이름 없는 항목',
    };
    document.querySelector('#globalContextMenu')?.classList.remove('open');
    if (record.id) openTracking(record);
  }, true);
}
