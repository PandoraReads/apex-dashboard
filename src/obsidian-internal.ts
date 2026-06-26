import type { App } from 'obsidian';

/**
 * Shapes for parts of Obsidian's `App` that exist at runtime but are not part
 * of the published `obsidian` typings. Casting `app` to these lets us reach the
 * internal command registry (listing and executing commands) without `any`.
 */

/** A registered command as exposed by the internal registry. */
interface InternalCommand {
	name?: string;
}

/** Obsidian's internal command registry, available at runtime as `app.commands`. */
export interface AppCommandRegistry {
	commands: Record<string, InternalCommand>;
	executeCommandById(id: string): void;
}

/** `App` augmented with the untyped internal command registry. */
export interface AppWithCommands extends App {
	commands: AppCommandRegistry;
}
