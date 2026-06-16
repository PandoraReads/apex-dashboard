import { LOVE_STICKS } from './data/fortune-love';
import { CAREER_STICKS } from './data/fortune-career';
import { STUDY_STICKS } from './data/fortune-study';
import { HEALTH_STICKS } from './data/fortune-health';
import { RELATIONSHIP_STICKS } from './data/fortune-relationship';
import { WEALTH_STICKS } from './data/fortune-wealth';

export type FortuneCategory = 'love' | 'career' | 'study' | 'health' | 'relationship' | 'wealth';

export interface FortuneCategoryOption {
	readonly key: FortuneCategory;
	readonly label: string;
	readonly emoji: string;
}

export const FORTUNE_CATEGORIES: readonly FortuneCategoryOption[] = [
	{ key: 'love', label: '爱情', emoji: '\u{1F48C}' },
	{ key: 'career', label: '事业', emoji: '\u{1F680}' },
	{ key: 'study', label: '学业', emoji: '\u{1F4DA}' },
	{ key: 'health', label: '健康', emoji: '\u{1F33F}' },
	{ key: 'relationship', label: '关系', emoji: '\u{1F91D}' },
	{ key: 'wealth', label: '财运', emoji: '\u{1F4B0}' },
];

export interface FortuneStick {
	readonly level: 'super' | 'good' | 'medium';
	readonly title: string;
	readonly category: FortuneCategory;
	readonly verse: string;
	readonly interpretation: string;
}

const FORTUNE_STICKS: readonly FortuneStick[] = [
	...LOVE_STICKS,
	...CAREER_STICKS,
	...STUDY_STICKS,
	...HEALTH_STICKS,
	...RELATIONSHIP_STICKS,
	...WEALTH_STICKS,
];

export function drawFortuneStick(category: FortuneCategory): FortuneStick {
	const today = new Date();
	const seed = today.getFullYear() * 10000
		+ (today.getMonth() + 1) * 100
		+ today.getDate()
		+ hashCategory(category);

	const levelRoll = ((seed * 2654435761) >>> 0) % 100;
	const level: FortuneStick['level'] = levelRoll < 20 ? 'super' : levelRoll < 60 ? 'good' : 'medium';

	const sticks = FORTUNE_STICKS.filter(s => s.level === level && s.category === category);
	
	// Fallback to all sticks in category if level has no sticks (should not happen with complete datasets)
	const availableSticks = sticks.length > 0 
		? sticks 
		: FORTUNE_STICKS.filter(s => s.category === category);

	const index = (((seed * 40503) + 12345) >>> 0) % availableSticks.length;
	return availableSticks[index]!;
}

function hashCategory(category: FortuneCategory): number {
	const codes: Record<FortuneCategory, number> = {
		love: 100000,
		career: 200000,
		study: 300000,
		health: 400000,
		relationship: 500000,
		wealth: 600000,
	};
	return codes[category];
}
