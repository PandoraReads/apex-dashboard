/** Canonical CSV column order for exports and headerless imports. */
export const CSV_HEADER = ['date', 'type', 'category', 'amount', 'note'] as const;

/** Strip the BOM Excel-compatible files start with. */
function stripBom(text: string): string {
	return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * RFC-4180-ish CSV parser: quoted fields, doubled quotes, CR/LF/CRLF line
 * breaks, and newlines inside quotes. Returns rows of raw cell strings —
 * header mapping and value parsing live with the importer.
 */
export function parseCsv(raw: string): string[][] {
	const text = stripBom(raw);
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let inQuotes = false;
	let i = 0;
	while (i < text.length) {
		const ch = text[i];
		if (inQuotes) {
			if (ch === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i += 2;
					continue;
				}
				inQuotes = false;
				i++;
				continue;
			}
			field += ch;
			i++;
			continue;
		}
		if (ch === '"') {
			inQuotes = true;
			i++;
			continue;
		}
		if (ch === ',') {
			row.push(field);
			field = '';
			i++;
			continue;
		}
		if (ch === '\r' || ch === '\n') {
			// CRLF counts as one break; a lone \n or \r ends the row too.
			if (ch === '\r' && text[i + 1] === '\n') i++;
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
			i++;
			continue;
		}
		field += ch;
		i++;
	}
	// Trailing field/row without a line break.
	if (field.length > 0 || row.length > 0) {
		row.push(field);
		rows.push(row);
	}
	return rows;
}

/** Quote one field when it contains a separator, quote or line break. */
function escapeField(value: string): string {
	if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
	return value;
}

/** Serialize rows to CSV with CRLF breaks (Excel opens it cleanly). */
export function serializeCsv(rows: readonly (readonly string[])[]): string {
	return rows.map(row => row.map(escapeField).join(',')).join('\r\n');
}
