import { strict as assert } from 'node:assert';
import { AgentBridgeError, agentTargets, buildAgentPrompt, codexConversationUrl, getAgentAdapter } from '../src/agent-dispatch';

async function main(): Promise<void> {
	assert.deepEqual(agentTargets(), ['claudian', 'copilot', 'codex', 'zcode']);
	// zcode pastes into its own agent GUI: token style follows Claudian's $name.
	assert.equal(buildAgentPrompt({ skillName: 's', promptTemplate: '{skill}' }, { input: '' }, 'zcode'), '$s');
	const spec = { skillName: 'start-my-day', promptTemplate: '{skill}\n\n{input}' };
	assert.equal(buildAgentPrompt(spec, { input: 'Focus on writing' }, 'claudian'), '$start-my-day\n\nFocus on writing');
	assert.equal(buildAgentPrompt(spec, { input: 'Focus on writing' }, 'copilot'), '/start-my-day\n\nFocus on writing');
	assert.equal(buildAgentPrompt(spec, { input: 'Focus on writing' }, 'codex'), '$start-my-day\n\nFocus on writing');
	assert.equal(buildAgentPrompt({ ...spec, promptTemplate: '$start-my-day\n\n{input}' }, { input: '' }, 'copilot'), '/start-my-day');
	assert.equal(buildAgentPrompt({ ...spec, skillName: '', promptTemplate: '' }, { input: 'Hello' }, 'copilot'), 'Hello');
	const codexUrl = new URL(codexConversationUrl('$start-my-day\n\nFocus & write', '/Users/Rae/My Vault'));
	assert.equal(codexUrl.protocol, 'codex:');
	assert.equal(codexUrl.hostname, 'threads');
	assert.equal(codexUrl.pathname, '/new');
	assert.equal(codexUrl.searchParams.get('prompt'), '$start-my-day\n\nFocus & write');
	assert.equal(codexUrl.searchParams.get('path'), '/Users/Rae/My Vault');

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
