import { strict as assert } from 'node:assert';
import { translationKeys, translationEntry, resolveLanguage, setLanguage, getLocale, LANGUAGE_OPTIONS, t, type Language } from '../src/i18n';
import { monthDayLabel, monthLabels, weekdayLabels } from '../src/locale-format';

/**
 * i18n integrity: every language covers the full key set, values are
 * non-empty, and every {placeholder} in the English source survives into
 * each translation (a missing token renders a literal "{n}" in the UI).
 *
 * English is the reference key set (t() falls back to it); all other
 * dictionaries must never drift behind.
 */

const LANGS: Language[] = ['zh', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'th'];
const enKeys = translationKeys('en');

assert.ok(enKeys.length > 1000, `en dictionary suspiciously small: ${enKeys.length} keys`);

const PLACEHOLDER = /\{(\w+)\}/g;
let placeholdersChecked = 0;

for (const lang of LANGS) {
	const keys = new Set(translationKeys(lang));
	const missing = enKeys.filter(key => !keys.has(key));
	assert.deepStrictEqual(missing, [], `${lang}: ${missing.length} keys missing vs en (first: ${missing[0] ?? '-'})`);
	const extra = [...keys].filter(key => !enKeys.includes(key));
	assert.deepStrictEqual(extra, [], `${lang}: ${extra.length} unexpected keys vs en (first: ${extra[0] ?? '-'})`);
	assert.equal((translationEntry(lang, 'calendar.weekdays') ?? '').split(',').length, 7, `${lang}: calendar weekdays must be comma-separated`);
	assert.equal((translationEntry(lang, 'calendar.months') ?? '').split(',').length, 12, `${lang}: calendar months must be comma-separated`);

	for (const key of enKeys) {
		const en = translationEntry('en', key) ?? '';
		const value = translationEntry(lang, key);
		// Empty is legal ONLY where the en source is empty too (the
		// announce.* per-release optional-copy convention).
		assert.ok(typeof value === 'string' && (value.length > 0 || en.length === 0), `${lang} ${key}: empty value`);
		const expected = [...en.matchAll(PLACEHOLDER)].map(m => m[1]!);
		for (const token of expected) {
			assert.ok(
				value.includes(`{${token}}`),
				`${lang} ${key}: placeholder {${token}} lost — "${value}"`,
			);
			placeholdersChecked++;
		}
	}
	console.log(`${lang}: ${keys.size} keys, all present, placeholders intact`);
}

assert.deepStrictEqual(LANGUAGE_OPTIONS.map(option => option.value), ['system', 'en', 'zh', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'th']);
assert.equal(resolveLanguage('system', 'ja'), 'ja');
assert.equal(resolveLanguage('system', 'ko'), 'ko');
assert.equal(resolveLanguage('system', 'es-MX'), 'es');
assert.equal(resolveLanguage('system', 'fr-CA'), 'fr');
assert.equal(resolveLanguage('system', 'de-AT'), 'de');
assert.equal(resolveLanguage('system', 'pt-BR'), 'pt-BR');
assert.equal(resolveLanguage('system', 'ru'), 'ru');
assert.equal(resolveLanguage('system', 'th-TH'), 'th');
assert.equal(resolveLanguage('system', 'zh-Hant'), 'zh-TW');
assert.equal(resolveLanguage('system', 'zh-CN'), 'zh');
assert.equal(resolveLanguage('system', 'it'), 'en');
assert.equal(resolveLanguage('zh', 'ja'), 'zh');
setLanguage('ja');
assert.equal(getLocale(), 'ja-JP');
assert.equal(weekdayLabels().length, 7);
assert.equal(monthLabels().length, 12);
assert.match(monthDayLabel(new Date(2024, 7, 24)), /8月24日/);
setLanguage('ko');
assert.equal(getLocale(), 'ko-KR');
assert.match(monthDayLabel(new Date(2024, 7, 24)), /8월/);
setLanguage('es');
assert.equal(getLocale(), 'es-ES');
assert.match(monthDayLabel(new Date(2024, 7, 24)), /24/);
setLanguage('pt-BR');
assert.equal(getLocale(), 'pt-BR');
assert.match(monthDayLabel(new Date(2024, 7, 24)), /24/);
setLanguage('th');
assert.equal(getLocale(), 'th-TH');
setLanguage('zh');
assert.equal(weekdayLabels()[0], '日');
assert.equal(t('common.open', { name: '示例' }).includes('{name}'), false);

console.log(`verify-i18n: OK (${enKeys.length} en keys, ${LANGS.length} locales, ${placeholdersChecked} placeholders checked)`);
