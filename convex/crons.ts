import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "auto-archive done tasks",
  { hours: 1 },
  internal.settings.autoArchiveDoneTasks,
);

export default crons;
