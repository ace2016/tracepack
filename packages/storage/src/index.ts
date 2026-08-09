import { openDB, type DBSchema } from "idb";
import type { TracepackProject } from "@tracepack/evidence-core";

interface TracepackDatabase extends DBSchema {
  projects: { key: string; value: TracepackProject; indexes: { "by-updated": string } };
  files: { key: string; value: { id: string; blob: Blob } };
}

const database = () => openDB<TracepackDatabase>("tracepack-local", 1, {
  upgrade(db) {
    const projects = db.createObjectStore("projects", { keyPath: "id" });
    projects.createIndex("by-updated", "updatedAt");
    db.createObjectStore("files", { keyPath: "id" });
  },
});

export async function listProjects(): Promise<TracepackProject[]> {
  const db = await database();
  return (await db.getAllFromIndex("projects", "by-updated")).reverse();
}

export async function getProject(id: string) {
  return (await database()).get("projects", id);
}

export async function saveProject(project: TracepackProject) {
  await (await database()).put("projects", project);
}

export async function saveEvidenceFile(id: string, blob: Blob) {
  await (await database()).put("files", { id, blob });
}

export async function getEvidenceFile(id: string) {
  return (await database()).get("files", id);
}

export async function deleteProject(project: TracepackProject) {
  const db = await database();
  const transaction = db.transaction(["projects", "files"], "readwrite");
  await transaction.objectStore("projects").delete(project.id);
  await Promise.all(project.evidence.map((item) => transaction.objectStore("files").delete(item.id)));
  await transaction.done;
}

/**
 * Writes one project document and a batch of evidence blobs as a single atomic operation —
 * either every write in this call commits, or none does. Modeled directly on deleteProject
 * above, the only other place in this module that already crosses both stores in one
 * transaction; `idb`'s `db.transaction([...], "readwrite")` is what makes that atomic, not
 * anything new.
 *
 * Deliberately narrow: this function does exactly one thing (persist a project plus the
 * blobs that belong to it, together) and nothing else — no reads, no partial-write mode, no
 * options. Existing single-record callers (saveProject, saveEvidenceFile) are untouched and
 * still the right choice for saving one thing at a time; this exists for callers — today,
 * evidence-interchange's import path — that need "this project update and these new blobs
 * become durable together, or neither does."
 */
export async function saveProjectAndFiles(project: TracepackProject, files: Map<string, Blob>): Promise<void> {
  const db = await database();
  const transaction = db.transaction(["projects", "files"], "readwrite");
  // A second, no-op observer on each of these promises (transaction.done here, individual
  // put() requests below): every `await`/`.then`/`.catch` attached to a promise sees its
  // outcome independently, so this doesn't change what the real `await` calls below observe —
  // it only keeps Node/the test runner from flagging an *already-handled* rejection a second
  // time once the code below deliberately aborts and moves on to throw its own error instead.
  const observe = <T>(promise: Promise<T>): Promise<T> => { promise.catch(() => {}); return promise; };
  observe(transaction.done);

  try {
    // Every put() call is issued synchronously, in one block, with no `await` between any of
    // them, and each one's promise is captured — even the ones queued before a later one
    // throws. Two real bugs were found and fixed getting here, both confirmed against
    // fake-indexeddb rather than assumed from reading the spec: (1) awaiting the project put
    // before queuing the file puts left a gap IndexedDB can use to auto-commit the
    // transaction early, before a later failure is even detected; (2) a malformed value (one
    // the structured clone algorithm can't handle) throws synchronously from put() itself —
    // before an IDBRequest exists — so building the write list as a single array/spread
    // expression means a later entry's throw discards the *reference* to earlier entries'
    // already-issued request promises, which still individually reject once the transaction
    // aborts, with nothing left listening. A plain loop, pushing each observed promise as it's
    // created, keeps every request promise reachable regardless of where a later one throws.
    const writes: Promise<unknown>[] = [observe(transaction.objectStore("projects").put(project))];
    for (const [id, blob] of files) writes.push(observe(transaction.objectStore("files").put({ id, blob })));
    await Promise.all(writes);
    await transaction.done;
  } catch (error) {
    // Explicitly aborting on any error, sync or async, is what actually guarantees "every
    // write commits, or none does" in every failure mode — an uncommitted transaction is not
    // rolled back just because the JS code that was driving it threw.
    try { transaction.abort(); } catch { /* already aborted/finished; nothing more to do */ }
    throw error;
  }
}
