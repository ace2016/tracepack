export interface CaptureJob {
  id: string;
  url: string;
  title: string;
  capturedAt: string;
  screenshotDataUrl: string;
  status: "pending" | "completed" | "failed";
  error?: string;
  // Absent means "viewport" — this field was added after viewport capture already shipped,
  // so old queued jobs (and anything a future producer omits it on) default to the
  // pre-existing behaviour rather than being treated as a full-page capture they aren't.
  mode?: "viewport" | "full-page";
  // Only meaningful when mode is "full-page": the page was taller than Tracepack's stitch
  // limit, so the capture covers the top portion of the page, not the whole thing.
  truncated?: boolean;
}

export const CAPTURE_JOBS_KEY = "tracepackCaptureJobs";
