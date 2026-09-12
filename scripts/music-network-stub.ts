export * from './obsidian-stub';
export let responses: unknown[] = [];
export let calls: { url: string; headers?: Record<string, string> }[] = [];
export function resetNetwork(next: unknown[]): void { responses = [...next]; calls = []; }
export async function requestUrl(options: { url: string; headers?: Record<string, string> }): Promise<{ json: unknown }> {
	calls = [...calls, options];
	if (!responses.length) throw new Error('Unexpected request');
	return { json: responses.shift() };
}
