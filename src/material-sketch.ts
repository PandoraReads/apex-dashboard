/**
 * Sketch thumbnails for the material library (素材库): Obsidian .canvas
 * boards and Excalidraw drawings rendered as lightweight SVG data URLs.
 *
 * Both formats are JSON scenes the plugin can draw faithfully enough for a
 * cover tile — real geometry, real colors, real text snippets — without
 * loading the source plugins. The SVG carries explicit width/height so the
 * existing image probe reads the true aspect ratio off it.
 *
 * Pure string building throughout (no DOM), so the node harness tests the
 * exact code that ships.
 */

/** XML-escape text content and attribute values. */
function esc(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/** SVG data URL (percent-encoded UTF-8 — safe for CJK content, no base64
 * inflation). */
export function svgDataUrl(svg: string): string {
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** First line-run of a text node for the thumbnail: existing lines kept (max
 * 4, long lines clipped), because card text is the board's identity. */
function textLines(raw: string, maxLines: number, maxChars: number): string[] {
	const lines: string[] = [];
	for (const rawLine of raw.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line) continue;
		lines.push(line.length > maxChars ? line.slice(0, maxChars - 1) + '…' : line);
		if (lines.length >= maxLines) break;
	}
	return lines;
}

/** Multi-line <text> as stacked tspans starting at (x, y). */
function textBlock(x: number, y: number, lines: readonly string[], fontSize: number, fill: string, weight = '400'): string {
	if (lines.length === 0) return '';
	const lh = Math.round(fontSize * 1.35);
	const tspans = lines.map((line, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : lh}">${esc(line)}</tspan>`).join('');
	return `<text x="${x}" y="${y + fontSize}" font-family="-apple-system,'PingFang SC','Segoe UI',sans-serif" font-size="${fontSize}" font-weight="${weight}" fill="${fill}">${tspans}</text>`;
}

/** Clamp a scene's raw extent and scale it into a sane thumbnail box. */
function fitViewBox(minX: number, minY: number, maxX: number, maxY: number, pad: number): {
	x: number; y: number; w: number; h: number; scale: number;
} {
	const w = Math.max(1, maxX - minX) + pad * 2;
	const h = Math.max(1, maxY - minY) + pad * 2;
	const longest = Math.max(w, h);
	const scale = longest > 2400 ? 2400 / longest : 1;
	return { x: minX - pad, y: minY - pad, w: Math.round(w * scale), h: Math.round(h * scale), scale };
}

// ---------------------------------------------------------------------------
// Obsidian Canvas
// ---------------------------------------------------------------------------

interface CanvasNode {
	type?: string;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	color?: string;
	text?: string;
	file?: string;
	label?: string;
}
interface CanvasEdge {
	fromNode?: string;
	toNode?: string;
}

/** Canvas palette — Obsidian's six canvas colors, approximated. */
const CANVAS_COLORS: Readonly<Record<string, string>> = {
	'1': '#e03131',
	'2': '#f08c00',
	'3': '#e0ac00',
	'4': '#08b94f',
	'5': '#00b8d9',
	'6': '#a882ff',
};

function canvasColor(color: string | undefined, alpha: number): string {
	const hex = color && CANVAS_COLORS[color] ? CANVAS_COLORS[color]! : '#8a8a8a';
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	return `rgba(${r},${g},${b},${alpha})`;
}

/** Render a .canvas JSON document to a standalone <svg> string. Returns null
 * when the text is not a canvas (bad JSON, no nodes). */
export function canvasThumbSvg(text: string): string | null {
	let doc: { nodes?: CanvasNode[]; edges?: CanvasEdge[] };
	try {
		doc = JSON.parse(text);
	} catch {
		return null;
	}
	const nodes = Array.isArray(doc.nodes) ? doc.nodes : [];
	if (nodes.length === 0) return null;
	const edges = Array.isArray(doc.edges) ? doc.edges : [];
	const nodeById = new Map<string, CanvasNode>();
	nodes.forEach((n, i) => {
		if (n && typeof n === 'object') nodeById.set(String((n as { id?: string }).id ?? `n${i}`), n);
	});

	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const n of nodes) {
		if (!n || typeof n !== 'object') continue;
		const x = Number(n.x) || 0;
		const y = Number(n.y) || 0;
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x + (Number(n.width) || 0));
		maxY = Math.max(maxY, y + (Number(n.height) || 0));
	}
	if (!Number.isFinite(minX)) return null;
	const view = fitViewBox(minX, minY, maxX, maxY, 48);

	const body: string[] = [];
	// Edges first so nodes sit on top.
	for (const e of edges) {
		const from = e && nodeById.get(String(e.fromNode));
		const to = e && nodeById.get(String(e.toNode));
		if (!from || !to) continue;
		const fx = (Number(from.x) || 0) + (Number(from.width) || 0) / 2;
		const fy = (Number(from.y) || 0) + (Number(from.height) || 0) / 2;
		const tx = (Number(to.x) || 0) + (Number(to.width) || 0) / 2;
		const ty = (Number(to.y) || 0) + (Number(to.height) || 0) / 2;
		body.push(`<line x1="${fx}" y1="${fy}" x2="${tx}" y2="${ty}" stroke="#9aa0a6" stroke-width="2" opacity="0.55"/>`);
	}
	for (const n of nodes) {
		if (!n || typeof n !== 'object') continue;
		const x = Number(n.x) || 0;
		const y = Number(n.y) || 0;
		const w = Number(n.width) || 0;
		const h = Number(n.height) || 0;
		const type = typeof n.type === 'string' ? n.type : 'text';
		if (type === 'group') {
			body.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="none" stroke="${canvasColor(n.color, 0.7)}" stroke-width="2" stroke-dasharray="6 5"/>`);
			if (n.label) body.push(textBlock(x + 10, y + 10, textLines(n.label, 1, 24), 15, canvasColor(n.color, 1), '600'));
			continue;
		}
		const stroke = canvasColor(n.color, 0.85);
		body.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="#ffffff" stroke="${stroke}" stroke-width="2"/>`);
		if (type === 'file') {
			// A tiny page glyph + the linked file's name.
			body.push(`<rect x="${x + 12}" y="${y + 14}" width="13" height="17" rx="2" fill="${canvasColor(n.color, 0.16)}" stroke="${stroke}" stroke-width="1.5"/>`);
			const name = (n.file ?? '').split('/').pop() ?? '';
			body.push(textBlock(x + 34, y + 16, textLines(name, 2, 26), 14, '#3d4653', '500'));
		} else {
			const raw = n.text ?? '';
			const plain = raw.replace(/^#*\s*/gm, '').replace(/\[\[([^\]|]*)(\|[^\]]*)?\]\]/g, (_all, link: string) => link.split('/').pop() ?? '');
			const fs = Math.max(11, Math.min(16, Math.round(w / 14)));
			body.push(textBlock(x + 12, y + 10, textLines(plain, 4, Math.max(12, Math.floor((w - 20) / (fs * 0.6)))), fs, '#3d4653'));
		}
	}

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${view.w}" height="${view.h}" viewBox="${view.x} ${view.y} ${view.w / view.scale} ${view.h / view.scale}">` +
		`<rect x="${view.x}" y="${view.y}" width="${view.w / view.scale}" height="${view.h / view.scale}" fill="#ffffff"/>` +
		body.join('') + '</svg>';
}

// ---------------------------------------------------------------------------
// Excalidraw
// ---------------------------------------------------------------------------

interface ExcalidrawElement {
	type?: string;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	angle?: number;
	strokeColor?: string;
	backgroundColor?: string;
	strokeWidth?: number;
	opacity?: number;
	fontSize?: number;
	text?: string;
	points?: Array<{ x: number; y: number }>;
	isDeleted?: boolean;
	roundness?: unknown;
}

/** Pull the drawing JSON out of either Excalidraw flavor: the plugin's
 * markdown wrapper (a ```json fence under '## Drawing') or a bare .excalidraw
 * JSON file. Returns null when no scene is found. */
export function excalidrawJsonOf(text: string): string | null {
	const trimmed = text.trim();
	if (trimmed.startsWith('{')) return trimmed;
	const fence = /```json\s*\r?\n([\s\S]*?)\r?\n\s*```/.exec(text);
	if (fence && /"(elements|type)"\s*:/.test(fence[1]!)) return fence[1]!;
	return null;
}

function excDrawElement(el: ExcalidrawElement): string {
	const x = Number(el.x) || 0;
	const y = Number(el.y) || 0;
	const w = Number(el.width) || 0;
	const h = Number(el.height) || 0;
	const stroke = el.strokeColor && el.strokeColor !== 'transparent' ? el.strokeColor : '#1e1e1e';
	const fill = el.backgroundColor && el.backgroundColor !== 'transparent' ? el.backgroundColor : 'none';
	const sw = Math.max(1, Math.min(4, Number(el.strokeWidth) || 2));
	const opacity = el.opacity != null && el.opacity < 100 ? el.opacity / 100 : 1;
	const rotate = el.angle ? ` transform="rotate(${(el.angle * 180) / Math.PI} ${x + w / 2} ${y + h / 2})"` : '';
	const common = ` stroke="${stroke}" stroke-width="${sw}" fill="${fill}" opacity="${opacity}"${rotate}`;
	const type = el.type ?? '';
	if (type === 'rectangle') {
		const rx = el.roundness != null ? 8 : 0;
		return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"${common}/>`;
	}
	if (type === 'ellipse') {
		return `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}"${common}/>`;
	}
	if (type === 'diamond') {
		return `<polygon points="${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}"${common}/>`;
	}
	if (type === 'text') {
		const fs = Number(el.fontSize) || 20;
		const lines = textLines(el.text ?? '', 4, 60);
		const tspans = lines.map((line, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : Math.round(fs * 1.28)}">${esc(line)}</tspan>`).join('');
		return `<text x="${x}" y="${y + fs}" font-family="Virgil,-apple-system,'Comic Sans MS',cursive,sans-serif" font-size="${fs}" fill="${stroke}" opacity="${opacity}">${tspans}</text>`;
	}
	if (type === 'image') {
		return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#f1f0f1" stroke="${stroke}" stroke-width="${sw}" opacity="${opacity}"/>` +
			`<line x1="${x}" y1="${y}" x2="${x + w}" y2="${y + h}" stroke="${stroke}" stroke-width="1" opacity="${opacity * 0.4}"/>`;
	}
	const pts = Array.isArray(el.points) ? el.points : [];
	if (pts.length >= 2) {
		const poly = pts.map(p => `${x + (Number(p.x) || 0)},${y + (Number(p.y) || 0)}`).join(' ');
		return `<polyline points="${poly}" fill="none"${common}/>`;
	}
	return '';
}

/** Render an Excalidraw scene (raw .excalidraw text or markdown wrapper) to
 * a standalone <svg> string; null when no drawable scene exists. */
export function excalidrawThumbSvg(text: string): string | null {
	const json = excalidrawJsonOf(text);
	if (!json) return null;
	let doc: { elements?: ExcalidrawElement[]; appState?: { viewBackgroundColor?: string } };
	try {
		doc = JSON.parse(json);
	} catch {
		return null;
	}
	const elements = (Array.isArray(doc.elements) ? doc.elements : []).filter(el =>
		el && typeof el === 'object' && el.isDeleted !== true);
	if (elements.length === 0) return null;

	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const el of elements) {
		const x = Number(el.x) || 0;
		const y = Number(el.y) || 0;
		let ex = x + (Number(el.width) || 0);
		let ey = y + (Number(el.height) || 0);
		const pts = Array.isArray(el.points) ? el.points : [];
		if (pts.length > 0) {
			for (const p of pts) {
				ex = Math.max(ex, x + (Number(p.x) || 0));
				ey = Math.max(ey, y + (Number(p.y) || 0));
			}
		}
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, ex);
		maxY = Math.max(maxY, ey);
	}
	if (!Number.isFinite(minX)) return null;
	const view = fitViewBox(minX, minY, maxX, maxY, 32);
	const bg = doc.appState?.viewBackgroundColor && doc.appState.viewBackgroundColor !== 'transparent'
		? doc.appState.viewBackgroundColor
		: '#ffffff';

	const body = elements.map(el => excDrawElement(el)).join('');
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${view.w}" height="${view.h}" viewBox="${view.x} ${view.y} ${view.w / view.scale} ${view.h / view.scale}">` +
		`<rect x="${view.x}" y="${view.y}" width="${view.w / view.scale}" height="${view.h / view.scale}" fill="${esc(bg)}"/>` +
		body + '</svg>';
}
