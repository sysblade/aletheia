import { configure } from "@logtape/logtape";

await configure({
  sinks: {},
  loggers: [
    { category: "ctlog", lowestLevel: "warning", sinks: [] },
    { category: "logtape", lowestLevel: "error", sinks: [] },
  ],
  reset: true,
});
