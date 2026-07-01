import { TickTickClient } from './ticktick-service';
import type { TickTickProject } from './ticktick-service';

/** Helper for view.ts: fetch the project list to populate the filter modal. */
export async function fetchTickTickProjects(region: 'dida365' | 'ticktick', cookie: string, deviceVersion?: string): Promise<TickTickProject[]> {
	const client = new TickTickClient(region, cookie, deviceVersion);
	if (!client.isConfigured()) return [];
	try {
		return (await client.fetchSnapshot()).projects;
	} catch {
		return [];
	}
}
