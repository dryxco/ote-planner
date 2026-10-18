// Runs once when the server starts.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV === "production" && !process.env.SYNC_DISABLE_JOBS) {
    const { startConnectorJobs } = await import("./lib/server/connector-jobs");
    startConnectorJobs();
    const { startCalendarWriteJob } = await import("./lib/server/calendar-writer");
    startCalendarWriteJob();
    const { startPushJobs } = await import("./lib/server/push");
    startPushJobs();
  }
}
