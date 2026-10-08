import { strict as assert } from 'node:assert';
import { AgentBridgeError, agentPickerOption, agentTargets, buildAgentPrompt, codexConversationUrl, getAgentAdapter, workbuddyTaskUrl } from '../src/agent-dispatch';

async function main(): Promise<void> {
	assert.deepEqual(agentTargets(), ['claudian', 'copilot', 'codex', 'zcode', 'workbuddy']);
	// zcode pastes into its own agent GUI: token style follows Claudian's $name.
	assert.equal(buildAgentPrompt({ skillName: 's', promptTemplate: '{skill}' }, { input: '' }, 'zcode'), '$s');
	const spec = { skillName: 'start-my-day', promptTemplate: '{skill}\n\n{input}' };
	assert.equal(buildAgentPrompt(spec, { input: 'Focus on writing' }, 'claudian'), '$start-my-day\n\nFocus on writing');
	assert.equal(buildAgentPrompt(spec, { input: 'Focus on writing' }, 'copilot'), '/start-my-day\n\nFocus on writing');
	assert.equal(buildAgentPrompt(spec, { input: 'Focus on writing' }, 'codex'), '$start-my-day\n\nFocus on writing');
	assert.equal(buildAgentPrompt(spec, { input: 'Focus on writing' }, 'workbuddy'), '$start-my-day\n\nFocus on writing');
	assert.equal(buildAgentPrompt({ ...spec, promptTemplate: '$start-my-day\n\n{input}' }, { input: '' }, 'copilot'), '/start-my-day');
	assert.equal(buildAgentPrompt({ ...spec, skillName: '', promptTemplate: '' }, { input: 'Hello' }, 'copilot'), 'Hello');
	const codexUrl = new URL(codexConversationUrl('$start-my-day\n\nFocus & write', '/Users/Rae/My Vault'));
	assert.equal(codexUrl.protocol, 'codex:');
	assert.equal(codexUrl.hostname, 'threads');
	assert.equal(codexUrl.pathname, '/new');
	assert.equal(codexUrl.searchParams.get('prompt'), '$start-my-day\n\nFocus & write');
	assert.equal(codexUrl.searchParams.get('path'), '/Users/Rae/My Vault');

	// WorkBuddy task deep link: the leading $skill invocation rides as a
	// skill-chip phrase block inside promptContentBlocks and the rest as the
	// prompt — ONE prefill emission, so WorkBuddy's single-value intent
	// subject can never drop the typed input on cold start (the old
	// skills-param path re-emitted skills-only and replaced the prompt).
	const wbUrl = new URL(workbuddyTaskUrl('$start-my-day\n\nFocus & write', '/Users/Rae/My Vault'));
	assert.equal(wbUrl.protocol, 'workbuddy:');
	assert.equal(wbUrl.hostname, 'task');
	assert.equal(wbUrl.searchParams.get('action'), 'start');
	assert.equal(wbUrl.searchParams.get('skills'), null, 'skills param dropped (race source)');
	assert.equal(wbUrl.searchParams.get('prompt'), 'Focus & write');
	assert.equal(wbUrl.searchParams.get('cwd'), '/Users/Rae/My Vault');
	const wbBlocks = JSON.parse(wbUrl.searchParams.get('promptContentBlocks') ?? '[]') as Array<Record<string, unknown>>;
	assert.equal(wbBlocks.length, 1, 'one chip block for the invocation');
	assert.equal(wbBlocks[0]!.type, 'resource_link');
	assert.equal(wbBlocks[0]!.uri, 'skill://start-my-day');
	assert.equal((wbBlocks[0]!._meta as Record<string, unknown>).mentionType, 'skill');
	assert.equal((wbBlocks[0]!._meta as Record<string, unknown>).displayAsPhrase, true);
	const wbSkillOnly = new URL(workbuddyTaskUrl('$clean-vault'));
	assert.equal(wbSkillOnly.searchParams.get('prompt'), null, 'no placeholder text needed');
	assert.equal(wbSkillOnly.searchParams.get('skills'), null);
	const skillOnlyBlocks = JSON.parse(wbSkillOnly.searchParams.get('promptContentBlocks') ?? '[]') as Array<Record<string, unknown>>;
	assert.equal(skillOnlyBlocks[0]!.uri, 'skill://clean-vault', 'parser satisfied by blocks alone');
	// No invocation: everything stays prompt-shaped; first lines that merely
	// START with $ (prices, math) are never mistaken for invocations.
	const wbPlain = new URL(workbuddyTaskUrl('$100 budget\nsecond line'));
	assert.equal(wbPlain.searchParams.get('skills'), null);
	assert.equal(wbPlain.searchParams.get('promptContentBlocks'), null);
	assert.equal(wbPlain.searchParams.get('prompt'), '$100 budget\nsecond line');
	// Over-long prompts truncate at WorkBuddy's documented 8000-char cap.
	const wbLong = new URL(workbuddyTaskUrl('x'.repeat(9000)));
	assert.equal(wbLong.searchParams.get('prompt')!.length, 8000);
	// Prefill vs clipboard wording drives off the adapter kind, and WorkBuddy
	// is a deep link like Codex (not a clipboard bridge like ZCode).
	assert.equal(getAgentAdapter('workbuddy').kind, 'deep-link');
	assert.equal(getAgentAdapter('workbuddy').label, 'WorkBuddy (new task)');
	assert.equal(getAgentAdapter('zcode').kind, 'clipboard-app');
	// ZCode has no conversation deep link yet: pickers grey the option out
	// with the coming-soon suffix while legacy zcode skills keep working.
	assert.equal(agentPickerOption('zcode').disabled, true, 'zcode unselectable');
	assert.equal(agentPickerOption('zcode').label, 'ZCode（即将上线）');
	for (const target of agentTargets()) {
		if (target !== 'zcode') {
			assert.equal(agentPickerOption(target).disabled, false, `${target} stays selectable`);
			assert.ok(!agentPickerOption(target).label.includes('即将上线'), `${target} carries no suffix`);
		}
	}

	const sent: string[] = [];
	let activated = 0;
	let ready = false;
	const adapter = getAgentAdapter('copilot');
	const app = {
		plugins: { plugins: { copilot: {
			activateAgentView: async () => { activated += 1; },
			agentSessionManager: {
				getOrCreateActiveSession: async () => ({
					ready: Promise.resolve().then(() => { ready = true; }),
					getStatus: () => 'ready',
				}),
				getActiveChatUIState: () => ({
					isTurnInFlight: () => false,
					sendMessage: (text: string) => { assert.equal(ready, true); sent.push(text); return { id: 'message-1' }; },
				}),
			},
		} } },
	};
	await adapter.send(app, '/start-my-day\n\nFocus');
	assert.equal(activated, 1);
	assert.deepEqual(sent, ['/start-my-day\n\nFocus']);

	await assert.rejects(adapter.send({ plugins: { plugins: {} } }, 'hello'),
		(error: unknown) => error instanceof AgentBridgeError && error.code === 'missing');
	await assert.rejects(adapter.send({ plugins: { plugins: { copilot: {
		activateAgentView: async () => {}, agentSessionManager: {
			getOrCreateActiveSession: async () => ({ getStatus: () => 'running' }),
			getActiveChatUIState: () => ({ isTurnInFlight: () => true, sendMessage: () => ({ id: 'x' }) }),
		},
	} } } }, 'hello'),
		(error: unknown) => error instanceof AgentBridgeError && error.code === 'busy');
}

void main();
