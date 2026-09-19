import type DashboardPlugin from './main';
import { t } from './i18n';

/** Direction of a bookkeeping entry. */
export type ExpenseType = 'expense' | 'income';

/** One expense/income entry owned by the user. */
export interface ExpenseRecord {
	id: string;
	type: ExpenseType;
	/** Positive amount, rounded to 2 decimals on insert. */
	amount: number;
	/** Preset category key (see EXPENSE_CATEGORIES / INCOME_CATEGORIES). */
	category: string;
	/** Optional user note, at most EXPENSE_MAX_NOTE_LENGTH chars. */
	note?: string;
	/** 'YYYY-MM-DD', local time; may be a past date (backfill). */
	date: string;
	/** Epoch ms, ordering tiebreak within one day. */
	createdAt: number;
}

/** v1 data layout, stored at .obsidian/plugins/apex-dashboard/expense.json. */
export interface ExpenseData {
	version: 1;
	/** Append-ordered; never pruned (financial history spans years). */
	records: ExpenseRecord[];
	/** Last category picked per type, so the widget's selects reopen on it. */
	lastCategory: { expense?: string; income?: string };
	/** User-added category names per direction (absent in pre-1.9.6 files). */
	customCategories?: { expense?: string[]; income?: string[] };
	/** Full display order per direction (preset keys + custom names mixed).
	 *  Absent in files that never reordered; missing categories fall back to
	 *  default order at read time (getOrderedCategories), never on save. */
	categoryOrder?: { expense?: string[]; income?: string[] };
	/** Ordered primary-group names per direction (grouping layer above the
	 *  flat categories; records never store the primary, only the mapping). */
	primaryCategories?: { expense?: string[]; income?: string[] };
	/** Secondary category key/name -> primary-group name, per direction. */
	categoryParents?: { expense?: Record<string, string>; income?: Record<string, string> };
}

export const DATA_FILE = 'expense.json';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Shared with the widget so its validation matches the service. */
export const EXPENSE_MAX_NOTE_LENGTH = 50;
const MAX_NOTE_LENGTH = EXPENSE_MAX_NOTE_LENGTH;
/** Sanity ceiling for a single entry (in currency units). */
const MAX_AMOUNT = 1e8;

/** Preset top-level expense categories (keys are stable i18n lookups). */
export const EXPENSE_CATEGORIES = [
	'food', 'transport', 'shopping', 'housing', 'utilities',
	'entertainment', 'medical', 'education', 'social', 'other',
] as const;

/** Preset top-level income categories. */
export const INCOME_CATEGORIES = [
	'salary', 'bonus', 'investment', 'sideJob', 'gift', 'other',
] as const;

/** The preset category keys for a direction. */
export function categoriesFor(type: ExpenseType): readonly string[] {
	return type === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
}

/** Custom-category guards shared with the manager UI. */
export const EXPENSE_CATEGORY_NAME_MAX = 12;
export const EXPENSE_MAX_CUSTOM_CATEGORIES = 30;
/** Cap on primary groups per direction (kept far below the 30 customs cap —
 *  primaries are coarse buckets, not fine-grained categories). */
export const EXPENSE_MAX_PRIMARY_CATEGORIES = 10;
/** Breakdown bucket key for categories without a primary group; also the
 *  ledger primary-filter sentinel. Never a real name (double underscores). */
export const UNGROUPED_PRIMARY = '__ungrouped__';

/** Outcome of addCustomCategory — callers map `reason` to a Notice. */
export type AddCategoryResult =
	| { ok: true; name: string }
	| { ok: false; reason: 'invalid' | 'duplicate' | 'limit' };

/** True when a candidate custom name would shadow a preset key or the
 *  preset's localized label (case-insensitive), which would make records
 *  written with it indistinguishable from preset entries. */
function collidesWithPreset(name: string, type: ExpenseType): boolean {
	const lower = name.toLowerCase();
	return categoriesFor(type).some(key =>
		key.toLowerCase() === lower || t(`expense.cat.${key}`).toLowerCase() === lower);
}

function isExpenseType(value: unknown): value is ExpenseType {
	return value === 'expense' || value === 'income';
}

function emptyData(): ExpenseData {
	return { version: 1, records: [], lastCategory: {} };
}

/** Round to 2 decimals (insert-time and display-time float guard). */
function round2(n: number): number {
	return Math.round(n * 100) / 100;
}

/** Compact amount display: '25' / '25.5' / '25.05' — trailing zero trimmed,
 *  never a bare integer followed by a dot (shared by widget + stats). */
export function formatExpenseAmount(n: number): string {
	const v = round2(n);
	if (Number.isInteger(v)) return String(v);
	return v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/** Amount-field sanitizer shared by the widget rows and the backfill modal:
 *  keep only digits and at most one dot with 2 decimals, so pasting
 *  "¥25，5" lands as "25.5" without ever rejecting the keystroke. */
export function sanitizeAmountInput(raw: string): string {
	const cleaned = raw.replace(/[^0-9.]/g, '');
	const dot = cleaned.indexOf('.');
	if (dot === -1) return cleaned;
	const int = cleaned.slice(0, dot);
	const frac = cleaned.slice(dot + 1).replace(/\./g, '').slice(0, 2);
	return `${int}.${frac}`;
}

/** Union of two datasets, `session` winning per-record-id conflicts. Used when
 *  a load that failed at startup succeeds on a later retry: the disk copy and
 *  everything changed in-session are merged so neither side is lost. */
function mergeData(disk: ExpenseData, session: ExpenseData): ExpenseData {
	const byId = new Map(disk.records.map(r => [r.id, r] as const));
	for (const r of session.records) byId.set(r.id, r);
	const records = [...byId.values()].sort((a, b) =>
		a.date === b.date ? a.createdAt - b.createdAt : (a.date < b.date ? -1 : 1));
	const customCategories = mergeCustomCategories(disk.customCategories, session.customCategories);
	const categoryOrder = mergeCategoryOrder(disk.categoryOrder, session.categoryOrder);
	const primaryCategories = mergePrimaryCategories(disk.primaryCategories, session.primaryCategories);
	const categoryParents = mergeCategoryParents(disk.categoryParents, session.categoryParents, primaryCategories);
	return {
		version: 1,
		records,
		lastCategory: { ...disk.lastCategory, ...session.lastCategory },
		...(customCategories ? { customCategories } : {}),
		...(categoryOrder ? { categoryOrder } : {}),
		...(primaryCategories ? { primaryCategories } : {}),
		...(categoryParents ? { categoryParents } : {}),
	};
}

/** Union of per-type custom category lists (disk order first, case-insensitive
 *  dedupe); undefined when both sides carry nothing. */
function mergeCustomCategories(
	disk: ExpenseData['customCategories'],
	session: ExpenseData['customCategories'],
): ExpenseData['customCategories'] {
	const out: { expense?: string[]; income?: string[] } = {};
	for (const type of ['expense', 'income'] as const) {
		const names: string[] = [];
		const seen = new Set<string>();
		for (const name of [...(disk?.[type] ?? []), ...(session?.[type] ?? [])]) {
			const key = name.toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			names.push(name);
		}
		if (names.length > 0) out[type] = names.slice(0, EXPENSE_MAX_CUSTOM_CATEGORIES);
	}
	return out.expense === undefined && out.income === undefined ? undefined : out;
}

// The three merges below are SESSION-FIRST, unlike mergeCustomCategories'
// disk-first union. Reason: persist() merges whenever the disk content
// differs from our last write — including when the only external change is
// another device adding one record. A disk-first order would then put the
// stale on-disk order ahead of a reorder this session just made, silently
// reverting it. Session-first keeps local intent; disk contributes only
// entries the session never touched.

/** Session-first union of per-type order lists (exact-match dedupe — keys
 *  are exact category identifiers, not display names). */
function mergeCategoryOrder(
	disk: ExpenseData['categoryOrder'],
	session: ExpenseData['categoryOrder'],
): ExpenseData['categoryOrder'] {
	const out: { expense?: string[]; income?: string[] } = {};
	for (const type of ['expense', 'income'] as const) {
		const keys: string[] = [];
		for (const v of [...(session?.[type] ?? []), ...(disk?.[type] ?? [])]) {
			if (keys.includes(v)) continue;
			keys.push(v);
		}
		if (keys.length > 0) out[type] = keys;
	}
	return out.expense === undefined && out.income === undefined ? undefined : out;
}

/** Session-first union of per-type primary-group lists (case-insensitive
 *  dedupe; session's casing wins a clash). */
function mergePrimaryCategories(
	disk: ExpenseData['primaryCategories'],
	session: ExpenseData['primaryCategories'],
): ExpenseData['primaryCategories'] {
	const out: { expense?: string[]; income?: string[] } = {};
	for (const type of ['expense', 'income'] as const) {
		const names: string[] = [];
		const seen = new Set<string>();
		for (const v of [...(session?.[type] ?? []), ...(disk?.[type] ?? [])]) {
			const key = v.toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			names.push(v);
		}
		if (names.length > 0) out[type] = names.slice(0, EXPENSE_MAX_PRIMARY_CATEGORIES);
	}
	return out.expense === undefined && out.income === undefined ? undefined : out;
}

/** Per-key merge of parent mappings (session wins each key — same semantics
 *  as records), then dangling values whose primary vanished on either side
 *  are dropped. */
function mergeCategoryParents(
	disk: ExpenseData['categoryParents'],
	session: ExpenseData['categoryParents'],
	primaries: ExpenseData['primaryCategories'],
): ExpenseData['categoryParents'] {
	const out: { expense?: Record<string, string>; income?: Record<string, string> } = {};
	for (const type of ['expense', 'income'] as const) {
		const merged = { ...(disk?.[type] ?? {}), ...(session?.[type] ?? {}) };
		const known = new Set(primaries?.[type] ?? []);
		const clean = Object.fromEntries(
			Object.entries(merged).filter(([, primary]) => known.has(primary)));
		if (Object.keys(clean).length > 0) out[type] = clean;
	}
	return out.expense === undefined && out.income === undefined ? undefined : out;
}

/** Normalize a parsed expense.json: keep only well-formed records so a
 *  hand-edited or corrupted file degrades to partial data. */
function normalizeData(raw: unknown): ExpenseData {
	if (!raw || typeof raw !== 'object') return emptyData();
	const obj = raw as Partial<ExpenseData>;
	const records = Array.isArray(obj.records)
		? obj.records.filter((r): r is ExpenseRecord =>
			!!r && typeof r === 'object'
			&& typeof r.id === 'string' && r.id.length > 0
			&& isExpenseType(r.type)
			&& typeof r.amount === 'number' && Number.isFinite(r.amount) && r.amount > 0
			&& typeof r.category === 'string' && r.category.length > 0
			&& typeof r.date === 'string' && DATE_RE.test(r.date)
			&& typeof r.createdAt === 'number' && Number.isFinite(r.createdAt))
			.map(r => ({ ...r, amount: round2(r.amount) }))
		: [];
	const lastCategory: { expense?: string; income?: string } = {};
	const lc = obj.lastCategory;
	if (lc && typeof lc === 'object') {
		if (typeof lc.expense === 'string' && lc.expense.length > 0) lastCategory.expense = lc.expense;
		if (typeof lc.income === 'string' && lc.income.length > 0) lastCategory.income = lc.income;
	}
	const customCategories = normalizeCustomCategories(obj.customCategories);
	const categoryOrder = normalizeCategoryOrder(obj.categoryOrder, customCategories);
	const primaryCategories = normalizePrimaryCategories(obj.primaryCategories);
	const categoryParents = normalizeCategoryParents(obj.categoryParents, customCategories, primaryCategories);
	return {
		version: 1,
		records,
		lastCategory,
		...(customCategories ? { customCategories } : {}),
		...(categoryOrder ? { categoryOrder } : {}),
		...(primaryCategories ? { primaryCategories } : {}),
		...(categoryParents ? { categoryParents } : {}),
	};
}

/** Keep only usable custom category names per type: non-empty trimmed strings
 *  that don't shadow a preset key, deduped case-insensitively and capped. A
 *  hand-edited file degrades to partial data instead of failing the load. */
function normalizeCustomCategories(raw: unknown): ExpenseData['customCategories'] {
	if (!raw || typeof raw !== 'object') return undefined;
	const out: { expense?: string[]; income?: string[] } = {};
	for (const type of ['expense', 'income'] as const) {
		const list = (raw as Record<string, unknown>)[type];
		if (!Array.isArray(list)) continue;
		const names: string[] = [];
		const seen = new Set<string>();
		for (const v of list) {
			if (typeof v !== 'string') continue;
			const name = v.trim().slice(0, EXPENSE_CATEGORY_NAME_MAX);
			if (name.length === 0 || collidesWithPreset(name, type)) continue;
			const key = name.toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			names.push(name);
		}
		if (names.length > 0) out[type] = names.slice(0, EXPENSE_MAX_CUSTOM_CATEGORIES);
	}
	return out.expense === undefined && out.income === undefined ? undefined : out;
}

/** Keep only order entries that are known categories for the direction,
 *  deduped. Missing categories are deliberately NOT appended here — a legacy
 *  file must not grow the field on its next save; lenient completion happens
 *  at read time (getOrderedCategories) and never persists. */
function normalizeCategoryOrder(
	raw: unknown,
	custom: ExpenseData['customCategories'],
): ExpenseData['categoryOrder'] {
	if (!raw || typeof raw !== 'object') return undefined;
	const out: { expense?: string[]; income?: string[] } = {};
	for (const type of ['expense', 'income'] as const) {
		const list = (raw as Record<string, unknown>)[type];
		if (!Array.isArray(list)) continue;
		const known = new Set<string>([...categoriesFor(type), ...(custom?.[type] ?? [])]);
		const keys: string[] = [];
		for (const v of list) {
			if (typeof v !== 'string' || !known.has(v) || keys.includes(v)) continue;
			keys.push(v);
		}
		if (keys.length > 0) out[type] = keys;
	}
	return out.expense === undefined && out.income === undefined ? undefined : out;
}

/** Keep only usable primary-group names per type: non-empty trimmed strings,
 *  deduped case-insensitively and capped. Deliberately no preset-collision
 *  filter — that guard belongs to the write path (addPrimaryCategory); a
 *  hand-edited file keeps what it says rather than silently reverting. */
function normalizePrimaryCategories(raw: unknown): ExpenseData['primaryCategories'] {
	if (!raw || typeof raw !== 'object') return undefined;
	const out: { expense?: string[]; income?: string[] } = {};
	for (const type of ['expense', 'income'] as const) {
		const list = (raw as Record<string, unknown>)[type];
		if (!Array.isArray(list)) continue;
		const names: string[] = [];
		const seen = new Set<string>();
		for (const v of list) {
			if (typeof v !== 'string') continue;
			const name = v.trim().slice(0, EXPENSE_CATEGORY_NAME_MAX);
			if (name.length === 0) continue;
			const key = name.toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			names.push(name);
		}
		if (names.length > 0) out[type] = names.slice(0, EXPENSE_MAX_PRIMARY_CATEGORIES);
	}
	return out.expense === undefined && out.income === undefined ? undefined : out;
}

/** Keep only parent mappings whose category is known for the direction and
 *  whose primary exists after normalization; dangling entries drop out. */
function normalizeCategoryParents(
	raw: unknown,
	custom: ExpenseData['customCategories'],
	primaries: ExpenseData['primaryCategories'],
): ExpenseData['categoryParents'] {
	if (!raw || typeof raw !== 'object') return undefined;
	const out: { expense?: Record<string, string>; income?: Record<string, string> } = {};
	for (const type of ['expense', 'income'] as const) {
		const map = (raw as Record<string, unknown>)[type];
		if (!map || typeof map !== 'object') continue;
		const knownCats = new Set<string>([...categoriesFor(type), ...(custom?.[type] ?? [])]);
		const knownPrimaries = primaries?.[type] ?? [];
		const clean: Record<string, string> = {};
		for (const [cat, primary] of Object.entries(map)) {
			if (typeof primary !== 'string') continue;
			const name = primary.trim();
			if (!knownCats.has(cat) || !knownPrimaries.includes(name)) continue;
			clean[cat] = name;
		}
		if (Object.keys(clean).length > 0) out[type] = clean;
	}
	return out.expense === undefined && out.income === undefined ? undefined : out;
}

function formatDate(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

/** Local-time 'YYYY-MM-DD' for today (shared by the widget and stats modal). */
export function expenseToday(): string {
	return formatDate(new Date());
}

function makeRecordId(): string {
	return `ex-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// ===== Module-level singleton (media-tags pattern) =====
// Render layers without a view/plugin reference (widget refresh, stats
// overlay) fetch the live service from here; the plugin registers it at
// onload and clears it at unload.

let activeService: ExpenseService | null = null;

export function registerExpenseService(service: ExpenseService | null): void {
	activeService = service;
}

export function getExpenseService(): ExpenseService | null {
	return activeService;
}

/**
 * Expense/income bookkeeping service. Entries persist as a standalone JSON
 * file (habits.json pattern); all mutations go through this service so every
 * consumer (sidebar widget, stats overlay) reads one shared dataset via
 * subscribe(). Records are never pruned — the stats history view needs every
 * past year.
 */
export class ExpenseService {
	private data: ExpenseData = emptyData();
	private loaded = false;
	private loadFailed = false;
	/** Raw file content of this instance's last successful write; a disk read
	 *  that differs means an external writer (sync / another device)
	 *  intervened and the next write must merge instead of clobber. */
	private lastWritten: string | null = null;
	private syncInFlight = false;
	private listeners = new Set<() => void>();

	private focusDoc: Document | null = null;
	private focusHandler = (): void => {
		if (this.focusDoc?.visibilityState === 'visible') void this.syncFromDisk();
	};

	constructor(private plugin: DashboardPlugin) {
		// Data files only ever load at startup; without re-reading, a session
		// open all day never sees another device's records and its next save
		// clobbers them. On focus (window switch / mobile foreground)
		// re-read and union. Listener is per-service (not plugin-lifetime):
		// pomodoro/reading instances live and die with their view.
		this.focusDoc = activeDocument;
		this.focusDoc.addEventListener('visibilitychange', this.focusHandler);
	}

	async load(): Promise<void> {
		if (this.loaded) return;
		this.loaded = true;
		try {
			const adapter = this.plugin.app.vault.adapter;
			const path = `${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}/${DATA_FILE}`;
			if (await adapter.exists(path)) {
				const raw = await adapter.read(path);
				this.data = normalizeData(JSON.parse(raw));
				this.lastWritten = raw;
			}
		} catch (error) {
			// Distinguish the two failure kinds: a JSON parse error means the
			// file is unusable (start fresh); an adapter/IO error (mobile file
			// lock, iCloud not yet downloaded) leaves the on-disk file intact —
			// flag it so the next save cannot overwrite it with the empty state.
			this.data = emptyData();
			this.loadFailed = !(error instanceof SyntaxError);
		}
	}

	/** Serialized write queue — at most one write is ever in flight. Content
	 *  serializes at execution time, so a write delayed behind earlier ones
	 *  still persists the freshest state (see habits.json race notes). */
	private saveQueue: Promise<void> = Promise.resolve();

	private save(): void {
		this.saveQueue = this.saveQueue.then(() => this.persist());
	}

	private async persist(): Promise<void> {
		// A non-parse load failure must not brick persistence for the whole
		// session; re-attempt the read and merge before deciding to skip.
		if (this.loadFailed && !(await this.retryFailedLoad())) return;
		try {
			const adapter = this.plugin.app.vault.adapter;
			const dir = `${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}`;
			const path = `${dir}/${DATA_FILE}`;
			if (!(await adapter.exists(dir))) {
				await adapter.mkdir(dir);
			}
			// Merge the disk state first when someone else wrote since our
			// last write — blind full-file saves revert the other device's
			// entries. Deletions stay deleted: without an external change the
			// union never runs, so removed records are not resurrected.
			try {
				if (await adapter.exists(path)) {
					const raw = await adapter.read(path);
					if (raw !== this.lastWritten) {
						this.data = mergeData(normalizeData(JSON.parse(raw)), this.data);
					}
				}
			} catch {
				// Disk unreadable at save time: write our state as before.
			}
			const json = JSON.stringify(this.data);
			await adapter.write(path, json);
			this.lastWritten = json;
		} catch {
			// silent fail: an unwriteable expense.json must not break entries in-session
		}
	}

	/** Re-attempt the initial read after a non-parse load failure. On success
	 *  the disk state merges with the in-session state (union by record id);
	 *  while the file is still unreadable saving stays skipped rather than
	 *  clobbering a file we cannot see. */
	private async retryFailedLoad(): Promise<boolean> {
		try {
			const adapter = this.plugin.app.vault.adapter;
			const path = `${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}/${DATA_FILE}`;
			let disk = emptyData();
			if (await adapter.exists(path)) {
				const raw = await adapter.read(path);
				disk = normalizeData(JSON.parse(raw));
				this.lastWritten = raw;
			}
			this.data = mergeData(disk, this.data);
			this.loadFailed = false;
			// The merge may resurrect records the UI has not seen yet.
			this.notify();
			return true;
		} catch (error) {
			this.loadFailed = !(error instanceof SyntaxError);
			return !this.loadFailed;
		}
	}

	/** Re-read the file and union external changes into memory (another
	 *  device's entries arriving via sync). Notifies listeners when the merge
	 *  changed anything, and writes the union back so a lagging device heals
	 *  on its next focus. */
	async syncFromDisk(): Promise<void> {
		if (!this.loaded || this.syncInFlight) return;
		this.syncInFlight = true;
		try {
			const adapter = this.plugin.app.vault.adapter;
			const path = `${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}/${DATA_FILE}`;
			if (!(await adapter.exists(path))) return;
			const raw = await adapter.read(path);
			if (raw === this.lastWritten) return;
			this.data = mergeData(normalizeData(JSON.parse(raw)), this.data);
			this.notify();
			this.save();
		} catch {
			// Transient read error (file mid-sync): the next focus retries.
		} finally {
			this.syncInFlight = false;
		}
	}

	/** Register a data-changed listener; returns its unsubscribe function. */
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	destroy(): void {
		this.listeners.clear();
		this.focusDoc?.removeEventListener('visibilitychange', this.focusHandler);
		this.focusDoc = null;
	}

	private notify(): void {
		for (const listener of [...this.listeners]) {
			listener();
		}
	}

	// ===== Record CRUD =====

	/** All records, append order (shared copy). */
	getRecords(): ExpenseRecord[] {
		return [...this.data.records];
	}

	/** Entry validation shared by addRecord / updateRecord / importRows:
	 *  amount finite in (0, 1e8), category known for the type, date a valid
	 *  past-or-today 'YYYY-MM-DD'. */
	private isValidEntry(type: ExpenseType, amount: number, category: string, date: string): boolean {
		if (!Number.isFinite(amount) || amount <= 0 || amount >= MAX_AMOUNT) return false;
		if (!this.getCategories(type).includes(category)) return false;
		if (!DATE_RE.test(date) || date > expenseToday()) return false;
		return true;
	}

	/** Add an entry; null when validation fails (caller surfaces a Notice). */
	addRecord(input: { type: ExpenseType; amount: number; category: string; note?: string; date: string }): ExpenseRecord | null {
		const { type, category, date } = input;
		const amount = round2(input.amount);
		if (!this.isValidEntry(type, amount, category, date)) return null;
		const note = input.note?.trim().slice(0, MAX_NOTE_LENGTH);
		const record: ExpenseRecord = {
			id: makeRecordId(),
			type,
			amount,
			category,
			...(note ? { note } : {}),
			date,
			createdAt: Date.now(),
		};
		this.data = {
			...this.data,
			records: [...this.data.records, record],
			lastCategory: { ...this.data.lastCategory, [type]: category },
		};
		this.save();
		this.notify();
		return record;
	}

	/** Patch an existing record (any mutable field); null when the id is
	 *  unknown or the merged entry fails validation. id/createdAt never move. */
	updateRecord(id: string, patch: { type?: ExpenseType; amount?: number; category?: string; note?: string; date?: string }): ExpenseRecord | null {
		const base = this.data.records.find(r => r.id === id);
		if (!base) return null;
		const type = patch.type ?? base.type;
		const amount = round2(patch.amount ?? base.amount);
		const category = patch.category ?? base.category;
		const date = patch.date ?? base.date;
		if (!this.isValidEntry(type, amount, category, date)) return null;
		const note = (patch.note !== undefined ? patch.note : base.note)?.trim().slice(0, MAX_NOTE_LENGTH);
		const { note: _dropped, ...rest } = base;
		const updated: ExpenseRecord = {
			...rest,
			type,
			amount,
			category,
			date,
			...(note ? { note } : {}),
		};
		this.data = {
			...this.data,
			records: this.data.records.map(r => (r.id === id ? updated : r)),
			lastCategory: { ...this.data.lastCategory, [type]: category },
		};
		this.save();
		this.notify();
		return updated;
	}

	/** Delete a record by id; true when it existed. */
	deleteRecord(id: string): boolean {
		if (!this.data.records.some(r => r.id === id)) return false;
		this.data = { ...this.data, records: this.data.records.filter(r => r.id !== id) };
		this.save();
		this.notify();
		return true;
	}

	/** Bulk delete by ids (one immutable update, one save + notify); returns
	 *  how many actually existed. */
	deleteRecords(ids: readonly string[]): number {
		const doomed = new Set(ids);
		const before = this.data.records.length;
		const records = this.data.records.filter(r => !doomed.has(r.id));
		if (records.length === before) return 0;
		this.data = { ...this.data, records };
		this.save();
		this.notify();
		return before - records.length;
	}

	/** Bulk insert for CSV import: each row is validated like addRecord,
	 *  invalid rows are skipped; single save + notify. */
	importRows(rows: Array<{ type: ExpenseType; amount: number; category: string; note?: string; date: string }>): { added: number; skipped: number } {
		const valid: ExpenseRecord[] = [];
		for (const input of rows) {
			const { type, category, date } = input;
			const amount = round2(input.amount);
			if (!this.isValidEntry(type, amount, category, date)) continue;
			const note = input.note?.trim().slice(0, MAX_NOTE_LENGTH);
			valid.push({
				id: makeRecordId(),
				type,
				amount,
				category,
				...(note ? { note } : {}),
				date,
				createdAt: Date.now(),
			});
		}
		if (valid.length > 0) {
			this.data = { ...this.data, records: [...this.data.records, ...valid] };
			this.save();
			this.notify();
		}
		return { added: valid.length, skipped: rows.length - valid.length };
	}

	// ===== Custom categories =====

	/** Preset keys followed by the user's custom names for a direction. */
	getCategories(type: ExpenseType): string[] {
		return [...categoriesFor(type), ...(this.data.customCategories?.[type] ?? [])];
	}

	/** Custom names only (shared copy). */
	getCustomCategories(type: ExpenseType): string[] {
		return [...(this.data.customCategories?.[type] ?? [])];
	}

	/** Records using a category key (usage count in the manager). */
	countCategoryUsage(type: ExpenseType, category: string): number {
		return this.data.records.filter(r => r.type === type && r.category === category).length;
	}

	/** All categories of a direction in the user's display order: stored
	 *  order entries first (unknown/duplicate entries skipped), then any
	 *  categories the order never mentions in default order. Never persists
	 *  the completion — untouched legacy files stay untouched. */
	getOrderedCategories(type: ExpenseType): string[] {
		const known = this.getCategories(type);
		const order = this.data.categoryOrder?.[type];
		if (!order) return known;
		const seen = new Set<string>();
		const head: string[] = [];
		for (const key of order) {
			if (!known.includes(key) || seen.has(key)) continue;
			seen.add(key);
			head.push(key);
		}
		return [...head, ...known.filter(k => !seen.has(k))];
	}

	/** Overwrite the stored order for a direction; false unless `keys` is an
	 *  exact, duplicate-free cover of the current category set. */
	reorderCategories(type: ExpenseType, keys: readonly string[]): boolean {
		return this.writeTypeList('categoryOrder', type, keys, this.getCategories(type));
	}

	/** Register a custom category name for a direction; rejected when empty/
	 *  over-long, shadowing a preset, already present, or past the cap. */
	addCustomCategory(type: ExpenseType, rawName: string): AddCategoryResult {
		const name = rawName.trim().slice(0, EXPENSE_CATEGORY_NAME_MAX);
		if (name.length === 0) return { ok: false, reason: 'invalid' };
		const existing = this.data.customCategories?.[type] ?? [];
		if (collidesWithPreset(name, type) || existing.some(n => n.toLowerCase() === name.toLowerCase())) {
			return { ok: false, reason: 'duplicate' };
		}
		if (existing.length >= EXPENSE_MAX_CUSTOM_CATEGORIES) return { ok: false, reason: 'limit' };
		const next = { ...this.data.customCategories, [type]: [...existing, name] };
		this.data = { ...this.data, customCategories: next };
		this.save();
		this.notify();
		return { ok: true, name };
	}

	/** Remove a custom category (case-insensitive). Existing records keep the
	 *  name — display falls back to the raw key (categoryLabel). The name is
	 *  also dropped from the stored order and any primary mapping so it stops
	 *  appearing in manager/filter lists immediately. */
	removeCustomCategory(type: ExpenseType, name: string): boolean {
		const existing = this.data.customCategories?.[type] ?? [];
		const next = existing.filter(n => n.toLowerCase() !== name.toLowerCase());
		if (next.length === existing.length) return false;
		const custom = { ...this.data.customCategories, [type]: next };
		// Drop the key entirely when empty so the JSON stays tidy.
		if (next.length === 0) delete custom[type];

		const orderList = this.data.categoryOrder?.[type] ?? [];
		let categoryOrder = this.data.categoryOrder;
		if (orderList.length > 0) {
			const order = orderList.filter(n => n.toLowerCase() !== name.toLowerCase());
			categoryOrder = { ...this.data.categoryOrder, [type]: order };
			if (order.length === 0) delete categoryOrder[type];
		}

		const parentMap = this.data.categoryParents?.[type];
		let categoryParents = this.data.categoryParents;
		if (parentMap && parentMap[name] !== undefined) {
			const { [name]: _dropped, ...rest } = parentMap;
			categoryParents = { ...this.data.categoryParents, [type]: rest };
		}

		this.data = {
			...this.data,
			customCategories: custom,
			...(categoryOrder !== this.data.categoryOrder ? { categoryOrder } : {}),
			...(categoryParents !== this.data.categoryParents ? { categoryParents } : {}),
		};
		this.save();
		this.notify();
		return true;
	}

	/** Last category picked for a type (or the first known category). */
	getLastCategory(type: ExpenseType): string {
		const cats = this.getCategories(type);
		const saved = this.data.lastCategory[type];
		if (saved && cats.includes(saved)) return saved;
		return cats[0] ?? 'other';
	}

	// ===== Primary groups =====

	/** Ordered primary-group names for a direction (shared copy). */
	getPrimaryCategories(type: ExpenseType): string[] {
		return [...(this.data.primaryCategories?.[type] ?? [])];
	}

	/** Register a primary group; same validation shape as addCustomCategory
	 *  (empty/over-long or preset-shadowing name -> invalid/duplicate). */
	addPrimaryCategory(type: ExpenseType, rawName: string): AddCategoryResult {
		const name = rawName.trim().slice(0, EXPENSE_CATEGORY_NAME_MAX);
		if (name.length === 0) return { ok: false, reason: 'invalid' };
		const existing = this.data.primaryCategories?.[type] ?? [];
		if (collidesWithPreset(name, type) || existing.some(n => n.toLowerCase() === name.toLowerCase())) {
			return { ok: false, reason: 'duplicate' };
		}
		if (existing.length >= EXPENSE_MAX_PRIMARY_CATEGORIES) return { ok: false, reason: 'limit' };
		this.data = {
			...this.data,
			primaryCategories: { ...this.data.primaryCategories, [type]: [...existing, name] },
		};
		this.save();
		this.notify();
		return { ok: true, name };
	}

	/** Remove a primary group (case-insensitive). Categories mapped to it
	 *  become ungrouped — their records are untouched, the mapping is derived. */
	removePrimaryCategory(type: ExpenseType, name: string): boolean {
		const existing = this.data.primaryCategories?.[type] ?? [];
		const next = existing.filter(n => n.toLowerCase() !== name.toLowerCase());
		if (next.length === existing.length) return false;
		const primaries = { ...this.data.primaryCategories, [type]: next };
		if (next.length === 0) delete primaries[type];

		const parentMap = this.data.categoryParents?.[type];
		let categoryParents = this.data.categoryParents;
		if (parentMap) {
			const lower = name.toLowerCase();
			const rest = Object.fromEntries(
				Object.entries(parentMap).filter(([, p]) => p.toLowerCase() !== lower));
			categoryParents = { ...this.data.categoryParents, [type]: rest };
			if (Object.keys(rest).length === 0) delete categoryParents[type];
		}

		this.data = {
			...this.data,
			primaryCategories: primaries,
			...(categoryParents !== this.data.categoryParents ? { categoryParents } : {}),
		};
		this.save();
		this.notify();
		return true;
	}

	/** Categories currently mapped to a primary group (confirm copy + usage). */
	countPrimaryUsage(type: ExpenseType, primary: string): number {
		const lower = primary.toLowerCase();
		return Object.entries(this.data.categoryParents?.[type] ?? {})
			.filter(([, p]) => p.toLowerCase() === lower).length;
	}

	/** Overwrite the stored primary order for a direction; exact-cover rule
	 *  identical to reorderCategories. */
	reorderPrimaryCategories(type: ExpenseType, names: readonly string[]): boolean {
		return this.writeTypeList('primaryCategories', type, names, this.getPrimaryCategories(type));
	}

	/** Assign a category to a primary group (null = ungroup). False when
	 *  either side is unknown; same-value writes are no-op successes. */
	setCategoryParent(type: ExpenseType, category: string, primary: string | null): boolean {
		if (!this.getCategories(type).includes(category)) return false;
		const map = this.data.categoryParents?.[type] ?? {};
		if (primary !== null && !(this.data.primaryCategories?.[type] ?? []).includes(primary)) return false;
		if (primary === null) {
			if (map[category] === undefined) return true;
			const { [category]: _dropped, ...rest } = map;
			const categoryParents = { ...this.data.categoryParents, [type]: rest };
			if (Object.keys(rest).length === 0) delete categoryParents[type];
			this.data = { ...this.data, categoryParents };
		} else {
			if (map[category] === primary) return true;
			this.data = {
				...this.data,
				categoryParents: { ...this.data.categoryParents, [type]: { ...map, [category]: primary } },
			};
		}
		this.save();
		this.notify();
		return true;
	}

	/** The primary group a category is mapped to, or undefined. */
	getCategoryParent(type: ExpenseType, category: string): string | undefined {
		return this.data.categoryParents?.[type]?.[category];
	}

	/** Shared exact-cover writer for the two per-type list fields (stored
	 *  order, primary order): a candidate is accepted only when it covers the
	 *  current entries exactly, without duplicates. */
	private writeTypeList(
		field: 'categoryOrder' | 'primaryCategories',
		type: ExpenseType,
		candidate: readonly string[],
		current: readonly string[],
	): boolean {
		if (candidate.length !== current.length || new Set(candidate).size !== candidate.length) return false;
		if (candidate.some(k => !current.includes(k))) return false;
		if (field === 'categoryOrder') {
			const next = { ...this.data.categoryOrder, [type]: [...candidate] };
			if (candidate.length === 0) delete next[type];
			this.data = { ...this.data, categoryOrder: next };
		} else {
			const next = { ...this.data.primaryCategories, [type]: [...candidate] };
			if (candidate.length === 0) delete next[type];
			this.data = { ...this.data, primaryCategories: next };
		}
		this.save();
		this.notify();
		return true;
	}

	/** Currency symbol from settings (trimmed, default '¥'). */
	getCurrency(): string {
		return this.plugin.settings.expenseCurrency.trim() || '¥';
	}

	/** The Obsidian App (dialogs opened from render layers that only hold a
	 *  Document — e.g. the ledger's edit modal — need it for the Modal base). */
	getApp(): import('obsidian').App {
		return this.plugin.app;
	}

	/** Write a text file into the vault (CSV export); vault-relative path. */
	async writeVaultFile(path: string, content: string): Promise<void> {
		await this.plugin.app.vault.adapter.write(path, content);
	}

	// ===== Aggregation queries (pure derivations, no disk access) =====

	/** Records with date in [start, end] (inclusive, 'YYYY-MM-DD' strings),
	 *  oldest first, createdAt as the tiebreak. */
	getRecordsInRange(start: string, end: string, type?: ExpenseType): ExpenseRecord[] {
		return this.data.records
			.filter(r => r.date >= start && r.date <= end && (type === undefined || r.type === type))
			.sort((a, b) => a.date === b.date ? a.createdAt - b.createdAt : (a.date < b.date ? -1 : 1));
	}

	/** Expense/income totals over a date range. */
	getRangeTotals(start: string, end: string): { expense: number; income: number } {
		let expense = 0;
		let income = 0;
		for (const r of this.data.records) {
			if (r.date < start || r.date > end) continue;
			if (r.type === 'expense') expense += r.amount;
			else income += r.amount;
		}
		return { expense: round2(expense), income: round2(income) };
	}

	/** Today's totals (drives the widget's row totals and net label). */
	getTodayTotals(): { expense: number; income: number } {
		const today = expenseToday();
		return this.getRangeTotals(today, today);
	}

	/** One point per day across [start, end], zero-filled, for trend charts. */
	getDailyTotals(start: string, end: string, type: ExpenseType): { date: string; amount: number }[] {
		const byDate = new Map<string, number>();
		for (const r of this.data.records) {
			if (r.type !== type || r.date < start || r.date > end) continue;
			byDate.set(r.date, (byDate.get(r.date) ?? 0) + r.amount);
		}
		const series: { date: string; amount: number }[] = [];
		const cursor = new Date(start + 'T00:00:00');
		const last = new Date(end + 'T00:00:00');
		while (cursor <= last) {
			const key = formatDate(cursor);
			series.push({ date: key, amount: round2(byDate.get(key) ?? 0) });
			cursor.setDate(cursor.getDate() + 1);
		}
		return series;
	}

	/** One point per month of the year (1-12, 'YYYY-MM'), zero-filled. */
	getMonthlyTotals(year: number, type: ExpenseType): { month: string; amount: number }[] {
		const byMonth = new Map<string, number>();
		for (const r of this.data.records) {
			if (r.type !== type || !r.date.startsWith(`${year}-`)) continue;
			const key = r.date.slice(0, 7);
			byMonth.set(key, (byMonth.get(key) ?? 0) + r.amount);
		}
		const series: { month: string; amount: number }[] = [];
		for (let m = 1; m <= 12; m++) {
			const key = `${year}-${String(m).padStart(2, '0')}`;
			series.push({ month: key, amount: round2(byMonth.get(key) ?? 0) });
		}
		return series;
	}

	/** Per-category totals over a range, for donut/ranking views. */
	getCategoryBreakdown(start: string, end: string, type: ExpenseType): Map<string, number> {
		const totals = new Map<string, number>();
		for (const r of this.data.records) {
			if (r.type !== type || r.date < start || r.date > end) continue;
			totals.set(r.category, (totals.get(r.category) ?? 0) + r.amount);
		}
		return totals;
	}

	/** Years with records, ascending; always includes the current year so the
	 *  history view can render it even when still empty. */
	getAvailableYears(): number[] {
		const years = new Set<number>();
		for (const r of this.data.records) {
			const y = Number(r.date.slice(0, 4));
			if (Number.isFinite(y)) years.add(y);
		}
		years.add(new Date().getFullYear());
		return [...years].sort((a, b) => a - b);
	}
}

/** Regroup a per-category breakdown (getCategoryBreakdown) up to primary
 *  groups: each category's total lands on its mapped primary, unmapped ones
 *  pool into the UNGROUPED_PRIMARY bucket. Pure — the stats overlay calls it
 *  with its own parentOf so this stays testable without a service instance. */
export function regroupBreakdownByPrimary(
	totals: ReadonlyMap<string, number>,
	parentOf: (category: string) => string | undefined,
): Map<string, number> {
	const out = new Map<string, number>();
	for (const [category, value] of totals) {
		const key = parentOf(category) ?? UNGROUPED_PRIMARY;
		out.set(key, (out.get(key) ?? 0) + value);
	}
	return out;
}
