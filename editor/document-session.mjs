import { validateLegalDocument } from "../src/legal-structure.mjs";

/** Serial saves retain uncertain requests for safe retry and never replace newer local edits. */
export function createDocumentSession({
  snapshot,
  saveRequest,
  onState = () => {},
  commandId = () => crypto.randomUUID(),
}) {
  let document = validateLegalDocument(snapshot.document),
    saved = JSON.stringify(document),
    version = snapshot.version,
    pending = null,
    running = null,
    blocked = false,
    disposed = false,
    error = null;
  const status = () => ({
    document,
    version,
    dirty: JSON.stringify(document) !== saved,
    state: blocked
      ? "conflict"
      : running
        ? "saving"
        : error
          ? "error"
          : JSON.stringify(document) !== saved
            ? "unsaved"
            : "saved",
    error,
  });
  const emit = () => {
    if (!disposed) onState(status());
  };
  async function flush() {
    try {
      while (
        !disposed &&
        !blocked &&
        (pending || JSON.stringify(document) !== saved)
      ) {
        if (!pending)
          pending = {
            document,
            expectedVersion: version,
            commandId: commandId(),
          };
        const attempt = pending;
        let result;
        try {
          result = await saveRequest(attempt);
          if (
            !Number.isSafeInteger(result?.version) ||
            result.version !== attempt.expectedVersion + 1
          )
            throw Object.assign(Error("INVALID_SAVE_RESPONSE"), {
              code: "SERVICE_UNAVAILABLE",
              status: 503,
            });
        } catch (cause) {
          error = cause.code ?? "SERVICE_UNAVAILABLE";
          if (
            [
              "VERSION_CONFLICT",
              "SOURCE_FROZEN",
              "AUTHENTICATION_REQUIRED",
              "ACCESS_DENIED",
            ].includes(error)
          )
            blocked = true;
          // A definite rejected write did not commit. Uncertain network/5xx responses retain the identical command.
          if (cause.status >= 400 && cause.status < 500 && cause.status !== 429)
            pending = null;
          throw cause;
        }
        if (disposed) return;
        version = result.version;
        saved = JSON.stringify(attempt.document);
        pending = null;
        error = null;
        emit();
      }
    } finally {
      running = null;
      emit();
    }
  }
  return Object.freeze({
    change(next) {
      if (disposed) throw Error("Session closed");
      document = validateLegalDocument(next);
      error = null;
      emit();
    },
    save() {
      if (disposed || blocked) return Promise.reject(Error("SESSION_BLOCKED"));
      if (running) return running;
      error = null;
      running = Promise.resolve().then(flush);
      emit();
      return running;
    },
    getState: status,
    dispose() {
      disposed = true;
    },
  });
}
