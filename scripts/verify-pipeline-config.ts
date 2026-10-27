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
// LargeTextModal.onOpen defers focus through window.setTimeout (the prompt
// expand popup); mirror the render harness so the modal opens headless.
(globalThis as { window?: unknown }).window = globalThis;

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

	// ── Skill row: add, type label, then skill name ──
	buttonByText(root, '添加技能').click();
	const cards = findByClass(root, 'dashboard-pipeline-cfg-skill');
	assert.equal(cards.length, 1, 'one skill card after add');
	const inputs = findTag(cards[0]!, 'input') as Array<El & { value: string; checked?: boolean }>;
	// DOM order: [label (top row), skillName (mid), directSend checkbox
	// (send row)] — no per-skill placeholder field anymore.
	assert.equal(inputs.length, 3, 'label / skillName / directSend inputs');
	const label = inputs[0]!;
	const name = inputs[1]!;
	const directToggle = inputs[2]!;
	assert.equal(directToggle.getAttribute('type'), 'checkbox', 'per-skill direct-send toggle rendered');
	assert.equal(directToggle.checked, false, 'new skills default to the preview dialog');

	// The agent select greys ZCode out (no conversation deep link yet) while
	// every other target stays selectable.
	const agentSel = findTag(cards[0]!, 'select')
		.find(sel => sel.children.some(o => o.getAttribute('value') === 'zcode'))!;
	assert.ok(agentSel, 'agent select rendered');
	const zcodeOpt = agentSel.children.find(o => o.getAttribute('value') === 'zcode')!;
	assert.equal(zcodeOpt.disabled, true, 'ZCode option disabled in the picker');
	assert.equal(zcodeOpt.textContent, 'ZCode（即将上线）');
	const wbOpt = agentSel.children.find(o => o.getAttribute('value') === 'workbuddy')!;
	assert.equal(wbOpt.disabled, false, 'other targets stay selectable');

	label.value = '写草稿';
	label.dispatchEvent({ type: 'input' });
	name.value = 'write-draft';
	name.dispatchEvent({ type: 'input' });

	buttonByText(root, '保存').click();
	assert.equal(saved.length, 1, 'save accepted (no validation block)');
	const skill = saved[0]!.skills[0];
	assert.ok(skill, 'skill survived the save filter');
	// The exact regression: earlier edits must not be reverted by later ones.
	assert.equal(skill.label, '写草稿', 'label kept after editing skill name');
	assert.equal(skill.skillName, 'write-draft', 'skill name kept');
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

	// ── Skill row layout: agent select rides the NAME row as a narrow slot;
	//    the prompt expand button opens the full-text popup and edits stream
	//    back (Rae, 2026-10-19) ──
	const saved4: PipelineConfig[] = [];
	const modal4 = new PipelineConfigModal(stubApp as never, {
		rootFolder: '内容创作',
		statusField: 'status',
		stages: [{ value: 'idea', label: '选题', color: '#f59e0b' }],
		skills: [{
			id: 'e1', label: '长提示词', icon: 'sparkles', agent: 'codex', stage: 'idea', scope: 'card',
			skillName: 'demo', promptTemplate: '读取文件', directSend: false,
		}],
	}, config => saved4.push(config));
	modal4.onOpen();
	const root4 = modal4.contentEl as unknown as El;
	const skillCard = findByClass(root4, 'dashboard-pipeline-cfg-skill')[0]!;
	const nameRow = findByClass(skillCard, 'dashboard-pipeline-cfg-name-row')[0]!;
	const agentSelNarrow = findTag(nameRow, 'select')[0] as unknown as El & { value: string; dispatchEvent(ev: unknown): void };
	assert.ok(agentSelNarrow, 'agent select sits on the skill-name row');
	assert.ok((agentSelNarrow.className ?? '').includes('dashboard-pipeline-cfg-select--agent'), 'narrow agent slot class applied');
	// (mini-dom selects don't derive .value from selected options — the
	// prefill is covered by the earlier zcode block; here we just drive a
	// change through the narrow slot.)
	agentSelNarrow.value = 'claudian';
	agentSelNarrow.dispatchEvent({ type: 'change', target: agentSelNarrow });

	// Expand → tall popup textarea carries the full text; edits stream back
	// into the row state and the inline textarea.
	const expandBtn = findByClass(skillCard, 'dashboard-pipeline-cfg-prompt-expand')[0]!;
	assert.ok(expandBtn, 'prompt expand button rendered');
	expandBtn.click();
	const peek = (Modal as unknown as { last: Modal }).last as unknown as { contentEl: El; onOpen(): void };
	peek.onOpen();
	const peekArea = findByClass(peek.contentEl, 'dashboard-large-text')[0] as unknown as El & { value: string; dispatchEvent(ev: unknown): void };
	assert.equal(peekArea.value, '读取文件', 'popup prefills with the whole template');
	peekArea.value = '读取文件并生成小红书图文文案';
	peekArea.dispatchEvent({ type: 'input', target: peekArea });
	const inlineArea = findTag(skillCard, 'textarea')[0] as unknown as El & { value: string };
	assert.equal(inlineArea.value, '读取文件并生成小红书图文文案', 'inline textarea mirrors the popup edit live');

	buttonByText(root4, '保存').click();
	assert.equal(saved4[0]!.skills[0]!.agent, 'claudian', 'agent change from the narrow select persists');
	assert.equal(saved4[0]!.skills[0]!.promptTemplate, '读取文件并生成小红书图文文案', 'popup edit persists through save');

	// ── Action buttons: render, edit label→field (CURRENT-state patch),
	//    options textarea, incomplete-row drop, and save round-trip ──
	const savedAct: PipelineConfig[] = [];
	const modalAct = new PipelineConfigModal(stubApp as never, {
		rootFolder: '内容创作',
		statusField: 'status',
		stages: [{ value: 'review', label: '待审', color: '#8b5cf6' }],
		skills: [],
		actions: [{ id: 'act_1', label: '审核', icon: 'square-pen', field: '审核状态', options: ['通过', '驳回'] }],
	}, config => savedAct.push(config));
	modalAct.onOpen();
	const rootAct = modalAct.contentEl as unknown as El;
	const actionCards = findByClass(rootAct, 'dashboard-pipeline-cfg-action');
	assert.equal(actionCards.length, 1, 'existing action renders one card');
	// DOM order in the top row: label input, field input (icon/delete are buttons).
	const actInputs = findTag(actionCards[0]!, 'input') as Array<El & { value: string }>;
	assert.equal(actInputs.length, 2, 'label + field inputs');
	assert.equal(actInputs[0]!.value, '审核', 'label prefilled');
	assert.equal(actInputs[1]!.value, '审核状态', 'field prefilled');
	const actOptions = findTag(actionCards[0]!, 'textarea')[0] as unknown as El & { value: string; dispatchEvent(ev: unknown): void };
	assert.equal(actOptions.value, '通过\n驳回', 'options render one per line');

	// Edit label THEN field — the regression guard: a later edit must not
	// revert the earlier one (patchAction reads CURRENT state).
	actInputs[0]!.value = '内容审核';
	actInputs[0]!.dispatchEvent({ type: 'input' });
	actInputs[1]!.value = '审校状态';
	actInputs[1]!.dispatchEvent({ type: 'input' });
	actOptions.value = '通过\n驳回\n 待复审 \n通过\n\n';
	actOptions.dispatchEvent({ type: 'input' });

	// Add a second action but only fill its label → dropped on save.
	buttonByText(rootAct, '添加操作按钮').click();
	const actCards2 = findByClass(rootAct, 'dashboard-pipeline-cfg-action');
	assert.equal(actCards2.length, 2, 'add button appends an action row');
	const orphanInputs = findTag(actCards2[1]!, 'input') as Array<El & { value: string }>;
	orphanInputs[0]!.value = '半成品';
	orphanInputs[0]!.dispatchEvent({ type: 'input' });

	buttonByText(rootAct, '保存').click();
	assert.equal(savedAct.length, 1, 'action save accepted');
	const savedActions = savedAct[0]!.actions ?? [];
	assert.equal(savedActions.length, 1, 'incomplete action (no field/options) dropped');
	assert.equal(savedActions[0]!.label, '内容审核', 'label kept after field edit');
	assert.equal(savedActions[0]!.field, '审校状态', 'field kept after label edit');
	assert.deepEqual(savedActions[0]!.options, ['通过', '驳回', '待复审'], 'options trimmed + deduped, order kept');
	assert.equal(savedActions[0]!.icon, 'square-pen', 'icon survives');

	// ── Runtime state the modal never edits rides through a save ──
	// The regression: trySave built a from-scratch config, so every modal
	// save reset the sort mode to mtime and wiped the saved manual order +
	// rail filter — the "reordered cards scramble after editing config" bug.
	const savedRt: PipelineConfig[] = [];
	const modalRt = new PipelineConfigModal(stubApp as never, {
		rootFolder: '内容创作',
		statusField: 'status',
		stages: [{ value: 'idea', label: '选题', color: '#f59e0b' }],
		skills: [],
		sortBy: 'manual',
		stageOrder: { idea: ['内容创作/01-选题/b.md', '内容创作/01-选题/a.md'] },
		filter: { dim: 'platform', value: '公众号' },
	}, config => savedRt.push(config));
	modalRt.onOpen();
	const rootRt = modalRt.contentEl as unknown as El;
	// Touch an edited field too — carry-over must not depend on a pristine open.
	const rtLabel = (findTag(findByClass(rootRt, 'dashboard-pipeline-cfg-stage-row')[0]!, 'input') as Array<El & { value: string }>)[0]!;
	rtLabel.value = '灵感池';
	rtLabel.dispatchEvent({ type: 'input' });

	buttonByText(rootRt, '保存').click();
	assert.equal(savedRt.length, 1, 'runtime carry-over save accepted');
	assert.equal(savedRt[0]!.sortBy, 'manual', 'sort mode survives a modal save');
	assert.deepEqual(savedRt[0]!.stageOrder, { idea: ['内容创作/01-选题/b.md', '内容创作/01-选题/a.md'] }, 'saved manual order survives');
	assert.deepEqual(savedRt[0]!.filter, { dim: 'platform', value: '公众号' }, 'rail filter survives');
	assert.equal(savedRt[0]!.stages[0]!.label, '灵感池', 'the actual edit still lands');
}

main();
