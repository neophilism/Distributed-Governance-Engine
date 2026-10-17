import React, { useEffect, useState, useRef } from "react";
import { createAccountAPI } from "./account-api.mjs";
import { createLegalDocument } from "../src/legal-structure.mjs";
const api = createAccountAPI();
const writable = (role) => ["owner", "admin", "editor"].includes(role);
export function DocumentLibrary({ currentDocument, onOpen, notify }) {
  const [open, setOpen] = useState(false),
    [workspaces, setWorkspaces] = useState([]),
    [workspace, setWorkspace] = useState(""),
    [workspaceCursor, setWorkspaceCursor] = useState(null),
    [items, setItems] = useState([]),
    [cursor, setCursor] = useState(null),
    [title, setTitle] = useState(""),
    [disclosed, setDisclosed] = useState(false),
    [busy, setBusy] = useState(false),
    [directoryLoading, setDirectoryLoading] = useState(false),
    [documentsLoading, setDocumentsLoading] = useState(false),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0);
  const pendingCreation = useRef(null);
  const loading = directoryLoading || documentsLoading;
  const role = workspaces.find((w) => w.tenantId === workspace)?.role;
  const report = (cause) =>
    setError(
      cause.code === "PUBLICATION_UNCERTAIN"
        ? "Publication may have succeeded. Retry publication to retrieve the same document safely."
        : cause.code === "AUTHENTICATION_REQUIRED"
          ? "Sign in using Account & workspaces, then refresh this list."
          : cause.code === "VERSION_CONFLICT"
            ? "A newer version is available. Your local text has been kept."
            : cause.code?.endsWith("_LIMIT_REACHED")
              ? "A workspace resource limit has been reached."
              : cause.code === "SIGN_IN_AGAIN"
                ? "Sign in again to continue."
                : "The document service could not complete this request. Try again.",
    );
  useEffect(() => {
    if (!open) {
      setDirectoryLoading(false);
      return;
    }
    const controller = new AbortController();
    setDirectoryLoading(true);
    setError("");
    api("/api/workspaces", { signal: controller.signal })
      .then((result) => {
        setWorkspaces(result.items);
        setWorkspaceCursor(result.nextCursor);
        setWorkspace((previous) =>
          result.items.some((w) => w.tenantId === previous)
            ? previous
            : (result.items[0]?.tenantId ?? ""),
        );
      })
      .catch((cause) => {
        if (cause.name !== "AbortError") report(cause);
      })
      .finally(() => {
        if (!controller.signal.aborted) setDirectoryLoading(false);
      });
    return () => controller.abort();
  }, [open, refresh]);
  useEffect(() => {
    if (!open || !workspace) {
      setItems([]);
      setDocumentsLoading(false);
      return;
    }
    const controller = new AbortController();
    setDocumentsLoading(true);
    setItems([]);
    setCursor(null);
    api(`/api/workspaces/${workspace}/documents`, { signal: controller.signal })
      .then((result) => {
        setItems(result.items);
        setCursor(result.nextCursor);
      })
      .catch((cause) => {
        if (cause.name !== "AbortError") report(cause);
      })
      .finally(() => {
        if (!controller.signal.aborted) setDocumentsLoading(false);
      });
    return () => controller.abort();
  }, [open, workspace, refresh]);
  async function perform(operation) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (cause) {
      report(cause);
    } finally {
      setBusy(false);
    }
  }
  async function openDocument(id) {
    const snapshot = await api(`/api/workspaces/${workspace}/documents/${id}`);
    if (onOpen(snapshot) !== false) setOpen(false);
  }
  async function create() {
    if (!pendingCreation.current) {
      const id = crypto.randomUUID(),
        document = structuredClone(
          createLegalDocument({
            id,
            tenantId: workspace,
            title: title.trim(),
            locale: currentDocument.metadata.locale,
          }),
        );
      document.content = structuredClone(currentDocument.content);
      document.metadata.numberingProfile =
        currentDocument.metadata.numberingProfile;
      const retarget = (nodes) =>
        nodes.forEach((node) => {
          for (const inline of node.inlines ?? [])
            if (inline.targetId === currentDocument.id) inline.targetId = id;
          if (node.children) retarget(node.children);
        });
      retarget(document.content);
      pendingCreation.current = {
        workspace,
        body: {
          document,
          commandId: crypto.randomUUID(),
          disclosure: "publish-all-revisions-v1",
        },
      };
    }
    const pending = pendingCreation.current;
    try {
      const result = await api(
        `/api/workspaces/${pending.workspace}/documents`,
        { method: "POST", body: pending.body },
      );
      const snapshot = await api(
        `/api/workspaces/${pending.workspace}/documents/${result.document.id}`,
      );
      pendingCreation.current = null;
      notify(
        "Public document created. Every saved version is public; blockchain anchoring is pending.",
      );
      if (onOpen(snapshot) !== false) setOpen(false);
    } catch (cause) {
      if (cause.status >= 400 && cause.status < 500)
        pendingCreation.current = null;
      else cause.code = "PUBLICATION_UNCERTAIN";
      throw cause;
    }
  }
  return (
    <>
      <button
        data-tour="documents"
        onClick={() => {
          if (!open && !pendingCreation.current) {
            setTitle(currentDocument.metadata.title);
            setDisclosed(false);
          }
          setOpen((value) => !value);
          window.dispatchEvent(new Event("quill-open-documents"));
        }}
      >
        Documents
      </button>
      {open && (
        <aside
          className="document-library account-panel"
          aria-label="Saved documents"
        >
          <div className="account-title">
            <h2>Your documents</h2>
            <button onClick={() => setOpen(false)}>Close documents</button>
          </div>
          <p role="status">
            {busy ? "Publishing…" : loading ? "Loading documents…" : error}
          </p>
          <button
            disabled={busy || loading}
            onClick={() => setRefresh((x) => x + 1)}
          >
            Refresh documents
          </button>
          <label>
            Your document workspace
            <select
              value={workspace}
              disabled={busy || loading || !!pendingCreation.current}
              onChange={(event) => setWorkspace(event.target.value)}
            >
              {workspaces.map((item) => (
                <option key={item.tenantId} value={item.tenantId}>
                  Workspace {item.tenantId.slice(0, 8)} · {item.role}
                </option>
              ))}
            </select>
          </label>
          {workspaceCursor && (
            <button
              disabled={busy || loading}
              onClick={() =>
                perform(async () => {
                  const result = await api(
                    "/api/workspaces?after=" + workspaceCursor,
                  );
                  setWorkspaces((old) => [...old, ...result.items]);
                  setWorkspaceCursor(result.nextCursor);
                })
              }
            >
              More workspaces
            </button>
          )}
          <ul className="document-list">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  disabled={busy || loading}
                  onClick={() => perform(() => openDocument(item.id))}
                >
                  {item.title || "Untitled document"}{" "}
                  <span className="small">
                    Version {item.version} ·{" "}
                    {item.mode === "public-input"
                      ? "Fixed public-input source"
                      : "Public working draft"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {cursor && (
            <button
              disabled={busy || loading}
              onClick={() =>
                perform(async () => {
                  const result = await api(
                    `/api/workspaces/${workspace}/documents?after=${cursor}`,
                  );
                  setItems((old) => [...old, ...result.items]);
                  setCursor(result.nextCursor);
                })
              }
            >
              More documents
            </button>
          )}
          {workspace && writable(role) && (
            <form
              className="public-create"
              onSubmit={(event) => {
                event.preventDefault();
                perform(create);
              }}
            >
              <h3>Publish a copy of the current text</h3>
              <label>
                Document title
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={1000}
                  required
                  disabled={busy || !!pendingCreation.current}
                />
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={disclosed}
                  onChange={(event) => setDisclosed(event.target.checked)}
                  disabled={busy || !!pendingCreation.current}
                />
                I authorize public access to this document and every saved
                version.
              </label>
              <p className="small">
                Anyone with its link can read the text and history. Do not
                include private information. Earlier public versions remain
                public.
              </p>
              <button disabled={busy || !disclosed || !title.trim()}>
                {pendingCreation.current
                  ? "Retry publication"
                  : "Publish current text"}
              </button>
            </form>
          )}
          {!workspace && !busy && (
            <p>Create or join a workspace using Account & workspaces first.</p>
          )}
        </aside>
      )}
    </>
  );
}
