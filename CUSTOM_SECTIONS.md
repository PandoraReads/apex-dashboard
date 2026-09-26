# Custom dashboard sections

Apex Dashboard lets other Obsidian plugins register section renderers. A custom
section is rendered inside its own container and can persist JSON-compatible
configuration with the dashboard file.

## Register a section

Register from the contributing plugin's `onload` and call the returned function
from `onunload`:

```ts
import { App, Plugin, Notice } from 'obsidian';

interface ApexSectionContext {
  app: App;
  container: HTMLElement;
  column: { name: string; sectionType?: string };
  config: Record<string, unknown>;
  setConfig(config: Record<string, unknown>): void;
}

interface ApexSectionDefinition {
  id: string;
  label: string;
  icon: string;
  defaultName: string;
  render(context: ApexSectionContext): void | (() => void) | Promise<void | (() => void)>;
}

interface ApexSectionHost {
  registerSection(definition: ApexSectionDefinition): () => void;
}

export default class ReadingPlugin extends Plugin {
  private unregisterSection?: () => void;

  onload(): void {
    const plugins = (this.app as App & {
      plugins?: { plugins?: Record<string, unknown> };
    }).plugins?.plugins;
    const apex = plugins?.['apex-dashboard'] as ApexSectionHost | undefined;
    if (!apex?.registerSection) {
      new Notice('Enable Apex Dashboard before this plugin to use its section.');
      return;
    }

    this.unregisterSection = apex.registerSection({
      id: 'reading-plugin:reading-list',
      label: 'Reading list',
      icon: 'book-open',
      defaultName: 'Reading list',
      render: ({ container, config, setConfig }) => {
        const button = container.createEl('button', { text: 'Refresh' });
        button.addEventListener('click', () => setConfig({ ...config, refreshedAt: Date.now() }));
        container.createDiv({ text: `Last refreshed: ${String(config.refreshedAt ?? 'never')}` });
        return () => button.remove();
      },
    });
  }

  onunload(): void {
    this.unregisterSection?.();
  }
}
```

Use a stable, namespaced ID (`plugin-id:section-id`) so section types do not
collide with Apex or other plugins. `label`, `icon`, and `defaultName` appear in
the add-section picker. The `render` callback receives the Obsidian app, a
section container, its dashboard column, and the section's saved configuration.
Call `setConfig` when a user changes configuration; values must be JSON
compatible. Return a cleanup function when rendering creates timers or external
subscriptions. The cleanup runs when Apex replaces the view or the section is
unregistered.

If the contributing plugin is disabled, Apex preserves the section type and
configuration in the dashboard file and shows an enable-plugin placeholder.
The section becomes available again when the contributing plugin registers it.

The API is a JavaScript runtime contract on the Apex plugin instance. TypeScript
consumers can use the small interface shown above until Apex publishes a
separate type package.
