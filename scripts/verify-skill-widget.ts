import { strict as assert } from 'node:assert';
import { Modal } from 'obsidian';
import { El, findByClass, findTag } from './mini-dom';
import type { DashboardSettings, SkillShortcut } from '../src/types';
import { renderSidebarSkillWidget } from '../src/skill-widget';

(globalThis as Record<string, unknown>).createDiv = (o?: { cls?: string; text?: string }): El => {
	const el = new El('div');
	if (o?.cls) el.addClass(...o.cls.split(/\s+/));
	if (o?.text !== undefined) el.textContent = o.text;
	return el;
};

const buttons: SkillShortcut[] = [
	{ id: 'a', label: '整理收件箱', icon: 'inbox', target: 'claudian', skillName: 'tidy-inbox', inputPlaceholder: '', promptTemplate: '$tidy-inbox\n\n{input}' },
	{ id: 'b', label: '归档摘录', icon: 'archive', target: 'claudian', skillName: '', inputPlaceholder: '', promptTemplate: '{input}', directSend: true },
];

function settings(overrides?: Partial<DashboardSettings>): DashboardSettings {
	return { widgetSkillsEnabled: true, skillWidgetButtons: buttons, knownSkills: {}, skillSourceFolders: '' } as unknown as DashboardSettings;
}

function main(): void {
	const host = new El('div');
	renderSidebarSkillWidget(host as unknown as HTMLElement, {} as never, settings());

	assert.equal(findByClass(host, 'dashboard-sidebar-skills').length, 1, 'widget card rendered');
	const btns = findByClass(host, 'dashboard-skills-orb').filter(el => !(el.className ?? '').includes('orb--cog'));
	assert.equal(btns.length, 2, 'one button per configured skill');
	// Macaron coloring: inline background per stable skill hash.
	assert.ok(btns[0]!.style.getPropertyValue('--orb').length > 0, 'pastel key color set via --orb');
	assert.equal(findByClass(host, 'dashboard-skills-orb--cog').length, 1, 'gear key at the far right');

	// Click opens the shared preview modal (the stub records Modal.last).
	const ModalSpy = Modal as unknown as { last: unknown };
	ModalSpy.last = null;
	btns[0]!.click();
	assert.ok(ModalSpy.last, 'click opens AgentPromptModal');

	// Direct-send buttons never open the modal.
	ModalSpy.last = null;
	btns[1]!.click();
	assert.ok(!ModalSpy.last, 'directSend skips the confirm modal');
}

main();
