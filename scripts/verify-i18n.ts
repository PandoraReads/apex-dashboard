import { strict as assert } from 'node:assert';
import { translationKeys, translationEntry, type Language } from '../src/i18n';

/**
 * i18n integrity: every language covers the full key set, values are
 * non-empty, and every {placeholder} in the English source survives into
 * each translation (a missing token renders a literal "{n}" in the UI).
 *
 * English is the reference key set (t() falls back to it); zh and zh-TW are
 * generated/maintained dictionaries that must never drift behind.
 */

const LANGS: Language[] = ['zh', 'zh-TW'];
const enKeys = translationKeys('en');

assert.ok(enKeys.length > 1000, `en dictionary suspiciously small: ${enKeys.length} keys`);

const PLACEHOLDER = /\{(\w+)\}/g;
let placeholdersChecked = 0;

for (const lang of LANGS) {
	const keys = new Set(translationKeys(lang));
	const missing = enKeys.filter(key => !keys.has(key));
	assert.deepStrictEqual(missing, [], `${lang}: ${missing.length} keys missing vs en (first: ${missing[0] ?? '-'})`);

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

console.log(`verify-i18n: OK (${enKeys.length} en keys, ${LANGS.length} locales, ${placeholdersChecked} placeholders checked)`);
