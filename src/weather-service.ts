import { requestUrl } from 'obsidian';
import type { WeatherConfig, WeatherData } from './types';
import { getLanguage } from './i18n';

// ---------- API response shapes ----------
// `requestUrl(...).json` is typed `any`; these interfaces model each provider's
// payload so structured access doesn't leak `any` downstream.

interface OpenMeteoCurrent {
	temperature_2m?: number;
	weather_code?: number;
	wind_speed_10m?: number;
	relative_humidity_2m?: number;
	apparent_temperature?: number;
}

interface OpenMeteoDaily {
	temperature_2m_max?: number[];
	temperature_2m_min?: number[];
	weather_code?: number[];
	time?: string[];
}

interface OpenMeteoResponse {
	current?: OpenMeteoCurrent;
	daily?: OpenMeteoDaily;
}

interface MetNoDetails {
	air_temperature?: number;
	wind_speed?: number;
	relative_humidity?: number;
}

interface MetNoSummary {
	symbol_code?: string;
}

interface MetNoEntry {
	time: string;
	data: {
		instant: { details: MetNoDetails };
		next_1_hours?: { summary?: MetNoSummary };
		next_6_hours?: { summary?: MetNoSummary };
	};
}

interface MetNoResponse {
	properties?: { timeseries?: MetNoEntry[] };
}

interface WttrHourly {
	weatherCode?: string;
}

interface WttrDay {
	maxtempC: string;
	mintempC: string;
	date: string;
	hourly: WttrHourly[];
}

interface WttrCurrent {
	temp_C: string;
	weatherCode: string;
	windspeedKmph: string;
	humidity: string;
	FeelsLikeC: string;
}

interface WttrResponse {
	current_condition?: WttrCurrent[];
	weather?: WttrDay[];
}

interface GeocodeItem {
	name: string;
	latitude: number;
	longitude: number;
	country: string;
	admin1?: string;
}

interface GeocodeResponse {
	results?: GeocodeItem[];
}

const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

interface CacheEntry {
	data: WeatherData;
	fetchedAt: number;
}

const weatherCache = new Map<string, CacheEntry>();

export interface GeocodeResult {
	name: string;
	latitude: number;
	longitude: number;
	country: string;
	admin1?: string;
}

export function clearWeatherCache(): void {
	weatherCache.clear();
}

export function getCachedWeather(config: WeatherConfig): WeatherData | null {
	const key = cacheKey(config);
	const entry = weatherCache.get(key);
	if (!entry) return null;
	if (Date.now() - entry.fetchedAt > CACHE_TTL) {
		weatherCache.delete(key);
		return null;
	}
	return entry.data;
}

// Priority: Met.no (fast, 5+ day) → wttr.in (3-day) → Open-Meteo → Open-Meteo Archive
export async function fetchWeather(config: WeatherConfig): Promise<WeatherData> {
	const cached = getCachedWeather(config);
	if (cached) return cached;

	try {
		return await fetchFromMetNo(config);
	} catch { /* try next */ }

	try {
		return await fetchFromWttr(config);
	} catch { /* try next */ }

	try {
		return await fetchFromOpenMeteo(config);
	} catch { /* try next */ }

	try {
		return await fetchFromOpenMeteoArchive(config);
	} catch { /* all failed */ }

	throw new Error('All weather APIs failed');
}

// ---------- Open-Meteo (primary) ----------

async function fetchFromOpenMeteo(config: WeatherConfig): Promise<WeatherData> {
	return fetchFromOpenMeteoBase('https://api.open-meteo.com', config);
}

async function fetchFromOpenMeteoArchive(config: WeatherConfig): Promise<WeatherData> {
	return fetchFromOpenMeteoBase('https://archive-api.open-meteo.com', config);
}

async function fetchFromOpenMeteoBase(base: string, config: WeatherConfig): Promise<WeatherData> {
	const url = `${base}/v1/forecast?latitude=${config.latitude}&longitude=${config.longitude}&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m,apparent_temperature&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=5`;

	const resp = await requestUrl({ url });
	const json = resp.json as OpenMeteoResponse;

	const current = json.current;
	const daily = json.daily;

	if (!current || !daily) {
		throw new Error('Invalid weather API response');
	}

	const data: WeatherData = {
		temperature: typeof current.temperature_2m === 'number' ? current.temperature_2m : 0,
		weatherCode: typeof current.weather_code === 'number' ? current.weather_code : 0,
		windSpeed: typeof current.wind_speed_10m === 'number' ? current.wind_speed_10m : 0,
		humidity: typeof current.relative_humidity_2m === 'number' ? current.relative_humidity_2m : 0,
		feelsLike: typeof current.apparent_temperature === 'number' ? current.apparent_temperature : 0,
		dailyMax: Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max.slice(0, 5) : [],
		dailyMin: Array.isArray(daily.temperature_2m_min) ? daily.temperature_2m_min.slice(0, 5) : [],
		dailyCodes: Array.isArray(daily.weather_code) ? daily.weather_code.slice(0, 5) : [],
		dailyDates: Array.isArray(daily.time) ? daily.time.slice(0, 5) : [],
		fetchedAt: Date.now(),
	};

	weatherCache.set(cacheKey(config), { data, fetchedAt: Date.now() });
	return data;
}

// ---------- Met.no (fallback, 5+ day forecast) ----------

async function fetchFromMetNo(config: WeatherConfig): Promise<WeatherData> {
	const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${config.latitude}&lon=${config.longitude}`;

	const resp = await requestUrl({ url, headers: { 'User-Agent': 'obsidian-dashboard' } });
	const json = resp.json as MetNoResponse;

	const timeseries = json.properties?.timeseries;
	if (!Array.isArray(timeseries) || timeseries.length === 0) {
		throw new Error('Invalid Met.no response');
	}

	const now = timeseries[0]!;
	const nowDetails = now.data.instant.details;
	const nowSymbol = now.data.next_1_hours?.summary?.symbol_code
		?? now.data.next_6_hours?.summary?.symbol_code
		?? 'clearsky';

	// Group by date, compute daily max/min and representative weather code
	const dayMap = new Map<string, { min: number; max: number; codes: string[] }>();
	for (const entry of timeseries) {
		const dateStr = entry.time.slice(0, 10);
		const temp = entry.data.instant.details.air_temperature as number;
		const sym = entry.data.next_1_hours?.summary?.symbol_code
			?? entry.data.next_6_hours?.summary?.symbol_code;

		if (!dayMap.has(dateStr)) {
			dayMap.set(dateStr, { min: temp, max: temp, codes: [] });
		}
		const d = dayMap.get(dateStr)!;
		d.min = Math.min(d.min, temp);
		d.max = Math.max(d.max, temp);
		if (sym) d.codes.push(sym);
	}

	const dailyDates = [...dayMap.keys()].slice(0, 5);
	const dailyMax = dailyDates.map(d => Math.round(dayMap.get(d)!.max));
	const dailyMin = dailyDates.map(d => Math.round(dayMap.get(d)!.min));
	const dailyCodes = dailyDates.map(d => {
		const codes = dayMap.get(d)!.codes;
		return codes.length > 0 ? mapMetNoCode(metNoDaytimeCode(codes)) : 0;
	});

	const data: WeatherData = {
		temperature: Math.round(nowDetails.air_temperature as number),
		weatherCode: mapMetNoCode(nowSymbol),
		windSpeed: Math.round(nowDetails.wind_speed as number),
		humidity: Math.round(nowDetails.relative_humidity as number),
		feelsLike: Math.round(nowDetails.air_temperature as number),
		dailyMax,
		dailyMin,
		dailyCodes,
		dailyDates,
		fetchedAt: Date.now(),
	};

	weatherCache.set(cacheKey(config), { data, fetchedAt: Date.now() });
	return data;
}

const METNO_TO_WMO: Record<string, number> = {
	clearsky: 0, clearsky_night: 0,
	fair: 1, fair_night: 1,
	partlycloudy: 2, partlycloudy_night: 2,
	cloudy: 3,
	fog: 45,
	lightrain: 61, lightrain_night: 61,
	rain: 63, rain_night: 63,
	heavyrain: 65, heavyrain_night: 65,
	lightrainshowers: 80, lightrainshowers_night: 80,
	rainshowers: 81, rainshowers_night: 81,
	heavyrainshowers: 82, heavyrainshowers_night: 82,
	lightsleet: 66, lightsleet_night: 66,
	sleet: 67, sleet_night: 67,
	lightsnow: 71, lightsnow_night: 71,
	snow: 73, snow_night: 73,
	heavysnow: 75, heavysnow_night: 75,
	lightssleetshowers: 85, lightssleetshowers_night: 85,
	sleetshowers: 85, sleetshowers_night: 85,
	lightssnowshowers: 85, lightssnowshowers_night: 85,
	snowshowers: 86, snowshowers_night: 86,
	thunderstorm: 95, thunderstorm_night: 95,
};

function mapMetNoCode(symbol: string): number {
	return METNO_TO_WMO[symbol] ?? 3;
}

function metNoDaytimeCode(codes: string[]): string {
	const daylight = codes.find(c => !c.includes('_night'));
	return daylight ?? codes[0] ?? 'cloudy';
}

// ---------- wttr.in (last fallback, 3-day forecast) ----------

async function fetchFromWttr(config: WeatherConfig): Promise<WeatherData> {
	const url = `https://wttr.in/${config.latitude},${config.longitude}?format=j1`;

	const resp = await requestUrl({ url });
	const json = resp.json as WttrResponse;

	const current = json.current_condition?.[0];
	if (!current) {
		throw new Error('Invalid wttr.in response');
	}

	const dailyEntries = json.weather;
	if (!Array.isArray(dailyEntries) || dailyEntries.length === 0) {
		throw new Error('Invalid wttr.in forecast data');
	}

	const dailyMax: number[] = [];
	const dailyMin: number[] = [];
	const dailyCodes: number[] = [];
	const dailyDates: string[] = [];

	for (const day of dailyEntries.slice(0, 5)) {
		dailyMax.push(parseInt(day.maxtempC, 10) || 0);
		dailyMin.push(parseInt(day.mintempC, 10) || 0);
		dailyDates.push(day.date || '');

		const hourlyCodes = (day.hourly || [])
			.map((h: WttrHourly) => parseInt(h.weatherCode ?? '0', 10))
			.filter((n: number) => !isNaN(n));
		dailyCodes.push(hourlyCodes.length > 0 ? mostSevereWttrCode(hourlyCodes) : 0);
	}

	const data: WeatherData = {
		temperature: parseInt(current.temp_C, 10) || 0,
		weatherCode: mapWttrCode(parseInt(current.weatherCode, 10) || 0),
		windSpeed: parseInt(current.windspeedKmph, 10) || 0,
		humidity: parseInt(current.humidity, 10) || 0,
		feelsLike: parseInt(current.FeelsLikeC, 10) || 0,
		dailyMax,
		dailyMin,
		dailyCodes: dailyCodes.map(c => mapWttrCode(c)),
		dailyDates,
		fetchedAt: Date.now(),
	};

	weatherCache.set(cacheKey(config), { data, fetchedAt: Date.now() });
	return data;
}

const WTTR_TO_WMO: Record<number, number> = {
	113: 0, 116: 2, 119: 3, 122: 3,
	143: 45, 248: 45, 260: 48,
	176: 61, 263: 51, 266: 53,
	281: 56, 285: 57,
	293: 61, 296: 63, 299: 63, 302: 65, 305: 65, 308: 65,
	311: 66, 314: 67, 317: 66, 320: 67,
	323: 71, 326: 73, 329: 73, 332: 75, 335: 75, 338: 75,
	350: 77, 374: 77, 377: 77,
	353: 80, 356: 81, 359: 82,
	362: 85, 365: 85, 368: 85, 371: 86,
	200: 95, 386: 95, 389: 95, 392: 96, 395: 99,
	179: 71, 182: 66, 185: 56, 227: 75, 230: 75,
};

function mapWttrCode(wttrCode: number): number {
	return WTTR_TO_WMO[wttrCode] ?? 0;
}

const WTTR_SEVERITY: Record<number, number> = {
	0: 0, 1: 1, 2: 2, 3: 3,
	45: 4, 48: 5,
	51: 6, 53: 7, 55: 8,
	56: 9, 57: 10,
	61: 11, 63: 12, 65: 13,
	66: 14, 67: 15,
	71: 16, 73: 17, 75: 18, 77: 19,
	80: 11, 81: 12, 82: 13,
	85: 16, 86: 18,
	95: 20, 96: 21, 99: 22,
};

function mostSevereWttrCode(codes: number[]): number {
	let worst = codes[0]!;
	let worstRank = WTTR_SEVERITY[mapWttrCode(worst)] ?? 0;
	for (let i = 1; i < codes.length; i++) {
		const code = codes[i]!;
		const rank = WTTR_SEVERITY[mapWttrCode(code)] ?? 0;
		if (rank > worstRank) {
			worst = code;
			worstRank = rank;
		}
	}
	return worst;
}

// ---------- Geocoding ----------

export async function geocodeCity(query: string): Promise<GeocodeResult[]> {
	if (!query.trim()) return [];

	const lang = getLanguage();
	const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=${lang === 'zh' ? 'zh' : 'en'}`;

	try {
		const resp = await requestUrl({ url });
		const json = resp.json as GeocodeResponse;
		if (!json.results) return [];

		return json.results.map((r: GeocodeItem) => ({
			name: r.name,
			latitude: r.latitude,
			longitude: r.longitude,
			country: r.country,
			admin1: r.admin1,
		}));
	} catch {
		return [];
	}
}

// ---------- Helpers ----------

function cacheKey(config: WeatherConfig): string {
	return `${config.latitude.toFixed(4)},${config.longitude.toFixed(4)}`;
}

const WEATHER_EMOJI: Record<number, string> = {
	0: '☀️',   // Clear sky
	1: '🌤',   // Mainly clear
	2: '⛅',         // Partly cloudy
	3: '☁️',   // Overcast
	45: '🌫',  // Fog
	48: '🌫',  // Depositing rime fog
	51: '💧',  // Light drizzle
	53: '💧',  // Moderate drizzle
	55: '💧',  // Dense drizzle
	56: '💧',  // Light freezing drizzle
	57: '💧',  // Dense freezing drizzle
	61: '🌧',  // Slight rain
	63: '🌧',  // Moderate rain
	65: '🌧',  // Heavy rain
	66: '🌨',  // Light freezing rain
	67: '🌨',  // Heavy freezing rain
	71: '🌨',  // Slight snow
	73: '❄️',  // Moderate snow
	75: '❄️',  // Heavy snow
	77: '❄️',  // Snow grains
	80: '🌧',  // Slight rain showers
	81: '🌧',  // Moderate rain showers
	82: '🌧',  // Violent rain showers
	85: '❄️',  // Slight snow showers
	86: '❄️',  // Heavy snow showers
	95: '⛈️',  // Thunderstorm
	96: '⛈️',  // Thunderstorm with slight hail
	99: '⛈️',  // Thunderstorm with heavy hail
};

export function getWeatherEmoji(code: number): string {
	return WEATHER_EMOJI[code] ?? '☁️';
}

const WEATHER_DESC_EN: Record<number, string> = {
	0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
	45: 'Fog', 48: 'Rime fog',
	51: 'Light drizzle', 53: 'Drizzle', 55: 'Dense drizzle',
	56: 'Freezing drizzle', 57: 'Freezing drizzle',
	61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
	66: 'Freezing rain', 67: 'Freezing rain',
	71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
	80: 'Showers', 81: 'Showers', 82: 'Heavy showers',
	85: 'Snow showers', 86: 'Heavy snow showers',
	95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm',
};

const WEATHER_DESC_ZH: Record<number, string> = {
	0: '晴', 1: '大部晴朗', 2: '多云', 3: '阴',
	45: '雾', 48: '雾凇',
	51: '小毛毛雨', 53: '毛毛雨', 55: '大毛毛雨',
	56: '冻毛毛雨', 57: '冻毛毛雨',
	61: '小雨', 63: '中雨', 65: '大雨',
	66: '冻雨', 67: '冻雨',
	71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒',
	80: '阵雨', 81: '阵雨', 82: '大阵雨',
	85: '阵雪', 86: '大阵雪',
	95: '雷暴', 96: '雷暴', 99: '雷暴',
};

export function getWeatherDescription(code: number): string {
	const lang = getLanguage();
	const desc = lang === 'zh'
		? WEATHER_DESC_ZH[code]
		: WEATHER_DESC_EN[code];
	return desc ?? 'Unknown';
}
