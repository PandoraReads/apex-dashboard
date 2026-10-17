import {
  App,
  FuzzySuggestModal,
  MarkdownRenderChild,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  TFile,
} from "obsidian";
import Gantt from "frappe-gantt";
import {
  findGanttBlock,
  ganttBlocks,
  ganttPath,
  ganttReference,
  parseGantt,
  replaceGanttBlock,
  serializeGantt,
  type GanttEntry,
  type GanttReference,
  type GanttSchedule,
} from "./gantt-model";

/** Register through the host plugin's public APIs; no dashboard DOM interception. */
export function registerGantt(
  plugin: Plugin,
  addToDashboard: (ref: GanttReference, title: string) => Promise<void>,
): void {
  const charts = new Set<GanttChart>(),
    dialogs = new Set<Modal>();
  let active = true;
  const open = (modal: Modal): void => {
    dialogs.add(modal);
    const close = modal.onClose.bind(modal);
    modal.onClose = () => {
      dialogs.delete(modal);
      close();
    };
    modal.open();
  };
  plugin.register(() => {
    active = false;
    for (const chart of [...charts]) chart.unload();
    for (const dialog of [...dialogs]) dialog.close();
  });
  plugin.registerMarkdownCodeBlockProcessor("apex-gantt", (source, el, ctx) => {
    try {
      const reference = ganttReference(source);
      const path = ganttPath(reference?.note ?? ctx.sourcePath);
      const seed = reference
        ? JSON.stringify({ ganttId: reference.ganttId, tasks: [] })
        : source;
      parseGantt(seed);
      const chart = new GanttChart(
        el,
        plugin.app,
        path,
        seed,
        !!reference,
        open,
        addToDashboard,
      );
      charts.add(chart);
      chart.register(() => charts.delete(chart));
      ctx.addChild(chart);
    } catch (error) {
      el.setText(String(error));
    }
  });
  plugin.addCommand({
    id: "insert-gantt",
    name: "Insert chart in current note",
    editorCallback: (editor, info) => {
      if (!info.file) return;
      const data = {
        ganttId: crypto.randomUUID(),
        title: "Gantt",
        groups: [],
        tasks: [],
      };
      editor.replaceSelection(
        "\n```apex-gantt\n" + JSON.stringify(data, null, 2) + "\n```\n",
      );
    },
  });
  plugin.addCommand({
    id: "reference-gantt",
    name: "Reference a note chart in dashboard",
    callback: () => {
      open(
        new Picker(
          plugin.app,
          "Choose a project schedule note",
          plugin.app.vault.getMarkdownFiles(),
          (file) => file.path,
          async (file) => {
            const text =
              buffer(plugin.app, file)?.getValue() ??
              (await plugin.app.vault.read(file));
            const blocks = ganttBlocks(text).filter((block) => {
              try {
                return !ganttReference(block.body) && !!parseGantt(block.body);
              } catch {
                return false;
              }
            });
            if (!blocks.length)
              throw Error("This note has no valid apex-gantt block");
            const add = async (body: string): Promise<void> => {
              if (!active) return;
              const store = new NoteStore(plugin.app, file.path, body),
                original = await store.read(),
                schedule = parseGantt(original);
              if (!schedule.ganttId) {
                schedule.ganttId = crypto.randomUUID();
                await store.save(original, serializeGantt(schedule));
              }
              await addToDashboard(
                { note: file.path, ganttId: schedule.ganttId },
                schedule.title,
              );
            };
            if (blocks.length === 1) await add(blocks[0]!.body);
            else
              open(
                new Picker(
                  plugin.app,
                  "Choose a Gantt chart",
                  blocks,
                  (b) => parseGantt(b.body).title,
                  (b) => add(b.body),
                ),
              );
          },
        ),
      );
    },
  });
  // Rebind in-memory sources immediately, and rewrite only actual reference blocks.
  plugin.registerEvent(
    plugin.app.vault.on("rename", (file, oldPath) => {
      if (!(file instanceof TFile) || file.extension !== "md") return;
      for (const chart of charts)
        if (chart.store.path === oldPath) {
          chart.store.path = file.path;
          void chart.render();
        }
      void (async () => {
        for (const note of plugin.app.vault.getMarkdownFiles()) {
          if (!active) return;
          const edit = buffer(plugin.app, note),
            text = edit?.getValue() ?? (await plugin.app.vault.read(note));
          const update = (current: string): string => {
            for (const block of ganttBlocks(current).reverse()) {
              let ref: GanttReference | undefined;
              try {
                ref = ganttReference(block.body);
              } catch {
                continue;
              }
              if (ref?.note !== oldPath) continue;
              const body =
                JSON.stringify(
                  { note: file.path, ganttId: ref.ganttId },
                  null,
                  2,
                ).replace(/\n/g, current.includes("\r\n") ? "\r\n" : "\n") +
                (current.includes("\r\n") ? "\r\n" : "\n");
              current =
                current.slice(0, block.start) + body + current.slice(block.end);
            }
            return current;
          };
          const next = update(text);
          if (next === text) continue;
          if (edit) edit.setValue(next);
          else await plugin.app.vault.process(note, update);
        }
      })().catch(
        () => new Notice("Could not update a chart reference after rename"),
      );
    }),
  );
}

function buffer(app: App, file: TFile) {
  const views: MarkdownView[] = [];
  app.workspace.iterateAllLeaves((leaf) => {
    if (
      leaf.view instanceof MarkdownView &&
      leaf.view.file === file &&
      leaf.view.getMode() === "source"
    )
      views.push(leaf.view);
  });
  return views[0]?.editor;
}
class NoteStore {
  constructor(
    private app: App,
    public path: string,
    private seed: string,
  ) {}
  private file(): TFile {
    const file = this.app.vault.getAbstractFileByPath(ganttPath(this.path));
    if (!(file instanceof TFile) || file.extension !== "md")
      throw Error("Source note is missing");
    return file;
  }
  async read(): Promise<string> {
    const file = this.file();
    const text =
      buffer(this.app, file)?.getValue() ?? (await this.app.vault.read(file));
    this.seed = findGanttBlock(text, this.seed).body.trim();
    return this.seed;
  }
  async save(original: string, updated: string): Promise<void> {
    const file = this.file(),
      editor = buffer(this.app, file);
    if (editor) {
      const current = editor.getValue(),
        next = replaceGanttBlock(current, original, updated);
      const block = findGanttBlock(current, original);
      const end = next.length - (current.length - block.end);
      editor.replaceRange(
        next.slice(block.start, end),
        editor.offsetToPos(block.start),
        editor.offsetToPos(block.end),
      );
    } else
      await this.app.vault.process(file, (text) =>
        replaceGanttBlock(text, original, updated),
      );
    this.seed = updated;
  }
}
export class GanttColumnPicker extends FuzzySuggestModal<string> {
  constructor(
    app: App,
    private columns: string[],
    private choose: (name: string) => Promise<void>,
  ) {
    super(app);
    this.setPlaceholder("Choose a memo or sticky section");
  }
  getItems(): string[] {
    return this.columns;
  }
  getItemText(item: string): string {
    return item;
  }
  onChooseItem(item: string): void {
    void this.choose(item).catch(
      () => new Notice("Could not save the chart reference"),
    );
  }
}
class Picker<T> extends FuzzySuggestModal<T> {
  constructor(
    app: App,
    placeholder: string,
    private items: T[],
    private label: (item: T) => string,
    private choose: (item: T) => Promise<void>,
  ) {
    super(app);
    this.setPlaceholder(placeholder);
  }
  getItems(): T[] {
    return this.items;
  }
  getItemText(item: T): string {
    return this.label(item);
  }
  onChooseItem(item: T): void {
    void this.choose(item).catch((error) => new Notice(String(error)));
  }
}
class GanttChart extends MarkdownRenderChild {
  readonly store: NoteStore;
  private collapsed = new Set<string>();
  private mode: "Day" | "Week" | "Month" = "Day";
  private hidden = false;
  private revision = 0;
  private observer?: ResizeObserver;
  constructor(
    el: HTMLElement,
    private app: App,
    path: string,
    seed: string,
    private reference: boolean,
    private open: (modal: Modal) => void,
    private add: (ref: GanttReference, title: string) => Promise<void>,
  ) {
    super(el);
    this.store = new NoteStore(app, path, seed);
  }
  onload(): void {
    // Gantt controls must not activate a surrounding Memo's text editor.
    for (const event of ['click', 'dblclick', 'pointerdown', 'mousedown'] as const) {
      this.registerDomEvent(this.containerEl, event, e => e.stopPropagation());
    }
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file.path === this.store.path) void this.render();
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file.path === this.store.path) void this.render();
      }),
    );
    let last = 0;
    this.observer = new ResizeObserver((entries) => {
      const width = Math.round(entries[0]?.contentRect.width ?? 0);
      if (width && width !== last) {
        last = width;
        void this.render();
      }
    });
    this.observer.observe(this.containerEl);
    this.register(() => this.observer?.disconnect());
    void this.render();
  }
  onunload(): void {
    this.revision++;
    this.containerEl.empty();
  }
  async render(): Promise<void> {
    const revision = ++this.revision;
    try {
      const original = await this.store.read(),
        schedule = parseGantt(original);
      if (revision !== this.revision || !this.containerEl.isConnected) return;
      const root = this.containerEl;
      root.empty();
      root.addClass("apex-gantt");
      const header = root.createDiv({ cls: "apex-gantt-header" });
      const toggle = header.createEl("button", {
        text: this.hidden ? "▸" : "▾",
        attr: {
          "aria-label": this.hidden ? "Expand chart" : "Collapse chart",
          "aria-expanded": String(!this.hidden),
        },
      });
      toggle.onclick = () => {
        this.hidden = !this.hidden;
        void this.render();
      };
      header.createEl("strong", { text: schedule.title });
      if (this.hidden) return;
      if (this.reference) {
        const link = root.createEl("button", {
          text: this.store.path,
          cls: "apex-gantt-source",
        });
        link.onclick = () => {
          void this.app.workspace.openLinkText(this.store.path, "", true);
        };
      }
      for (const mode of ["Day", "Week", "Month"] as const) {
        const button = header.createEl("button", {
          text: mode,
          cls: this.mode === mode ? "is-active" : "",
        });
        button.onclick = () => {
          this.mode = mode;
          void this.render();
        };
      }
      header.createEl("button", { text: "Edit schedule" }).onclick = () =>
        this.open(
          new ScheduleEditor(this.app, schedule, async (updated) =>
            this.store.save(original, updated),
          ),
        );
      if (!this.reference)
        header.createEl("button", { text: "Add to dashboard" }).onclick =
          () => {
            void (async () => {
              if (!schedule.ganttId) {
                schedule.ganttId = crypto.randomUUID();
                await this.store.save(original, serializeGantt(schedule));
              }
              await this.add(
                { note: this.store.path, ganttId: schedule.ganttId },
                schedule.title,
              );
            })().catch((error) => new Notice(String(error)));
          };
      if (!schedule.tasks.length) {
        root.createEl("p", {
          text: "No entries. Use edit schedule to add tasks and milestones.",
        });
        return;
      }
      type Row = {
        name: string;
        entries: GanttEntry[];
        groupId?: string;
        summary?: boolean;
        milestones?: boolean;
      };
      const rows: Row[] = [];
      for (const group of [...schedule.groups, { id: "", name: "" }]) {
        const entries = schedule.tasks.filter(
          (task) => (task.groupId ?? "") === group.id,
        );
        if (group.id) {
          rows.push({
            name: group.name,
            entries,
            groupId: group.id,
            summary: true,
          });
          if (this.collapsed.has(group.id)) continue;
        }
        for (const entry of entries.filter((task) => task.kind === "task"))
          rows.push({ name: entry.name, entries: [entry] });
        const milestones = entries.filter((task) => task.kind === "milestone");
        if (milestones.length)
          rows.push({
            name: "Milestones",
            entries: milestones,
            milestones: true,
          });
      }
      const grid = root.createDiv({ cls: "apex-gantt-grid" }),
        names = grid.createDiv({ cls: "apex-gantt-names" }),
        host = grid.createDiv({ cls: "apex-gantt-timeline" });
      const today = new Date().toLocaleDateString("sv-SE");
      // Never pass user names or IDs into the dependency's SVG/HTML templates.
      const tasks = rows.map((row, index) => {
        const dates = row.entries
          .flatMap((task) => [task.start, task.end])
          .sort();
        const start = dates[0] ?? today,
          end = new Date(`${dates[dates.length - 1] ?? today}T00:00:00`);
        end.setDate(end.getDate() + 1);
        return {
          id: `row-${index}`,
          name: "",
          start: `${start}T00:00:00`,
          end: `${end.toLocaleDateString("sv-SE")}T00:00:00`,
          progress: 0,
        };
      });
      const gantt = new Gantt(host, tasks, {
        view_mode: this.mode,
        view_modes: [{
          name: this.mode, padding: '0d', step: this.mode === 'Day' ? '1d' : this.mode === 'Week' ? '7d' : '1m',
          column_width: this.mode === 'Day' ? 30 : 80, date_format: 'YYYY-MM-DD',
          lower_text: (day: Date) => this.mode === 'Day' ? String(day.getDate()) : this.mode === 'Week' ? `${day.getMonth() + 1}/${day.getDate()}` : String(day.getMonth() + 1),
          upper_text: (day: Date, previous: Date | null) => !previous || day.getMonth() !== previous.getMonth() ? `${day.getFullYear()}-${day.getMonth() + 1}` : '',
          upper_text_frequency: this.mode === 'Day' ? 30 : 4,
        }],
        scroll_to: 'start', today_button: false,
        readonly: true,
        infinite_padding: false,
        popup: false,
        bar_height: 18,
        padding: 10,
        upper_header_height: 24,
        lower_header_height: 24,
        container_height: Math.min(400, rows.length * 28 + 70),
      });
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      if (revision !== this.revision || !host.isConnected) return;
      names.createDiv({
        cls: "apex-gantt-name-header",
        text: "Tasks / milestones",
      });
      const bars = Array.from(
        host.querySelectorAll<SVGGElement>(".bar-wrapper"),
      );
      const decorate = (): void => {
        rows.forEach((row, index) => {
          const bar = bars[index];
          if (!bar) return;
          const rect = bar.querySelector<SVGRectElement>(".bar");
          if (!rect) return;
          const y = Number(rect.getAttribute("y"));
          const name = names.createEl("button", {
            text:
              (row.summary
                ? this.collapsed.has(row.groupId!)
                  ? "▸ "
                  : "▾ "
                : "") + row.name,
          });
          name.style.top = `${y - 5}px`;
          if (row.summary) {
            name.onclick = () => {
              if (this.collapsed.has(row.groupId!))
                this.collapsed.delete(row.groupId!);
              else this.collapsed.add(row.groupId!);
              void this.render();
            };
            name.setAttribute(
              "aria-expanded",
              String(!this.collapsed.has(row.groupId!)),
            );
          } else name.disabled = true;
          bar
            .querySelectorAll(".bar-label,.bar-progress,.handle")
            .forEach((el) => el.remove());
          if (row.summary || row.milestones)
            rect.setAttribute("visibility", "hidden");
          if (!row.summary && !row.milestones) {
            const entry = row.entries[0]!;
            if (entry.start <= today && today <= entry.end)
              bar.classList.add("is-current");
          }
          const visible = row.summary
            ? this.collapsed.has(row.groupId!)
              ? row.entries
              : []
            : row.milestones
              ? row.entries
              : [];
          if (
            row.summary &&
            !this.collapsed.has(row.groupId!) &&
            row.entries.length
          ) {
            const x = Number(rect.getAttribute("x")),
              width = Number(rect.getAttribute("width"));
            const bracket = createSvg("path");
            bracket.setAttribute(
              "d",
              `M${x},${y + 14}V${y + 7}H${x + width}V${y + 14}`,
            );
            bracket.classList.add("apex-gantt-bracket");
            bar.append(bracket);
          }
          for (const entry of visible) {
            const position = {
              gantt,
              task: { _start: new Date(`${entry.start}T00:00:00`) },
              x: 0,
            };
            gantt.bars[0]!.compute_x.call(position);
            const endPosition = {
              gantt,
              task: { _start: new Date(`${entry.end}T00:00:00`) },
              x: 0,
            };
            endPosition.task._start.setDate(
              endPosition.task._start.getDate() + 1,
            );
            gantt.bars[0]!.compute_x.call(endPosition);
            const shape = createSvg(
              entry.kind === "milestone" ? "polygon" : "rect",
            );
            if (entry.kind === "milestone") {
              const one = {
                gantt,
                task: { _start: new Date(`${entry.start}T00:00:00`) },
                x: 0,
              };
              one.task._start.setDate(one.task._start.getDate() + 1);
              gantt.bars[0]!.compute_x.call(one);
              const x = (position.x + one.x) / 2,
                cy = y + 9;
              shape.setAttribute(
                "points",
                `${x},${cy - 7} ${x + 7},${cy} ${x},${cy + 7} ${x - 7},${cy}`,
              );
              shape.classList.add("apex-gantt-diamond");
            } else {
              shape.setAttribute("x", String(position.x));
              shape.setAttribute("y", String(y - 5));
              shape.setAttribute("width", String(endPosition.x - position.x));
              shape.setAttribute("height", "28");
              shape.classList.add("apex-gantt-folded-task");
              if (entry.start <= today && today <= entry.end)
                shape.classList.add("is-current");
            }
            const title = createSvg("title");
            title.textContent = `${entry.name} · ${entry.start}${entry.kind === "task" ? " → " + entry.end : ""}`;
            shape.append(title);
            bar.append(shape);
          }
        });
      };
      decorate();
      const viewport = host.querySelector<HTMLElement>(".gantt-container");
      if (viewport) {
        viewport.addEventListener("scroll", () => {
          names.scrollTop = viewport.scrollTop;
        });
      }
      names.style.height = `${viewport?.clientHeight ?? 400}px`;
    } catch (error) {
      if (revision === this.revision)
        this.containerEl.setText(`Gantt: ${String(error)}`);
    }
  }
}

class ScheduleEditor extends Modal {
  private draft: GanttSchedule;
  constructor(
    app: App,
    data: GanttSchedule,
    private save: (updated: string) => Promise<void>,
  ) {
    super(app);
    this.draft = JSON.parse(JSON.stringify(data)) as GanttSchedule;
    if (!this.draft.ganttId) this.draft.ganttId = crypto.randomUUID();
  }
  onOpen(): void {
    this.titleEl.setText("Edit schedule");
    this.modalEl.addClass("apex-gantt-editor");
    const title = this.contentEl.createEl("input", {
      value: this.draft.title,
      attr: { "aria-label": "Chart title" },
    });
    title.oninput = () => (this.draft.title = title.value);
    const groups = this.contentEl.createDiv();
    const rows = this.contentEl.createDiv();
    const error = this.contentEl.createDiv({ attr: { role: "alert" } });
    const render = (): void => {
      groups.empty();
      rows.empty();
      for (const group of this.draft.groups) {
        const line = groups.createDiv({ cls: "apex-gantt-editor-row" });
        const name = line.createEl("input", {
          value: group.name,
          attr: { "aria-label": "Group name" },
        });
        name.oninput = () => (group.name = name.value);
        line.createEl("button", { text: "Remove group" }).onclick = () => {
          this.draft.groups = this.draft.groups.filter(
            (g) => g.id !== group.id,
          );
          for (const item of this.draft.tasks)
            if (item.groupId === group.id) delete item.groupId;
          render();
        };
      }
      for (const item of this.draft.tasks) {
        const row = rows.createDiv({ cls: "apex-gantt-editor-row" });
        const name = row.createEl("input", {
          value: item.name,
          attr: { "aria-label": "Entry name" },
        });
        name.oninput = () => (item.name = name.value);
        const group = row.createEl("select", {
          attr: { "aria-label": "Group" },
        });
        group.createEl("option", { text: "Ungrouped", value: "" });
        for (const g of this.draft.groups)
          group.createEl("option", { text: g.name, value: g.id });
        group.value = item.groupId ?? "";
        group.onchange = () => {
          if (group.value) item.groupId = group.value;
          else delete item.groupId;
        };
        const start = row.createEl("input", {
          type: "date",
          value: item.start,
          attr: {
            "aria-label":
              item.kind === "milestone" ? "Milestone date" : "Start date",
          },
        });
        start.oninput = () => {
          item.start = start.value;
          if (item.kind === "milestone") item.end = start.value;
        };
        if (item.kind === "task") {
          const end = row.createEl("input", {
            type: "date",
            value: item.end,
            attr: { "aria-label": "End date" },
          });
          end.oninput = () => (item.end = end.value);
        }
        row.createEl("button", { text: "Remove" }).onclick = () => {
          this.draft.tasks = this.draft.tasks.filter(
            (task) => task.id !== item.id,
          );
          render();
        };
      }
    };
    const controls = this.contentEl.createDiv({ cls: "apex-gantt-header" });
    controls.createEl("button", { text: "Add group" }).onclick = () => {
      this.draft.groups.push({ id: crypto.randomUUID(), name: "Group" });
      render();
    };
    for (const kind of ["task", "milestone"] as const)
      controls.createEl("button", {
        text: kind === "task" ? "Add task" : "Add milestone",
      }).onclick = () => {
        const day = new Date().toLocaleDateString("sv-SE");
        this.draft.tasks.push({
          id: crypto.randomUUID(),
          kind,
          name: kind === "task" ? "Task" : "Milestone",
          start: day,
          end: day,
        });
        render();
      };
    controls.createEl("button", { text: "Cancel" }).onclick = () =>
      this.close();
    const save = controls.createEl("button", { text: "Save", cls: "mod-cta" });
    save.onclick = async () => {
      save.disabled = true;
      try {
        const updated = serializeGantt(this.draft);
        parseGantt(updated);
        await this.save(updated);
        this.close();
      } catch (message) {
        error.setText(String(message));
        save.disabled = false;
      }
    };
    render();
  }
  onClose(): void {
    this.contentEl.empty();
  }
}
