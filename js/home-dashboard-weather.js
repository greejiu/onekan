const WEATHER_CACHE_KEY = "onekan-home-weather-v1";
const WEATHER_CACHE_MS = 15 * 60 * 1000;
const YANGYANG = { latitude: 38.0754, longitude: 128.6191, name: "양양" };

const weatherCodes = {
  0: ["☀️", "맑음"], 1: ["🌤️", "대체로 맑음"], 2: ["⛅", "구름 조금"], 3: ["☁️", "흐림"],
  45: ["🌫️", "안개"], 48: ["🌫️", "서리 안개"], 51: ["🌦️", "약한 이슬비"], 53: ["🌦️", "이슬비"],
  55: ["🌧️", "강한 이슬비"], 61: ["🌦️", "약한 비"], 63: ["🌧️", "비"], 65: ["🌧️", "강한 비"],
  71: ["🌨️", "약한 눈"], 73: ["🌨️", "눈"], 75: ["❄️", "강한 눈"], 80: ["🌦️", "소나기"],
  81: ["🌧️", "소나기"], 82: ["⛈️", "강한 소나기"], 95: ["⛈️", "뇌우"], 96: ["⛈️", "우박 동반 뇌우"], 99: ["⛈️", "강한 우박 뇌우"],
};

function rounded(value) {
  return Number.isFinite(Number(value)) ? `${Math.round(Number(value))}°` : "—";
}

function renderWeather(weather) {
  const pair = weatherCodes[Number(weather.code)] || ["🌡️", "날씨"];
  const icon = document.querySelector("#homeWeatherIcon");
  const now = document.querySelector("#homeWeatherNow");
  const place = document.querySelector("#homeWeatherPlace");
  const range = document.querySelector("#homeWeatherRange");
  if (icon) icon.textContent = pair[0];
  if (now) now.textContent = `${rounded(weather.temperature)} · ${pair[1]}`;
  if (place) place.textContent = weather.place || YANGYANG.name;
  if (range) range.textContent = `최고 ${rounded(weather.max)} / 최저 ${rounded(weather.min)}`;
}

function cachedWeather() {
  try {
    const cached = JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY) || "null");
    return cached && Date.now() - Number(cached.savedAt || 0) < WEATHER_CACHE_MS ? cached : null;
  } catch {
    return null;
  }
}

async function loadWeather() {
  if (!document.querySelector("#homeWeather")) return;
  const cached = cachedWeather();
  if (cached) {
    renderWeather(cached);
    return;
  }
  try {
    const query = new URLSearchParams({
      latitude: String(YANGYANG.latitude), longitude: String(YANGYANG.longitude),
      current: "temperature_2m,weather_code", daily: "temperature_2m_max,temperature_2m_min",
      timezone: "Asia/Seoul", forecast_days: "1",
    });
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query}`);
    if (!response.ok) throw new Error(`weather ${response.status}`);
    const data = await response.json();
    const weather = {
      savedAt: Date.now(), place: YANGYANG.name,
      temperature: data.current?.temperature_2m, code: data.current?.weather_code,
      max: data.daily?.temperature_2m_max?.[0], min: data.daily?.temperature_2m_min?.[0],
    };
    renderWeather(weather);
    localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(weather));
  } catch (error) {
    console.warn("날씨를 불러오지 못했어요.", error);
    const now = document.querySelector("#homeWeatherNow");
    const range = document.querySelector("#homeWeatherRange");
    if (now) now.textContent = "날씨 연결 안 됨";
    if (range) range.textContent = "잠시 후 다시 확인해 주세요";
  }
}

loadWeather();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !cachedWeather()) loadWeather();
});
