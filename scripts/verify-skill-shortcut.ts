import { strict as assert } from 'node:assert';
import type { App } from 'obsidian';
import { El } from './mini-dom';
import { SkillWidgetConfigModal } from '../src/skill-widget-config-modal';
import { SkillCardButtonsModal } from '../src/skill-card-buttons-modal';
import { QuickNoteConfigModal } from '../src/quick-note-config-modal';
import { DEFAULT_SETTINGS, type SkillShortcut } from '../src/types';
import { parse, serialize } from '../src/parser';
import { getAgentAdapter } from '../src/agent-dispatch';
(globalThis as Record<string, unknown>).activeDocument = { querySelector: () => null };
const skill: SkillShortcut = { id: 'g', label: 'Grok', icon: 'bot', target: 'grokbot', skillName: 'daily', promptTemplate: '{skill}' };
const plugin = { settings: { ...DEFAULT_SETTINGS, skillShortcuts: [skill], skillWidgetButtons: [skill] }, saveSettings: async () => {} };
const modals = [new SkillWidgetConfigModal({} as App, plugin as never), new QuickNoteConfigModal({} as App, plugin as never), new SkillCardButtonsModal({} as App, 'daily', [{ id: 'g', label: '', icon: '', agent: 'grokbot', promptTemplate: '' }], () => {})];
for (const modal of modals) {
 modal.onOpen();
 const options = (modal.contentEl as unknown as El).querySelectorAll('option');
 assert(options.some(option => option.getAttribute('value') === 'grokbot' && option.textContent === 'Grok Bot'), 'each skill-button picker offers Grok Bot');
}
const markdown = '---\ncolumns:\n  - name: Projects\n    type: pm\n    pm:\n      rootFolder: Projects\n      skills:\n        - {id: g, label: Grok, agent: grokbot, skillName: daily}\n  - name: Workflow\n    type: pipeline\n    pipeline:\n      rootFolder: Content\n      skills:\n        - {id: g, label: Grok, stage: Draft, agent: grokbot, skillName: daily}\n  - name: Skills\n    type: skills\n    skills:\n      cardButtons:\n        daily:\n          - {id: g, agent: grokbot}\n---\n## Projects\n## Workflow\n## Skills\n';
const board = parse(serialize(parse(markdown)));
assert.equal(board.columns[0]?.pmConfig?.skills?.[0]?.agent, 'grokbot');
assert.equal(board.columns[1]?.pipelineConfig?.skills?.[0]?.agent, 'grokbot');
assert.equal(board.columns[2]?.skillsConfig?.cardButtons?.daily?.[0]?.agent, 'grokbot');
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async (text: string) => { (globalThis as Record<string, unknown>).copiedPrompt = text; } } } });
(globalThis as Record<string, unknown>).window = { require: (module: string) => module === 'fs'
 ? { existsSync: () => true }
 : module === 'child_process' ? { spawn: (command: string, args: string[]) => {
  (globalThis as Record<string, unknown>).launchedApp = [command, ...args].join(' ');
  return { unref: () => {} };
 } } : {} };
void getAgentAdapter('grokbot').send({}, 'Use the skill "daily".').then(() => {
 assert.equal((globalThis as Record<string, unknown>).copiedPrompt, 'Use the skill "daily".');
 assert.equal((globalThis as Record<string, unknown>).launchedApp, 'open -a Grok Bot');
 process.stdout.write('Skill shortcut assertions passed\n');
});
