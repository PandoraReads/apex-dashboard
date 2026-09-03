/**
 * Minimal DOM stand-in for Node-run verification scripts. Covers only the
 * HTMLElement surface the config modals touch: Obsidian's createEl/createDiv/
 * createSpan/empty/addClass/toggleClass helpers, addEventListener/dispatchEvent,
 * and basic child traversal. No CSS selector engine — tests locate elements by
 * walking the tree themselves (findByClass/findTag).
 *
 * Not a general-purpose DOM: attribute-only inputs (checked, value) are plain
 * properties, and textContent set clears children, matching how the modals use
 * them.
 */
export class El {
	readonly tagName: string;
	className = '';
	children: El[] = [];
	private text = '';
	private readonly attrs = new Map<string, string>();
	private readonly listeners = new Map<string, Array<(ev: unknown) => void>>();
	// Plain state properties the UI code reads/writes on inputs and buttons.
	value = '';
	checked = false;
	disabled = false;
	selected = false;
	parent: El | null = null;

	/** No-op: no real focus in the stand-in. */
	focus(): void {}

	constructor(tag: string) {
		this.tagName = tag.toUpperCase();
	}

	get parentElement(): El | null {
		return this.parent;
	}

	get firstChild(): El | null {
		return this.children[0] ?? null;
	}

	setAttribute(name: string, value: string): void {
		this.attrs.set(name, value);
	}

	getAttribute(name: string): string | null {
		return this.attrs.get(name) ?? null;
	}

	/** DOM-style dataset: camelCase keys map to/from data-* attributes. */
	get dataset(): Record<string, string> {
		const self = this;
		const hyphenate = (k: string): string => k.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
		return new Proxy({} as Record<string, string>, {
			get: (_, k: string) => self.getAttribute(`data-${hyphenate(k)}`) ?? '',
			set: (_, k: string, v: string) => {
				self.setAttribute(`data-${hyphenate(k)}`, String(v));
				return true;
			},
			has: (_, k: string) => self.getAttribute(`data-${hyphenate(k)}`) !== null,
		});
	}

	/** Record custom-props for assertions — no real layout in the stand-in. */
	setCssProps(props: Record<string, string>): void {
		(this as unknown as { cssProps?: Record<string, string> }).cssProps = { ...props };
	}

	get textContent(): string {
		return this.children.length > 0 ? this.children.map(c => c.textContent).join('') : this.text;
	}

	set textContent(v: string) {
		this.text = v;
		this.children = [];
	}

	appendChild(child: El): El {
		child.parent = this;
		this.children.push(child);
		return child;
	}

	removeChild(child: El): El {
		const i = this.children.indexOf(child);
		if (i >= 0) this.children.splice(i, 1);
		return child;
	}

	addClass(...cls: string[]): void {
		const parts = new Set(this.className.split(/\s+/).filter(Boolean));
		for (const c of cls) parts.add(c);
		this.className = [...parts].join(' ');
	}

	removeClass(cls: string): void {
		const parts = new Set(this.className.split(/\s+/).filter(Boolean));
		parts.delete(cls);
		this.className = [...parts].join(' ');
	}

	toggleClass(cls: string, on: boolean): void {
		if (on) this.addClass(cls);
		else this.removeClass(cls);
	}

	hasClass(cls: string): boolean {
		return this.className.split(/\s+/).includes(cls);
	}

	/** DOM-style classList facade for code written against the real DOM. */
	get classList(): { add: (...cls: string[]) => void; remove: (cls: string) => void; toggle: (cls: string, on?: boolean) => void; contains: (cls: string) => boolean } {
		const self = this;
		return {
			add: (...cls: string[]) => self.addClass(...cls),
			remove: (cls: string) => self.removeClass(cls),
			toggle: (cls: string, on?: boolean) => {
				const target = on ?? !self.hasClass(cls);
				self.toggleClass(cls, target);
			},
			contains: (cls: string) => self.hasClass(cls),
		};
	}

	/**
	 * Restricted CSS selector matching: `.class`, `tag`, `:scope >` prefixes,
	 * and descendant combinations of those (e.g. `:scope > .a`, `div.cls`).
	 * Enough for the selectors the UI code uses, not a general engine.
	 */
	matches(selector: string): boolean {
		return elMatches(this, selector);
	}

	/** querySelector/querySelectorAll over the same restricted selectors. */
	querySelectorAll(selector: string): El[] {
		const out: El[] = [];
		const walk = (el: El): void => {
			if (el.matches(selector)) out.push(el);
			for (const c of el.children) walk(c);
		};
		for (const c of this.children) walk(c);
		return out;
	}

	querySelector(selector: string): El | null {
		return this.querySelectorAll(selector)[0] ?? null;
	}

	addEventListener(type: string, fn: (ev: unknown) => void): void {
		const list = this.listeners.get(type) ?? [];
		list.push(fn);
		this.listeners.set(type, list);
	}

	dispatchEvent(ev: { type: string; target?: El; key?: string }): boolean {
		// Listeners written against the real DOM commonly call
		// stopPropagation/preventDefault; give every dispatched event no-ops so
		// those handlers run unmodified.
		const full = Object.assign({ stopPropagation: () => {}, preventDefault: () => {} }, ev);
		for (const fn of this.listeners.get(ev.type) ?? []) fn(full);
		return true;
	}

	click(): void {
		this.dispatchEvent({ type: 'click', target: this });
	}

	// ---- Obsidian HTMLElement helpers ----

	createEl(tag: string, o?: { cls?: string; text?: string; attr?: Record<string, string> }): El {
		const el = new El(tag);
		this.appendChild(el);
		if (o?.cls) el.addClass(...o.cls.split(/\s+/));
		if (o?.text !== undefined) el.textContent = o.text;
		for (const [k, v] of Object.entries(o?.attr ?? {})) el.setAttribute(k, v);
		return el;
	}

	createDiv(o?: { cls?: string; text?: string }): El {
		return this.createEl('div', o);
	}

	createSpan(o?: { cls?: string; text?: string }): El {
		return this.createEl('span', o);
	}

	empty(): El {
		this.children = [];
		this.text = '';
		return this;
	}
}

/** Depth-first search for elements whose class list contains `cls`. */
export function findByClass(root: El, cls: string): El[] {
	const out: El[] = [];
	const walk = (el: El): void => {
		if (el.hasClass(cls)) out.push(el);
		for (const c of el.children) walk(c);
	};
	walk(root);
	return out;
}

/** Match one simple selector part: `tag`, `.class`, `tag.class`, or `*`. */
function matchesSimple(el: El, part: string): boolean {
	if (part === '' || part === ':scope') return true;
	const bits = part.replace(/^:scope>*/, '').split('.');
	const tag = bits[0]!;
	if (tag && tag !== '*' && el.tagName !== tag.toUpperCase()) return false;
	for (const cls of bits.slice(1)) {
		if (cls && !el.hasClass(cls)) return false;
	}
	return true;
}

/** Restricted selector engine: `:scope` prefixes, `>` and descendant chains. */
function elMatches(el: El, selector: string): boolean {
	// Split into (combinator, simple-part) pairs; `>` attaches to the part
	// that follows it.
	const raw = selector.trim().split(/\s+/).filter(Boolean);
	const parts: Array<{ comb: ' ' | '>'; text: string }> = [];
	for (const r of raw) {
		if (r === '>') {
			if (parts.length > 0) parts[parts.length - 1]!.comb = '>';
			continue;
		}
		parts.push({ comb: ' ', text: r });
	}
	if (parts.length === 0) return false;

	const matchRest = (node: El, i: number): boolean => {
		const { comb, text } = parts[i]!;
		if (!matchesSimple(node, text)) return false;
		if (i === 0) return true;
		if (comb === '>') {
			return node.parent ? matchRest(node.parent, i - 1) : false;
		}
		let cur: El | null = node.parent;
		while (cur) {
			if (matchRest(cur, i - 1)) return true;
			cur = cur.parent;
		}
		return false;
	};
	return matchRest(el, parts.length - 1);
}

/** Depth-first search for elements with the given tag name. */
export function findTag(root: El, tag: string): El[] {
	const want = tag.toUpperCase();
	const out: El[] = [];
	const walk = (el: El): void => {
		if (el.tagName === want) out.push(el);
		for (const c of el.children) walk(c);
	};
	walk(root);
	return out;
}

/**
 * Document-order index of `needle` within `root`'s tree (pre-order). Returns -1
 * when `needle` is not a descendant. Use to assert relative layout ("the search
 * box renders above the chips").
 */
export function orderIndex(root: El, needle: El): number {
	let i = 0;
	let found = -1;
	const walk = (el: El): void => {
		if (el === needle) found = i;
		i += 1;
		for (const c of el.children) walk(c);
	};
	walk(root);
	return found;
}
