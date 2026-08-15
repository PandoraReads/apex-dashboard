import { App, TFile } from 'obsidian';

/** Rename a media file; fileManager.renameFile updates all [[links]]/![[embeds]] automatically. */
export async function renameMediaFile(app: App, file: TFile, newBasename: string): Promise<void> {
	const name = newBasename.trim();
	if (!name || name === file.basename) return;
	const parentPath = file.parent ? file.parent.path : '';
	const newPath = parentPath ? `${parentPath}/${name}.${file.extension}` : `${name}.${file.extension}`;
	await app.fileManager.renameFile(file, newPath);
}

/** Move a media file to the trash (recoverable) via the file manager so the
 *  user's "delete to trash vs permanent" preference is respected. */
export async function trashMediaFile(app: App, file: TFile): Promise<void> {
	await app.fileManager.trashFile(file);
}
