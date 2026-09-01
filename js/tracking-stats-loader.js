const STATS_CSS_ID = "onekanTrackingStatsCss";

if (!document.getElementById(STATS_CSS_ID)) {
  const link = document.createElement("link");
  link.id = STATS_CSS_ID;
  link.rel = "stylesheet";
  link.href = "./css/tracking-stats.css?v=2";
  document.head.appendChild(link);
}

import("./tracking-stats.js?v=2").catch((error) => {
  console.warn("시간 통계 모듈을 불러오지 못했습니다.", error);
});

import("./backup-manager.js?v=1").catch((error) => {
  console.warn("백업 관리 모듈을 불러오지 못했습니다.", error);
});
