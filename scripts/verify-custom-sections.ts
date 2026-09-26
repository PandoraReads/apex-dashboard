import assert from 'node:assert/strict';
import { generateDefaultMarkdown, parse, serialize } from '../src/parser';
import { registerSectionDefinition, registeredSectionDefinitions } from '../src/section-registry';

const definition = {
	id: 'test-plugin:example',
	label: 'Example',
	icon: 'book-open',
	defaultName: 'Example',
	render: () => undefined,
};
const unregister = registerSectionDefinition(definition);
assert.equal(registeredSectionDefinitions().some(item => item.id === definition.id), true);
assert.throws(() => registerSectionDefinition(definition), /already registered/);
unregister();
assert.equal(registeredSectionDefinitions().some(item => item.id === definition.id), false);
assert.throws(() => registerSectionDefinition({ ...definition, id: 'not-namespaced' }), /must be namespaced/);

const data = parse(generateDefaultMarkdown());
data.columns = [{
	name: 'Example',
	color: '#6366f1',
	sectionType: 'test-plugin:example',
	extensionConfig: { query: 'hello: 世界', options: { enabled: true, count: 3 } },
	cards: [],
}];

const serialized = serialize(data);
const restored = parse(serialized).columns[0]!;
assert.equal(restored.sectionType, 'test-plugin:example', 'unregistered section ID survives parsing');
assert.deepEqual(restored.extensionConfig, data.columns[0]!.extensionConfig, 'custom config survives the Markdown round-trip');
assert.equal(serialize(parse(serialized)), serialized, 'custom section Markdown is stable');

console.log('custom sections: PASS');
