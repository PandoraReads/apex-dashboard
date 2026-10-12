import { strict as assert } from "node:assert";
import {
  ganttPath,
  ganttReference,
  parseGantt,
  serializeGantt,
  ganttBlocks,
  findGanttBlock,
  replaceGanttBlock,
} from "../src/gantt-model";
const task = {
  id: "task-1",
  kind: "task",
  name: "Design",
  start: "2026-01-05",
  end: "2026-01-10",
};
const source = JSON.stringify({
  ganttId: "alpha",
  title: "Project Alpha",
  groups: [],
  tasks: [task],
});
assert.equal(parseGantt(source).tasks[0]?.name, "Design");
assert.deepEqual(
  parseGantt(serializeGantt(parseGantt(source))),
  parseGantt(source),
);
for (const path of [
  "../private.md",
  "/private.md",
  "C:/private.md",
  "https://host/file.md",
  ".obsidian/private.md",
  "a//b.md",
  "a/./b.md",
  "a\\b.md",
  "a\nb.md",
  "a/b.json",
])
  assert.throws(() => ganttPath(path));
assert.equal(
  ganttPath("Projects/Alpha/Schedule.md"),
  "Projects/Alpha/Schedule.md",
);
assert.deepEqual(
  ganttReference('{"note":"Projects/Alpha/Schedule.md","ganttId":"alpha"}'),
  { note: "Projects/Alpha/Schedule.md", ganttId: "alpha" },
);
assert.throws(() => ganttReference('{"note":"Schedule.md","ganttId":"<svg>"}'));
for (const bad of [
  { ...task, id: '"><script>' },
  { ...task, start: "2026-02-30" },
  { ...task, end: "2026-01-01" },
  { ...task, groupId: "missing" },
  { ...task, kind: "unknown" },
])
  assert.throws(() => parseGantt(JSON.stringify({ tasks: [bad] })));
assert.throws(() => parseGantt(JSON.stringify({ tasks: [task, task] })));
assert.throws(() =>
  parseGantt(
    JSON.stringify({
      tasks: [{ ...task, start: "2000-01-01", end: "2030-01-01" }],
    }),
  ),
);
assert.throws(() =>
  parseGantt(
    JSON.stringify({
      tasks: Array.from({ length: 501 }, (_, i) => ({ ...task, id: "t" + i })),
    }),
  ),
);
assert.throws(() => parseGantt(" ".repeat(100001)));
const malicious = "<img src=x onerror=alert(1)>";
assert.equal(
  parseGantt(JSON.stringify({ tasks: [{ ...task, name: malicious }] })).tasks[0]
    ?.name,
  malicious,
);
const other = JSON.stringify({ ganttId: "beta", tasks: [] });
const note =
  "Before\r\n```apex-gantt\r\n" +
  source +
  "\r\n```\r\nMiddle\r\n```apex-gantt\r\n" +
  other +
  "\r\n```\r\nAfter";
assert.equal(ganttBlocks(note).length, 2);
const updated = JSON.stringify({
  ...JSON.parse(source),
  tasks: [{ ...task, name: "Updated" }],
});
const result = replaceGanttBlock(note, source, updated);
assert.ok(result.startsWith("Before\r\n```apex-gantt\r\n"));
assert.ok(
  result.endsWith(
    "```\r\nMiddle\r\n```apex-gantt\r\n" + other + "\r\n```\r\nAfter",
  ),
);
assert.ok(!result.replace(/\r\n/g, "").includes("\n"));
assert.throws(
  () => replaceGanttBlock(result, source, updated),
  /changed elsewhere/,
);
assert.throws(() => replaceGanttBlock(note, source, other), /identity/);
assert.throws(() => findGanttBlock(note + note, source), /duplicated/);
assert.throws(() => findGanttBlock("No chart", source), /missing/);
const nested = "````text\n```apex-gantt\n" + source + "\n```\n````";
assert.equal(ganttBlocks(nested).length, 0);
const ref =
  '```apex-gantt\n{"note":"Projects/Alpha/Schedule.md","ganttId":"alpha"}\n```\n';
assert.throws(() => findGanttBlock(ref, source));
console.log(
  "Gantt model: paths, input bounds, dates, IDs, reference identity, CRLF, cancellation-by-no-write and optimistic conflicts passed.",
);
