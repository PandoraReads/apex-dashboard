import {
	type FortuneCategory,
	type FortuneStick,
	FORTUNE_CATEGORIES,
	drawFortuneStick,
} from './fortune-stick';
import { t } from './i18n';

export class FortuneStickModal {
	private stick: FortuneStick | null = null;
	private selectedCategory: FortuneCategory | null = null;
	private overlay: HTMLElement | null = null;
	private handleKeydown: ((e: KeyboardEvent) => void) | null = null;

	public open(): void {
		this.overlay = activeDocument.body.createDiv({ cls: 'fortune-overlay' });

		// Click overlay (outside card) to close
		this.overlay.addEventListener('click', (e) => {
			if (e.target === this.overlay) {
				this.close();
			}
		});

		// Escape key to close
		this.handleKeydown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				this.close();
			}
		};
		activeDocument.addEventListener('keydown', this.handleKeydown);

		this.renderCategorySelection();
	}

	public close(): void {
		if (this.handleKeydown) {
			activeDocument.removeEventListener('keydown', this.handleKeydown);
			this.handleKeydown = null;
		}
		if (this.overlay) {
			this.overlay.remove();
			this.overlay = null;
		}
		this.stick = null;
		this.selectedCategory = null;
	}

	private renderCategorySelection(): void {
		if (!this.overlay) return;
		this.overlay.empty();

		const card = this.overlay.createDiv({ cls: 'fortune-card' });

		const title = card.createDiv({ cls: 'fortune-card-title' });
		title.setText(t('fortune.title'));

		card.createDiv({
			cls: 'fortune-card-subtitle',
			text: t('fortune.chooseCategory'),
		});

		const grid = card.createDiv({ cls: 'fortune-category-grid' });

		for (const cat of FORTUNE_CATEGORIES) {
			const btn = grid.createDiv({ cls: 'fortune-category-btn' });
			btn.createSpan({ cls: 'fortune-category-emoji', text: cat.emoji });
			btn.createSpan({ cls: 'fortune-category-label', text: t(`fortune.category.${cat.key}`) });

			btn.addEventListener('click', () => {
				this.selectedCategory = cat.key;
				this.stick = drawFortuneStick(cat.key);
				this.renderFortuneResult();
			});
		}
	}

	private renderFortuneResult(): void {
		if (!this.stick || !this.overlay) return;
		this.overlay.empty();

		const card = this.overlay.createDiv({ cls: 'fortune-card fortune-card--result' });

		// Category tag: absolute top-right
		card.createDiv({
			cls: 'fortune-result-category',
			text: this.getCategoryEmoji(this.stick.category) + ' ' + this.getCategoryLabel(this.stick.category),
		});

		// Flip container
		const flipContainer = card.createDiv({ cls: 'fortune-flip-container' });
		const flipCard = flipContainer.createDiv({ cls: 'fortune-flip-card' });

		// === Front face ===
		const front = flipCard.createDiv({ cls: 'fortune-flip-front' });

		const header = front.createDiv({ cls: 'fortune-result-header' });
		const seal = header.createDiv({
			cls: `fortune-result-seal fortune-result-seal--${this.stick.level}`,
		});
		const titleText = this.stick.title;
		const midIdx = Math.ceil(titleText.length / 2);
		seal.createSpan({ text: titleText.slice(0, midIdx) });
		seal.createEl('br');
		seal.createSpan({ text: titleText.slice(midIdx) });

		front.createDiv({ cls: 'fortune-result-divider' });

		// Verse with typewriter effect
		const verseEl = front.createDiv({ cls: 'fortune-result-verse' });
		const verseLen = [...this.stick.verse].length;
		this.typewriterVerse(verseEl, this.stick.verse);

		// Reveal (flip) button - hidden until verse finishes
		const verseTotalMs = (0.6 + (verseLen - 1) * 0.08 + 0.3) * 1000;
		const revealBtn = front.createDiv({
			cls: 'fortune-result-reveal-btn fortune-result-reveal-btn--hidden',
			text: t('fortune.reveal'),
		});

		window.setTimeout(() => {
			revealBtn.classList.remove('fortune-result-reveal-btn--hidden');
			revealBtn.classList.add('fortune-result-reveal-btn--show');
		}, verseTotalMs);

		revealBtn.addEventListener('click', () => {
			flipCard.classList.add('fortune-flip-card--flipped');
		});

		// === Back face ===
		const back = flipCard.createDiv({ cls: 'fortune-flip-back' });

		back.createDiv({
			cls: 'fortune-back-title',
			text: t('fortune.reveal'),
		});

		const interpretationEl = back.createDiv({
			cls: 'fortune-back-interpretation',
		});
		interpretationEl.createSpan({ text: this.stick.interpretation });

		const backBtn = back.createDiv({
			cls: 'fortune-result-back-btn',
			text: t('fortune.drawAgain'),
		});

		backBtn.addEventListener('click', () => {
			this.stick = null;
			this.selectedCategory = null;
			this.renderCategorySelection();
		});
	}

	private typewriterVerse(container: HTMLElement, text: string): void {
		const chars = [...text];
		chars.forEach((char, i) => {
			const span = container.createSpan({
				cls: 'fortune-verse-char',
				text: char,
			});
			span.style.animationDelay = `${0.6 + i * 0.08}s`;
		});
	}

	private getCategoryEmoji(category: FortuneCategory): string {
		const found = FORTUNE_CATEGORIES.find(c => c.key === category);
		return found ? found.emoji : '';
	}

	private getCategoryLabel(category: FortuneCategory): string {
		const found = FORTUNE_CATEGORIES.find(c => c.key === category);
		return found ? t(`fortune.category.${found.key}`) : '';
	}
}
