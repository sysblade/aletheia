import { configure } from "@logtape/logtape";

await configure({
  sinks: {},
  loggers: [
    { category: "aletheia", lowestLevel: "warning", sinks: [] },
    { category: "logtape", lowestLevel: "error", sinks: [] },
  ],
  reset: true,
});
