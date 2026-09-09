/**
 * Regression: doc-link paths containing `[` / `]` (z-library style names like
 * "…[美] R. A. Weinberg….pdf") must survive the full add → write → re-parse
 * loop. History: DOC_LINE_REGEX used to stop paths at any `]`, so the line
 * `- [[…[美]….pdf]]` failed to match on re-parse and the dragged book
 * vanished from the card after save (bug report 2026-08-29). The regex now
 * terminates only at `]]`.
 *
 * Covers:
 * 1. parse — bracketed paths land in card.docs with the full name intact.
 * 2. round-trip — serialize → parse keeps them (idempotent on 2nd pass too).
 * 3. the report's flow — append a bracketed doc to parsed data (what
 *    addDocToCard does in memory), write, re-parse: still there.
 * 4. nested + collapsed bracketed docs survive with tree shape and flag.
 * 5. guard rails — a `[[a]] [[b]]` line stays body text (never a doc), and
 *    plain paths are unaffected.
 *
 * Run: `npm run test:doc-bracket-paths`
 */
import { strict as assert } from 'node:assert';
import { parse, serialize } from '../src/parser';
import type { DashboardData, DocNode } from '../src/types';

const BRACKET_PDF =
	'癌生物学 (温伯格, 启敏·詹, 芝华·刘,[美] R. A. Weinberg) (z-library.sk, 1lib.sk, z-lib.sk)(OCR).pdf';
const PLAIN_PDF = '细胞的分子生物学 上 原书第4版文字版pdf.pdf';

const docPaths = (data: DashboardData): string[] => {
	const out: string[] = [];
	const walk = (nodes: DocNode[]) => {
		for (const n of nodes) {
			out.push(n.path);
			walk(n.children ?? []);
		}
	};
	walk(data.columns[0]?.cards[0]?.docs ?? []);
	return out;
};

const baseMd = [
	'---',
	'columns:',
	'  - name: Library',
	"    color: '#6366f1'",
	'    type: projects',
	'---',
	'',
	'## Library',
	'',
	'### 阅读',
	`- [[${PLAIN_PDF}]]`,
].join('\n');

// ---------- 1. parse ----------
const parsed = parse(baseMd);
assert.deepEqual(
	docPaths(parsed),
	[PLAIN_PDF],
	'plain doc path parses',
);

const bracketMd = baseMd + `\n- [[${BRACKET_PDF}]]`;
const bracketParsed = parse(bracketMd);
assert.deepEqual(
	docPaths(bracketParsed),
	[PLAIN_PDF, BRACKET_PDF],
	'bracketed path parses with the full name intact',
);

// ---------- 2. round-trip ----------
const once = parse(serialize(bracketParsed));
assert.deepEqual(
	docPaths(once),
	[PLAIN_PDF, BRACKET_PDF],
	'bracketed doc survives serialize -> parse',
);
const twice = parse(serialize(once));
assert.deepEqual(
	docPaths(twice),
	[PLAIN_PDF, BRACKET_PDF],
	'round-trip is stable on the second pass',
);

// ---------- 3. the report's flow: append in memory, write, reload ----------
const withDropped = parse(baseMd);
const card = withDropped.columns[0]!.cards[0]!;
card.docs = [...card.docs, { path: BRACKET_PDF }];
const reloaded = parse(serialize(withDropped));
assert.ok(
	docPaths(reloaded).includes(BRACKET_PDF),
	'doc added in memory survives write -> re-parse (the disappearing-book bug)',
);

// ---------- 4. nested + collapsed ----------
const nestedMd = baseMd + '\n' + [
	`- [[父目录/[英] Guide.pdf]] <!--collapsed-->`,
	`    - [[${BRACKET_PDF}]]`,
].join('\n');
const nested = parse(nestedMd);
const rootDocs = nested.columns[0]!.cards[0]!.docs;
const parent = rootDocs.find(d => d.path.includes('Guide'));
assert.ok(parent, 'nested parent doc with brackets parses');
assert.equal(parent!.collapsed, true, 'collapsed flag parses');
assert.deepEqual(
	(parent!.children ?? []).map(d => d.path),
	[BRACKET_PDF],
	'bracketed child nests under its parent',
);

// ---------- 5. guard rails ----------
const doubleLinkMd = baseMd + '\n- [[a]] [[b]]';
const doubleLink = parse(doubleLinkMd);
assert.ok(
	!docPaths(doubleLink).some(p => p === 'a' || p === 'b'),
	'one-line double wikilink never becomes a doc',
);
assert.deepEqual(
	docPaths(parse(serialize(parsed))),
	[PLAIN_PDF],
	'plain doc path unaffected by the regex change',
);

console.log('doc bracket paths: ALL PASS');
