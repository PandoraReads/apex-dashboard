import { strict as assert } from 'node:assert';
import { mapMetNoCode } from '../src/weather-service';

// Every base symbol from Met.no's official weathericon 2.0 legend
// (github.com/metno/weathericons, weather/legend.csv), the WMO code it must
// map to, and whether the API suffixes it with _day/_night/_polartwilight.
const LEGEND: ReadonlyArray<readonly [string, number, boolean]> = [
	['clearsky', 0, true],
	['fair', 1, true],
	['partlycloudy', 2, true],
	['cloudy', 3, false],
	['lightrainshowers', 80, true],
	['rainshowers', 81, true],
	['heavyrainshowers', 82, true],
	['lightrainshowersandthunder', 95, true],
	['rainshowersandthunder', 95, true],
	['heavyrainshowersandthunder', 95, true],
	['lightsleetshowers', 85, true],
	['sleetshowers', 85, true],
	['heavysleetshowers', 86, true],
	['lightssleetshowersandthunder', 95, true],
	['sleetshowersandthunder', 95, true],
	['heavysleetshowersandthunder', 95, true],
	['lightsnowshowers', 85, true],
	['snowshowers', 86, true],
	['heavysnowshowers', 86, true],
	['lightssnowshowersandthunder', 95, true],
	['snowshowersandthunder', 95, true],
	['heavysnowshowersandthunder', 95, true],
	['lightrain', 61, false],
	['rain', 63, false],
	['heavyrain', 65, false],
	['lightrainandthunder', 95, false],
	['rainandthunder', 95, false],
	['heavyrainandthunder', 95, false],
	['lightsleet', 66, false],
	['sleet', 67, false],
	['heavysleet', 67, false],
	['lightsleetandthunder', 95, false],
	['sleetandthunder', 95, false],
	['heavysleetandthunder', 95, false],
	['lightsnow', 71, false],
	['snow', 73, false],
	['heavysnow', 75, false],
	['lightsnowandthunder', 95, false],
	['snowandthunder', 95, false],
	['heavysnowandthunder', 95, false],
	['fog', 45, false],
];

const SUFFIXES = ['', '_day', '_night', '_polartwilight'] as const;

let checked = 0;
for (const [symbol, wmo, hasVariants] of LEGEND) {
	for (const suffix of hasVariants ? SUFFIXES : ['']) {
		assert.equal(mapMetNoCode(symbol + suffix), wmo, `legend: ${symbol}${suffix}`);
		checked++;
	}
}

// Regression cases from the reported bug: these all read "阴" (overcast)
// before the table was completed.
assert.equal(mapMetNoCode('rainshowers_day'), 81);
assert.equal(mapMetNoCode('clearsky_polartwilight'), 0);
assert.equal(mapMetNoCode('partlycloudy_polartwilight'), 2);
assert.equal(mapMetNoCode('rainshowersandthunder_day'), 95);
assert.equal(mapMetNoCode('heavyrainshowersandthunder_night'), 95);
assert.equal(mapMetNoCode('rainandthunder'), 95);
assert.equal(mapMetNoCode('lightrainandthunder_polartwilight'), 95);
assert.equal(mapMetNoCode('heavysleet'), 67);
assert.equal(mapMetNoCode('heavysnowshowers_day'), 86);

// Legacy double-s spellings for the light-shower families.
assert.equal(mapMetNoCode('lightssleetshowers'), 85);
assert.equal(mapMetNoCode('lightssleetshowers_day'), 85);
assert.equal(mapMetNoCode('lightssnowshowers_night'), 85);

// Standalone thunderstorm (not in legend.csv but seen from the API).
assert.equal(mapMetNoCode('thunderstorm'), 95);

// Unknown symbols degrade via suffix stripping + keyword, not flat overcast.
assert.equal(mapMetNoCode('graupelandthunder_day'), 95);
assert.equal(mapMetNoCode('unknownsnowthing'), 73);
assert.equal(mapMetNoCode('mysteryrain_night'), 63);
assert.equal(mapMetNoCode('weirdfogstuff_polartwilight'), 45);
assert.equal(mapMetNoCode('clearskyish_day'), 3);
assert.equal(mapMetNoCode(''), 3);

console.log(`verify-weather-mapping: ${checked} legend symbols + regression and fallback cases OK`);
