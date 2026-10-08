import { strict as assert } from 'node:assert';
import { El, findByClass, findTag } from './mini-dom';
import { Modal } from 'obsidian';
import type { PipelineConfig } from '../src/types';
import { PipelineConfigModal } from '../src/pipeline-config-modal';

// Config modal interaction regression: field listeners must patch the row's
// CURRENT state, not the render-time snapshot. The original bug — spreading
// the captured object — silently reverted every field edited before the last
// one in a row, so a skill whose label was typed first and skill name second
// saved with an empty label and was dropped by the save filter ("skill
// button never saves"). Drives the real modal through mini-dom events.

(globalThis as Record<string, unknown>).createDiv = (o?: { cls?: string; text?: string }): El => {
	const el = new El('div');
	if (o?.cls) el.addClass(...o.cls.split(/\s+/));
	if (o?.text !== undefined) el.textContent = o.text;
	return el;
};
// applyModalTheme probes the document root for the dashboard theme scope.
(globalThis as { activeDocument?: unknown }).activeDocument = {
	querySelector: (): null => null,
};

function buttonByText(root: El, text: string): El {
	const btn = findTag(root, 'button').find(b => (b.textContent ?? '').includes(text));
	assert.ok(btn, `button "${text}" rendered`);
	return btn;
}

// VisiblePropertiesEditor scans the vault for frontmatter keys on open.
const stubApp = {
	vault: { getMarkdownFiles: (): unknown[] => [] },
	metadataCache: { getFileCache: (): null => null },
};

function main(): void {
	const saved: PipelineConfig[] = [];
	const modal = new PipelineConfigModal(stubApp as never, undefined, config => saved.push(config));
	modal.onOpen();
	const root = modal.contentEl as unknown as El;
	assert.ok(root, 'modal rendered');

	// ── Skill row: add, type label, then skill name, then placeholder ──
	buttonByText(root, '添加技能').click();
	const cards = findByClass(root, 'dashboard-pipeline-cfg-skill');
	assert.equal(cards.length, 1, 'one skill card after add');
	const inputs = findTag(cards[0]!, 'input') as Array<El & { value: string; checked?: boolean }>;
	// DOM order: [label (top row), skillName (mid), inputPlaceholder (mid),
	// directSend checkbox (send row)]
	assert.equal(inputs.length, 4, 'label / skillName / placeholder / directSend inputs');
	const label = inputs[0]!;
	const name = inputs[1]!;
	const placeholder = inputs[2]!;
	const directToggle = inputs[3]!;
	assert.equal(directToggle.getAttribute('type'), 'checkbox', 'per-skill direct-send toggle rendered');
	assert.equal(directToggle.checked, false, 'new skills default to the preview dialog');

	label.value = '写草稿';
	label.dispatchEvent({ type: 'input' });
	name.value = 'write-draft';
	name.dispatchEvent({ type: 'input' });
	placeholder.value = '侧重涨粉';
	placeholder.dispatchEvent({ type: 'input' });

	buttonByText(root, '保存').click();
	assert.equal(saved.length, 1, 'save accepted (no validation block)');
	const skill = saved[0]!.skills[0];
	assert.ok(skill, 'skill survived the save filter');
	// The exact regression: earlier edits must not be reverted by later ones.
	assert.equal(skill.label, '写草稿', 'label kept after editing skill name');
	assert.equal(skill.skillName, 'write-draft', 'skill name kept');
	assert.equal(skill.inputPlaceholder, '侧重涨粉', 'placeholder kept');
	assert.equal(skill.stage, 'idea', 'default stage binding');
	assert.equal(skill.scope, 'card', 'default scope');
	assert.equal(skill.directSend, false, 'preview default persisted per skill');

	// ── Per-skill direct send: toggle persists per button, and a legacy
	//    section-wide directSend resolves into every skill on load ──
	const savedDs: PipelineConfig[] = [];
	const legacy: PipelineConfig = {
		rootFolder: '内容创作',
		statusField: 'status',
		stages: [{ value: 'idea', label: '选题', color: '#f59e0b' }],
		skills: [
			{ id: 'a', label: '搜集选题', icon: 'sparkles', agent: 'claudian', stage: 'idea', scope: 'stage', skillName: 'gen-topics', promptTemplate: '' },
			{ id: 'b', label: '写草稿', icon: 'pencil', agent: 'copilot', stage: 'idea', scope: 'card', skillName: 'write-draft', promptTemplate: '', directSend: false },
		],
		directSend: true,
	};
	const modalDs = new PipelineConfigModal(stubApp as never, legacy, config => savedDs.push(config));
	modalDs.onOpen();
	const rootDs = modalDs.contentEl as unknown as El;
	const dsCards = findByClass(rootDs, 'dashboard-pipeline-cfg-skill');
	const toggles = dsCards.map(card => findTag(card, 'input').find(i => i.getAttribute('type') === 'checkbox')) as Array<El & { checked?: boolean }>;
	assert.equal(toggles.length, 2, 'one direct-send toggle per skill');
	assert.equal(toggles[0]!.checked, true, 'legacy section flag resolves to checked for skills without their own');
	assert.equal(toggles[1]!.checked, false, 'an explicit per-skill false survives the legacy flag');
	// Flip the first off, second on — per-skill independence on save.
	toggles[0]!.checked = false;
	toggles[0]!.dispatchEvent({ type: 'change' });
	toggles[1]!.checked = true;
	toggles[1]!.dispatchEvent({ type: 'change' });
	buttonByText(rootDs, '保存').click();
	assert.equal(savedDs[0]!.skills[0]!.directSend, false, 'skill 0 saved with directSend off');
	assert.equal(savedDs[0]!.skills[1]!.directSend, true, 'skill 1 saved with directSend on');
	assert.equal(savedDs[0]!.directSend, undefined, 'legacy section-wide flag no longer written');

	// ── Stage row: edit label, then folder — both must persist ──
	const saved2: PipelineConfig[] = [];
	const modal2 = new PipelineConfigModal(stubApp as never, undefined, config => saved2.push(config));
	modal2.onOpen();
	const root2 = modal2.contentEl as unknown as El;
	const stageRow = findByClass(root2, 'dashboard-pipeline-cfg-stage-row')[0]!;
	const stageInputs = findTag(stageRow, 'input') as Array<El & { value: string }>;
	const sLabel = stageInputs[0]!;
	const sFolder = stageInputs[2]!;
	sLabel.value = '灵感池';
	sLabel.dispatchEvent({ type: 'input' });
	sFolder.value = '00-灵感';
	sFolder.dispatchEvent({ type: 'input' });

	buttonByText(root2, '保存').click();
	assert.equal(saved2.length, 1, 'stage edit save accepted');
	assert.equal(saved2[0]!.stages[0]!.label, '灵感池', 'stage label kept after folder edit');
	assert.equal(saved2[0]!.stages[0]!.folder, '00-灵感', 'stage folder kept');

	// ── Empty-label skill rows are still dropped on purpose ──
	const saved3: PipelineConfig[] = [];
	const modal3 = new PipelineConfigModal(stubApp as never, undefined, config => saved3.push(config));
	modal3.onOpen();
	const root3 = modal3.contentEl as unknown as El;
	buttonByText(root3, '添加技能').click();
	// Type only the skill name, leave the label empty.
	const inputs3 = findTag(findByClass(root3, 'dashboard-pipeline-cfg-skill')[0]!, 'input') as Array<El & { value: string }>;
	inputs3[1]!.value = 'orphan-skill';
	inputs3[1]!.dispatchEvent({ type: 'input' });
	buttonByText(root3, '保存').click();
	assert.equal(saved3[0]!.skills.length, 0, 'unlabeled row dropped, name alone does not resurrect it');
}

main();
