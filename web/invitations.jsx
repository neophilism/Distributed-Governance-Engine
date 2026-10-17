import React, { useEffect, useState } from "react";
import { createAccountAPI, invitationPackage } from "./account-api.mjs";
const api = createAccountAPI();
export function InvitationControls({
  workspace,
  authority,
  perform,
  busy,
  refresh,
  report,
}) {
  const [account, setAccount] = useState(""),
    [role, setRole] = useState("editor"),
    [code, setCode] = useState(""),
    [page, setPage] = useState({ items: [], nextCursor: null });
  useEffect(() => {
    const abort = new AbortController();
    api(`/api/workspaces/${workspace}/invitations`, { signal: abort.signal })
      .then(setPage)
      .catch((error) => {
        if (!abort.signal.aborted) report(error);
      });
    return () => abort.abort();
  }, [workspace, refresh]);
  return (
    <section>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          perform(async () => {
            const result = await api(
              `/api/workspaces/${workspace}/invitations`,
              { method: "POST", body: { accountId: account, role } },
            );
            setCode(invitationPackage(workspace, result.invitationToken));
          }, "Invitation created.");
        }}
      >
        <h3>Invite a member</h3>
        <label>
          Invitee account ID
          <input
            required
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            maxLength={36}
            disabled={busy}
          />
        </label>
        <label>
          Invitation role
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            disabled={busy}
          >
            {[
              "viewer",
              "participant",
              "editor",
              ...(authority === "owner" ? ["admin"] : []),
            ].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <button disabled={busy}>Create invitation</button>
      </form>
      {code && (
        <label>
          Private invitation code
          <textarea readOnly value={code} />
          <span className="small">
            Share this code privately with the invited account. It expires in 24
            hours. The code is shown only in this panel.
          </span>
        </label>
      )}
      <h3>Pending invitations</h3>
      <ul>
        {page.items.map((invite) => (
          <li key={invite.id}>
            Account {invite.accountId} · {invite.role} · expires{" "}
            {new Date(invite.expiresAt).toLocaleString()}{" "}
            <button
              disabled={
                busy || (invite.role === "admin" && authority !== "owner")
              }
              onClick={() =>
                perform(
                  () =>
                    api(
                      `/api/workspaces/${workspace}/invitations/${invite.id}`,
                      { method: "DELETE", body: {} },
                    ),
                  "Invitation cancelled.",
                )
              }
            >
              Cancel invitation
            </button>
          </li>
        ))}
      </ul>
      {page.nextCursor && (
        <button
          disabled={busy}
          onClick={() =>
            perform(
              async () => {
                const next = await api(
                  `/api/workspaces/${workspace}/invitations?after=${page.nextCursor}`,
                );
                setPage((old) => ({
                  items: [...old.items, ...next.items],
                  nextCursor: next.nextCursor,
                }));
              },
              "More invitations loaded.",
              { refresh: false },
            )
          }
        >
          Load more invitations
        </button>
      )}
    </section>
  );
}
