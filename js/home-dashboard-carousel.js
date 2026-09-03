const MOBILE_DASHBOARD_QUERY = "(max-width: 760px)";

function initHomeDashboardCarousel() {
  const track = document.querySelector("#homeDashboardTrack");
  const dots = [...document.querySelectorAll("[data-home-dashboard-page]")];
  if (!track || dots.length < 2) return;

  const mobile = matchMedia(MOBILE_DASHBOARD_QUERY);
  let animationFrame = 0;

  const activeIndex = () => {
    const width = track.clientWidth;
    return width ? Math.max(0, Math.min(dots.length - 1, Math.round(track.scrollLeft / width))) : 0;
  };
  const updateDots = () => {
    cancelAnimationFrame(animationFrame);
    animationFrame = requestAnimationFrame(() => {
      const current = activeIndex();
      dots.forEach((dot, index) => {
        const active = index === current;
        dot.classList.toggle("active", active);
        if (active) dot.setAttribute("aria-current", "page");
        else dot.removeAttribute("aria-current");
      });
    });
  };
  const resetForLayout = () => {
    if (!mobile.matches) track.scrollTo({ left: 0, behavior: "auto" });
    updateDots();
  };

  dots.forEach((dot, index) => dot.addEventListener("click", () => {
    if (!mobile.matches) return;
    track.scrollTo({ left: track.clientWidth * index, behavior: "smooth" });
  }));
  track.addEventListener("scroll", updateDots, { passive: true });
  track.addEventListener("scrollend", updateDots);
  mobile.addEventListener?.("change", resetForLayout);
  if ("ResizeObserver" in window) new ResizeObserver(updateDots).observe(track);
  updateDots();
}

initHomeDashboardCarousel();
