if (!window.__onekanHomeTimelineDynamicColumnsInstalled) {
  window.__onekanHomeTimelineDynamicColumnsInstalled = true;

  const style = document.createElement("style");
  style.dataset.onekanHomeTimelineDynamicColumns = "1";
  style.textContent = `
    /* Home timeline: don't reserve a permanent left/right half for exact vs planned items. */
    #page-home .uw-has-time-block-plan .uw-time-exact-lane {
      right: 0 !important;
    }

    #page-home .uw-time-block-plan-rail {
      left: 0 !important;
      right: 0 !important;
    }

    #page-home .uw-time-block-plan-group {
      right: auto !important;
      min-width: 0;
    }

    /* Items assigned to the same planning anchor share that time horizontally. */
    #page-home .uw-time-block-plan-rows {
      display: grid !important;
      grid-template-columns: repeat(var(--uw-plan-columns, 1), minmax(0, 1fr));
      gap: 2px;
    }

    #page-home .uw-time-block-plan-item {
      min-width: 0;
      width: auto;
    }
  `;
  document.head.appendChild(style);

  let frame = 0;

  function px(value, fallback = 0) {
    const number = Number.parseFloat(String(value || ""));
    return Number.isFinite(number) ? number : fallback;
  }

  function topOf(element) {
    return px(element.style.top, px(getComputedStyle(element).top, element.offsetTop || 0));
  }

  function heightOf(element, fallback = 18) {
    return Math.max(1, px(element.style.height, element.offsetHeight || fallback));
  }

  function planGroupInfo(group) {
    const rows = group.querySelector(".uw-time-block-plan-rows");
    const items = rows ? [...rows.querySelectorAll(":scope > .uw-time-block-plan-item")] : [];
    const weight = Math.max(1, items.length);

    if (rows) rows.style.setProperty("--uw-plan-columns", String(weight));

    // Projection previously pushed groups downward because rows were stacked vertically.
    // Once rows become columns, restore the group's real anchor position.
    const currentTop = topOf(group);
    const oldOffset = px(group.style.getPropertyValue("--uw-plan-anchor-offset"), 0);
    const anchorTop = Math.max(0, currentTop - oldOffset);
    group.style.setProperty("top", `${anchorTop}px`, "important");
    group.style.setProperty("--uw-plan-anchor-offset", "0px");

    // Measure after switching the group's rows to horizontal columns.
    const measuredHeight = Math.max(
      18,
      rows?.offsetHeight || 0,
      ...items.map(item => item.offsetHeight || 0),
    );

    return {
      element: group,
      top: anchorTop,
      bottom: anchorTop + measuredHeight,
      weight,
      kind: "plan",
    };
  }

  function exactEntryInfo(entry) {
    const top = topOf(entry);
    const height = heightOf(entry);
    return {
      element: entry,
      top,
      bottom: top + height,
      weight: 1,
      kind: "exact",
    };
  }

  function splitIntoOverlapClusters(units) {
    const sorted = [...units].sort((a, b) => a.top - b.top || b.bottom - a.bottom || b.weight - a.weight);
    const clusters = [];
    let current = [];
    let end = -Infinity;

    const flush = () => {
      if (current.length) clusters.push(current);
      current = [];
      end = -Infinity;
    };

    for (const unit of sorted) {
      if (current.length && unit.top >= end - 0.5) flush();
      current.push(unit);
      end = Math.max(end, unit.bottom);
    }
    flush();
    return clusters;
  }

  function contiguousFreeStart(laneEnds, weight, top) {
    const maxStart = laneEnds.length - weight;
    for (let start = 0; start <= maxStart; start += 1) {
      let free = true;
      for (let index = start; index < start + weight; index += 1) {
        if ((laneEnds[index] ?? -Infinity) > top + 0.5) {
          free = false;
          break;
        }
      }
      if (free) return start;
    }
    return -1;
  }

  function layoutCluster(cluster) {
    const laneEnds = [];
    const ordered = [...cluster].sort((a, b) => a.top - b.top || b.weight - a.weight || b.bottom - a.bottom);

    for (const unit of ordered) {
      let lane = contiguousFreeStart(laneEnds, unit.weight, unit.top);
      if (lane < 0) {
        lane = laneEnds.length;
        for (let count = 0; count < unit.weight; count += 1) laneEnds.push(-Infinity);
      }
      for (let index = lane; index < lane + unit.weight; index += 1) laneEnds[index] = unit.bottom;
      unit.lane = lane;
    }

    const columns = Math.max(1, laneEnds.length);
    for (const unit of cluster) {
      const lane = Math.max(0, unit.lane || 0);
      const left = (lane / columns) * 100;
      const width = (unit.weight / columns) * 100;
      unit.element.style.setProperty("left", `calc(${left}% + 1px)`, "important");
      unit.element.style.setProperty("width", `calc(${width}% - 2px)`, "important");
      unit.element.style.setProperty("right", "auto", "important");
    }
  }

  function layoutLane(lane) {
    const exactLane = lane.querySelector(":scope > .uw-time-exact-lane");
    const planRail = lane.querySelector(":scope > .uw-time-block-plan-rail");

    const exactEntries = exactLane ? [...exactLane.querySelectorAll(":scope > .uw-time-entry")] : [];
    const planGroups = planRail ? [...planRail.querySelectorAll(":scope > .uw-time-block-plan-group")] : [];

    if (!exactEntries.length && !planGroups.length) return;

    // Start from full width every time so a single item always occupies one full column.
    for (const entry of exactEntries) {
      entry.style.setProperty("left", "1px", "important");
      entry.style.setProperty("width", "calc(100% - 2px)", "important");
      entry.style.setProperty("right", "auto", "important");
    }
    for (const group of planGroups) {
      group.style.setProperty("left", "1px", "important");
      group.style.setProperty("width", "calc(100% - 2px)", "important");
      group.style.setProperty("right", "auto", "important");
    }

    const units = [
      ...exactEntries.map(exactEntryInfo),
      ...planGroups.map(planGroupInfo),
    ];

    for (const cluster of splitIntoOverlapClusters(units)) layoutCluster(cluster);
  }

  function layoutAll() {
    frame = 0;
    document.querySelectorAll("#page-home .home-timeline-card .uw-time-lane").forEach(layoutLane);
  }

  function scheduleLayout() {
    if (frame) return;
    frame = requestAnimationFrame(layoutAll);
  }

  const observer = new MutationObserver(mutations => {
    if (mutations.some(mutation => mutation.type === "childList")) scheduleLayout();
  });

  const start = () => {
    observer.observe(document.body, { childList: true, subtree: true });
    scheduleLayout();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  window.addEventListener("resize", scheduleLayout, { passive: true });
  document.addEventListener("onekan:state-changed", () => setTimeout(scheduleLayout, 160));
}
