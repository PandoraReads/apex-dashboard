export let cookies: { name: string; value: string }[] = [];
export let flushes = 0;
export let windows: BrowserWindow[] = [];
export let failLoad = false;
export const localSession = {
	cookies: {
		get: async () => cookies,
		flushStore: async () => { flushes += 1; },
	},
	clearStorageData: async () => { cookies = []; },
};
export function setCookies(next: typeof cookies): void { cookies = [...next]; }
export function setFailLoad(next: boolean): void { failLoad = next; }
export const session = { fromPartition: (_partition: string) => localSession };
export class BrowserWindow {
	closed = false;
	onClosed = () => {};
	webContents = {
		session: localSession,
		setWindowOpenHandler: (_handler: unknown) => {},
		on: (_event: string, _handler: unknown) => {},
	};
	constructor(readonly options: Record<string, unknown>) { windows = [...windows, this]; }
	async loadURL(_url: string): Promise<void> { if (failLoad) throw new Error('offline'); }
	on(_event: string, listener: () => void): void { this.onClosed = listener; }
	isDestroyed(): boolean { return this.closed; }
	close(): void { this.closed = true; this.onClosed(); }
}
