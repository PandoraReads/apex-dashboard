import type { App } from 'obsidian';
import type { DashboardColumn } from './types';

export interface CustomSectionContext {
	app: App;
	container: HTMLElement;
	column: DashboardColumn;
	config: Record<string, unknown>;
	/** Persist JSON-compatible configuration on this dashboard section. */
	setConfig(config: Record<string, unknown>): void;
}

export interface CustomSectionDefinition {
	/** Stable, namespaced identifier, for example `my-plugin:reading-list`. */
	id: string;
	label: string;
	icon: string;
	defaultName: string;
	render(context: CustomSectionContext): void | (() => void) | Promise<void | (() => void)>;
}

const BUILT_IN_SECTION_IDS = new Set([
	'memo', 'todo', 'projects', 'notes', 'dashboard', 'library', 'folder', 'images',
	'videos', 'alltasks', 'calendar', 'dataview', 'weread', 'ticktick', 'sticky', 'web',
]);
const DEFINITIONS = new Map<string, CustomSectionDefinition>();

export function registerSectionDefinition(definition: CustomSectionDefinition): () => void {
	if (!/^[a-z0-9][a-z0-9.-]*:[a-z0-9][a-z0-9.-]*$/.test(definition.id)) {
		throw new Error(`Custom section id must be namespaced (plugin-id:section-id): ${definition.id}`);
	}
	if (BUILT_IN_SECTION_IDS.has(definition.id) || DEFINITIONS.has(definition.id)) {
		throw new Error(`Section id is already registered: ${definition.id}`);
	}
	DEFINITIONS.set(definition.id, definition);
	return () => {
		if (DEFINITIONS.get(definition.id) === definition) DEFINITIONS.delete(definition.id);
	};
}

export function getSectionDefinition(id: string): CustomSectionDefinition | undefined {
	return DEFINITIONS.get(id);
}

export function registeredSectionDefinitions(): CustomSectionDefinition[] {
	return [...DEFINITIONS.values()];
}
