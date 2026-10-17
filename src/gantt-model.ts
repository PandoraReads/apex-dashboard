/** Gantt v1: vault-local Markdown is the sole source of scheduling data. */
export interface GanttEntry {
  id: string;
  name: string;
  kind: "task" | "milestone";
  start: string;
  end: string;
  groupId?: string;
}
export interface GanttSchedule {
  ganttId: string;
  title: string;
  groups: { id: string; name: string }[];
  tasks: GanttEntry[];
}
export interface GanttReference {
  note: string;
  ganttId: string;
}
const ID = /^[a-zA-Z0-9_-]{1,128}$/;
export const MAX_GANTT_BYTES = 100_000;

export function ganttPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 1024 ||
    !value.endsWith(".md") ||
    /[\\:#|]/.test(value) ||
    [...value].some((char) => char.charCodeAt(0) < 32) ||
    value.split("/").some((p) => !p || p.startsWith("."))
  )
    throw Error("Invalid vault-local Markdown path");
  return value;
}
export function ganttReference(source: string): GanttReference | undefined {
  if (source.length > MAX_GANTT_BYTES)
    throw Error("Gantt data exceeds the size limit");
  const data: unknown = JSON.parse(source);
  if (!data || typeof data !== "object" || !("note" in data)) return undefined;
  const ref = data as Record<string, unknown>;
  if (typeof ref.ganttId !== "string" || !ID.test(ref.ganttId))
    throw Error("Invalid Gantt ID");
  return { note: ganttPath(ref.note), ganttId: ref.ganttId };
}
function date(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw Error("Invalid date");
  return value;
}
function label(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 200)
    throw Error("A name of 1–200 characters is required");
  return value.trim();
}
export function parseGantt(source: string): GanttSchedule {
  if (source.length > MAX_GANTT_BYTES)
    throw Error("Gantt data exceeds the size limit");
  const data = JSON.parse(source) as Record<string, unknown>;
  if (
    !data ||
    !Array.isArray(data.tasks) ||
    data.tasks.length > 500 ||
    (data.groups !== undefined &&
      (!Array.isArray(data.groups) || data.groups.length > 100))
  )
    throw Error("Invalid schedule or too many entries");
  if (
    data.ganttId !== undefined &&
    (typeof data.ganttId !== "string" || !ID.test(data.ganttId))
  )
    throw Error("Invalid Gantt ID");
  const groups = ((data.groups ?? []) as Record<string, unknown>[]).map(
    (group) => {
      if (!group || typeof group.id !== "string" || !ID.test(group.id))
        throw Error("Invalid group ID");
      return { id: group.id, name: label(group.name) };
    },
  );
  if (new Set(groups.map((g) => g.id)).size !== groups.length)
    throw Error("Duplicate group ID");
  const tasks = data.tasks.map((value: unknown): GanttEntry => {
    const item = value as Record<string, unknown>;
    if (!item || typeof item.id !== "string" || !ID.test(item.id))
      throw Error("Invalid task ID");
    if (
      item.kind !== undefined &&
      item.kind !== "task" &&
      item.kind !== "milestone"
    )
      throw Error("Invalid entry kind");
    if (
      item.groupId !== undefined &&
      (typeof item.groupId !== "string" ||
        !groups.some((g) => g.id === item.groupId))
    )
      throw Error("Unknown group");
    const kind = item.kind === "milestone" ? "milestone" : "task";
    const start = date(kind === "milestone" ? item.date : item.start),
      end = date(kind === "milestone" ? item.date : item.end);
    if (end < start) throw Error("End precedes start");
    return {
      id: item.id,
      name: label(item.name),
      kind,
      start,
      end,
      ...(item.groupId ? { groupId: item.groupId } : {}),
    };
  });
  if (new Set(tasks.map((item) => item.id)).size !== tasks.length)
    throw Error("Duplicate task ID");
  const dates = tasks.flatMap((item) => [item.start, item.end]).sort();
  if (
    dates.length &&
    (Date.parse(dates[dates.length - 1]!) - Date.parse(dates[0]!)) / 86400000 >
      3660
  )
    throw Error("Displayed range exceeds ten years");
  return {
    ganttId: typeof data.ganttId === "string" ? data.ganttId : "",
    title: data.title === undefined ? "Gantt" : label(data.title),
    groups,
    tasks,
  };
}
export function serializeGantt(schedule: GanttSchedule): string {
  return JSON.stringify(
    {
      ganttId: schedule.ganttId,
      title: schedule.title,
      groups: schedule.groups,
      tasks: schedule.tasks.map((item) => ({
        id: item.id,
        name: item.name,
        kind: item.kind,
        ...(item.kind === "milestone"
          ? { date: item.start }
          : { start: item.start, end: item.end }),
        ...(item.groupId ? { groupId: item.groupId } : {}),
      })),
    },
    null,
    2,
  );
}

export interface GanttBlock {
  start: number;
  end: number;
  body: string;
}
export function ganttBlocks(text: string): GanttBlock[] {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [],
    result: GanttBlock[] = [];
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const opening = lines[i]!.match(/^(`{3,}|~{3,})([^\r\n]*)\r?\n?$/);
    if (!opening) {
      offset += lines[i]!.length;
      continue;
    }
    offset += lines[i]!.length;
    const start = offset;
    let body = "";
    while (++i < lines.length) {
      const closing = lines[i]!.trim();
      if (
        closing.length >= opening[1]!.length &&
        [...closing].every((c) => c === opening[1]![0])
      ) {
        if (opening[2]!.trim() === "apex-gantt")
          result.push({ start, end: offset, body });
        offset += lines[i]!.length;
        break;
      }
      body += lines[i];
      offset += lines[i]!.length;
    }
  }
  return result;
}
export function findGanttBlock(text: string, source: string): GanttBlock {
  const schedule = parseGantt(source);
  const matches = ganttBlocks(text).filter((block) => {
    try {
      return (
        !ganttReference(block.body) &&
        (schedule.ganttId
          ? parseGantt(block.body).ganttId === schedule.ganttId
          : block.body.trim() === source.trim())
      );
    } catch {
      return false;
    }
  });
  if (matches.length !== 1)
    throw Error("Source chart is missing or its ID is duplicated");
  return matches[0]!;
}
export function replaceGanttBlock(
  text: string,
  original: string,
  updated: string,
): string {
  const block = findGanttBlock(text, original);
  if (block.body.trim() !== original.trim())
    throw Error("Schedule changed elsewhere; reopen the editor");
  const next = parseGantt(updated),
    old = parseGantt(original);
  if (old.ganttId && next.ganttId !== old.ganttId)
    throw Error("Cannot change chart identity");
  // Retain unknown metadata without interpreting it as executable markup.
  const previous = JSON.parse(original) as { tasks: Record<string, unknown>[] };
  const replacement = JSON.parse(updated) as { tasks: Record<string, unknown>[] };
  replacement.tasks = replacement.tasks.map(task => ({
    ...previous.tasks.find(oldTask => oldTask.id === task.id),
    ...task,
  }));
  const body =
    JSON.stringify(
      { ...previous, ...replacement },
      null,
      2,
    ).replace(/\n/g, text.includes("\r\n") ? "\r\n" : "\n") +
    (text.includes("\r\n") ? "\r\n" : "\n");
  return text.slice(0, block.start) + body + text.slice(block.end);
}
