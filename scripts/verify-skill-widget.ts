import { strict as assert } from 'node:assert';
import { Modal, Notice } from 'obsidian';
import { El, findByClass } from './mini-dom';
import type { DashboardSettings, SkillShortcut } from '../src/types';
import { renderSidebarSkillWidget } from '../src/skill-widget';
import { AgentPromptModal } from '../src/agent-prompt-modal';

(globalThis as Record<string, unknown>).createDiv = (o?: { cls?: string; text?: string }): El => {
	const el = new El('div');
	if (o?.cls) el.addClass(...o.cls.split(/\s+/));
	if (o?.text !== undefined) el.textContent = o.text;
	return el;
};
// Obsidian globals absent in Node: activeDocument (query misses -> theme
// mirroring no-ops) and window (setTimeout for input autofocus).
(globalThis as { activeDocument?: unknown }).activeDocument = { querySelector: () => null };
(globalThis as { window?: unknown }).window = globalThis;

const buttons: SkillShortcut[] = [
	{ id: 'a', label: '整理收件箱', icon: 'inbox', target: 'claudian', skillName: 'tidy-inbox', promptTemplate: '$tidy-inbox\n\n{input}' },
	{ id: 'b', label: '归档摘录', icon: 'archive', target: 'claudian', skillName: '', promptTemplate: '{input}', directSend: true },
];

function settings(overrides?: Partial<DashboardSettings>): DashboardSettings {
	return { widgetSkillsEnabled: true, skillWidgetButtons: buttons, knownSkills: {}, skillSourceFolders: '' } as unknown as DashboardSettings;
}

function widgetRender(): void {
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

/** Copilot-shaped fake app: every step of the adapter chain is async, so the
 *  send promise can never settle inside the click that started it. */
function copilotApp(sent: string[], fail = false): Record<string, unknown> {
	return {
		plugins: { plugins: { copilot: {
			activateAgentView: async () => {},
			agentSessionManager: {
				getOrCreateActiveSession: async () => ({ getStatus: () => 'ready' }),
				getActiveChatUIState: () => ({
					isTurnInFlight: () => false,
					sendMessage: (text: string) => {
						if (fail) throw new Error('bridge down');
						sent.push(text);
						return { id: 'message-1' };
					},
				}),
			},
		} } },
	};
}

/** Stub Notice records messages under a property the real typings lack. */
const noticeMessages = (): string[] => (Notice as unknown as { messages: string[] }).messages;

function openedModal(app: Record<string, unknown>): { modal: AgentPromptModal; wasClosed: () => number } {
	const modal = new AgentPromptModal(app as never, {
		label: '整理收件箱',
		skillName: 'tidy-inbox',
		promptTemplate: '$tidy-inbox\n\n{input}',
	}, 'copilot', {});
	let closes = 0;
	modal.close = () => { closes += 1; };
	modal.onOpen();
	return { modal, wasClosed: () => closes };
}

async function modalBehavior(): Promise<void> {
	const settle = (ms = 25): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
	const typeAndSend = (modal: AgentPromptModal, text: string): void => {
		const input = findByClass(modal.contentEl as unknown as El, 'dashboard-skill-input')[0]!;
		input.value = text;
		const send = findByClass(modal.contentEl as unknown as El, 'dashboard-modal-btn--confirm')[0]!;
		send.click();
	};

	// The regression: clicking send must close the modal at once — not after
	// the adapter bridge settles (a slow Copilot/Claudian send used to leave
	// the dialog stranded on screen until manual close).
	{
		const sent: string[] = [];
		const { modal, wasClosed } = openedModal(copilotApp(sent));
		typeAndSend(modal, 'Focus on writing');
		assert.equal(wasClosed(), 1, 'modal closes the moment send is clicked, before the bridge settles');
		assert.equal(sent.length, 0, 'adapter send has not settled synchronously');
		await settle();
		assert.equal(wasClosed(), 1, 'no second close after the send settles');
		assert.deepEqual(sent, ['/tidy-inbox\n\nFocus on writing'], 'typed input reached the agent');
	}

	// Cancel closes without sending anything.
	{
		const sent: string[] = [];
		const { modal, wasClosed } = openedModal(copilotApp(sent));
		const footer = findByClass(modal.contentEl as unknown as El, 'dashboard-modal-footer')[0]!;
		(footer.children as El[])[0]!.click();
		assert.equal(wasClosed(), 1, 'cancel closes the modal');
		assert.equal(sent.length, 0, 'nothing sent without the confirm button');
	}

	// A failed bridge still reports through Notices after the modal is gone.
	{
		noticeMessages().length = 0;
		const { modal, wasClosed } = openedModal(copilotApp([], true));
		typeAndSend(modal, 'Anything');
		assert.equal(wasClosed(), 1, 'failed send still closed the modal immediately');
		await settle();
		assert.ok(noticeMessages().some(m => m.includes('tidy-inbox') || m.length > 0), 'failure surfaced via Notice');
	}
}

async function main(): Promise<void> {
	widgetRender();
	await modalBehavior();
	// The guarded dispatch races a 10s timeout whose timer would keep Node
	// alive pointlessly after every assertion has passed.
	process.exit(0);
}

main().catch(error => { console.error(error); process.exit(1); });
