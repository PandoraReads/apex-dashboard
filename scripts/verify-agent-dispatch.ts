import { strict as assert } from 'node:assert';
import { AgentBridgeError, agentPickerOption, agentTargets, buildAgentPrompt, codexConversationUrl, ensureSelectionPaths, getAgentAdapter, launchAndPasteScript, terminalClientCommand, workbuddyTaskUrl } from '../src/agent-dispatch';

async function main(): Promise<void> {
	assert.deepEqual(agentTargets(), ['claudian', 'copilot', 'codex', 'zcode', 'workbuddy', 'grokbot', 'deepseek', 'kimi', 'hermes']);
	assert.equal(getAgentAdapter('grokbot').kind, 'clipboard-app');
	assert.equal(buildAgentPrompt({ skillName: 'daily', promptTemplate: '{skill}' }, {}, 'grokbot'), 'Use the skill "daily".');
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

	// DeepSeek Harness: clipboard bridge (app.asar ships dsh://open only — no
	// prompt deep link), selectable like Grok Bot rather than greyed like ZCode.
	// Launch is followed by an auto-paste (System Events Cmd+V scoped to the
	// app) so the composer comes up prefilled — paste ONLY, never Send.
	assert.equal(getAgentAdapter('deepseek').kind, 'clipboard-app');
	assert.equal(getAgentAdapter('deepseek').comingSoon, undefined);
	const dshPaste = launchAndPasteScript('com.deepseek.dsh', 'DeepSeek Harness');
	assert.ok(dshPaste.includes('tell application id "com.deepseek.dsh" to activate'), 'paste script activates the app by id');
	assert.ok(dshPaste.includes('keystroke "v" using command down'), 'paste script presses Cmd+V');
	assert.equal(dshPaste.match(/keystroke/g)?.length, 1, 'exactly one keystroke');
	assert.ok(dshPaste.includes('frontmost of process "DeepSeek Harness"'), 'keystroke is gated on the target process being frontmost');
	assert.ok(!/click|key code/.test(dshPaste), 'paste script never presses Send (no clicks / key codes)');
	// Kimi / Hermes are terminal agents: the prompt rides the clipboard and
	// their OWN interactive client opens — the user pastes and sends. The
	// bridge must never auto-submit a turn (paid/metered run without review).
	assert.equal(getAgentAdapter('kimi').kind, 'terminal');
	assert.equal(getAgentAdapter('hermes').kind, 'terminal');
	assert.equal(terminalClientCommand('kimi', '/usr/local/bin/kimi'), `'/usr/local/bin/kimi'`, 'kimi opens the bare interactive TUI');
	assert.equal(terminalClientCommand('hermes', '/usr/local/bin/hermes'), `'/usr/local/bin/hermes' chat`, 'hermes opens the bare interactive client');
	for (const cmd of [terminalClientCommand('kimi', 'kimi'), terminalClientCommand('hermes', 'hermes')]) {
		assert.ok(!/(^|\s)(-p|-q|--query|--query-file)(\s|$)/.test(cmd), 'terminal bridge never auto-submits a turn');
	}
	assert.equal(buildAgentPrompt(spec, { input: 'Focus on writing' }, 'kimi'), '$start-my-day\n\nFocus on writing');
	assert.equal(buildAgentPrompt(spec, { input: 'Focus on writing' }, 'hermes'), '$start-my-day\n\nFocus on writing');

	// Whole-selection guarantee (Rae's material multi-select report): a custom
	// template referencing only {path} used to carry the FIRST pick and drop
	// the rest. ensureSelectionPaths backfills the full list under a heading
	// when any selected path is missing from the rendered prompt.
	{
		const picked = ['素材/a.png', '素材/b.png', '素材/c.mp4'];
		const singular = buildAgentPrompt(
			{ skillName: 'pandora-idea2topics', promptTemplate: '读取文件 {path}，按技能执行拆解' },
			{ path: picked[0]!, paths: picked.map(p => `- ${p}`).join('\n'), count: '3', input: '' },
			'claudian',
		);
		assert.ok(singular.includes(picked[0]!), 'first pick rides the template');
		assert.ok(!singular.includes(picked[1]!), 'custom {path} template drops the rest (the bug)');
		const fixed = ensureSelectionPaths(singular, picked, '选中素材：');
		assert.ok(fixed.includes(picked[1]!) && fixed.includes(picked[2]!), 'every pick reaches the agent after the guarantee');
		assert.ok(fixed.includes('选中素材：\n- 素材/a.png\n- 素材/b.png\n- 素材/c.mp4'), 'the full list rides under the heading');
		// {paths} templates already carry everything: byte-identical, no duplicate list.
		const complete = buildAgentPrompt(
			{ skillName: 'start-my-day', promptTemplate: '{skill}\n\n{paths}' },
			{ paths: picked.map(p => `- ${p}`).join('\n'), count: '3', input: '' },
			'claudian',
		);
		assert.equal(ensureSelectionPaths(complete, picked, '选中素材：'), complete, 'no-op when every path is present');
		// Empty selection and empty-string paths stay untouched.
		assert.equal(ensureSelectionPaths(complete, [], '选中素材：'), complete, 'no selection, no change');
		// Single pick already referenced: no duplicate either.
		const single = buildAgentPrompt({ skillName: 's', promptTemplate: '处理 {path}' }, { path: picked[0]!, input: '' }, 'claudian');
		assert.equal(ensureSelectionPaths(single, [picked[0]!], '选中素材：'), single, 'single referenced pick untouched');
	}
	// Outside a desktop renderer (no window.require / clipboard) the terminal
	// bridge and the CLI probe fail closed instead of throwing.
	assert.equal(getAgentAdapter('kimi').isAvailable({}), false);
	assert.equal(getAgentAdapter('hermes').isAvailable({}), false);
	await assert.rejects(getAgentAdapter('kimi').send({}, 'hello'),
		(error: unknown) => error instanceof AgentBridgeError && error.code === 'unsupported');
	await assert.rejects(getAgentAdapter('hermes').send({}, 'hello'),
		(error: unknown) => error instanceof AgentBridgeError && error.code === 'unsupported');
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

	// Claudian 2.3.19 moved activateView/getView onto plugin.views; the bridge
	// resolves that surface first and still delivers through the active tab's
	// inputController.sendMessage({ content }).
	const claudian = getAgentAdapter('claudian');
	function claudianApp(pluginShape: Record<string, unknown>) {
		return { plugins: { plugins: { realclaudian: pluginShape } } };
	}
	function claudianTab(overrides: Record<string, unknown> = {}) {
		return {
			state: { isStreaming: false },
			controllers: { inputController: {
				isPreparingMainTurn: false,
				sendMessage: async (options: { content: string }) => { claudianDelivered.push(options); },
			} },
			...overrides,
		};
	}
	let claudianDelivered: Array<{ content: string }> = [];
	let claudianActivated = 0;
	const modernTab = claudianTab();
	const modernShape = {
		views: {
			activateView: async () => { claudianActivated += 1; },
			getView: () => ({ getActiveTab: () => modernTab }),
		},
	};
	assert.equal(claudian.isAvailable(claudianApp(modernShape)), true, '2.3 shape available');
	await claudian.send(claudianApp(modernShape), '$start-my-day\n\nFocus');
	assert.equal(claudianActivated, 1);
	assert.deepEqual(claudianDelivered, [{ content: '$start-my-day\n\nFocus' }]);

	// Legacy shape (Claudian <= 2.2, methods on the plugin itself) still sends.
	claudianDelivered = [];
	const legacyTab = claudianTab();
	const legacyShape = {
		activateView: async () => { claudianActivated += 1; },
		getView: () => ({ getActiveTab: () => legacyTab }),
	};
	assert.equal(claudian.isAvailable(claudianApp(legacyShape)), true, 'legacy shape available');
	await claudian.send(claudianApp(legacyShape), 'hello');
	assert.deepEqual(claudianDelivered, [{ content: 'hello' }]);

	// Neither surface: the fail-closed unsupported error the error modal maps to.
	assert.equal(claudian.isAvailable(claudianApp({})), false);
	await assert.rejects(claudian.send(claudianApp({ someOtherApi: true }), 'hello'),
		(error: unknown) => error instanceof AgentBridgeError && error.code === 'unsupported');
	// Streaming and turn-preparation both read as busy.
	const streamingShape = {
		views: { activateView: async () => {}, getView: () => ({ getActiveTab: () => claudianTab({ state: { isStreaming: true } }) }) },
	};
	await assert.rejects(claudian.send(claudianApp(streamingShape), 'hello'),
		(error: unknown) => error instanceof AgentBridgeError && error.code === 'busy');
	const preparingShape = {
		views: { activateView: async () => {}, getView: () => ({ getActiveTab: () => ({
			state: { isStreaming: false },
			controllers: { inputController: { isPreparingMainTurn: true, sendMessage: async () => {} } },
		}) }) },
	};
	await assert.rejects(claudian.send(claudianApp(preparingShape), 'hello'),
		(error: unknown) => error instanceof AgentBridgeError && error.code === 'busy');
	// View present but no tab yet: chat-not-ready, not unsupported.
	await assert.rejects(claudian.send(claudianApp({ views: { activateView: async () => {}, getView: () => null } }), 'hello'),
		(error: unknown) => error instanceof AgentBridgeError && error.code === 'chat');
}

void main();
