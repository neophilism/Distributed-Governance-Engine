# Private local draft recovery (partial DCE-003)

This source increment provides only **confidential local draft recovery** for a device that already has a verified, non-extractable AES-256-GCM CryptoKey. It does **not** implement multi-user E2EE, MLS, device pairing, key recovery, group membership changes, encrypted server stores, or realtime collaboration. Those remain DCE-003/DCE-008 requirements.

## Scope and guarantees

- A caller supplies a non-extractable AES-256-GCM CryptoKey with both encryption and decryption usages. The helper can generate an **ephemeral** key for tests and disposable previews, but that key is lost after reload unless a separate, reviewed device-key unlock/storage flow retains access. Neither the key nor plaintext is stored by this adapter.
- Bytes are authenticated with WebCrypto AES-256-GCM using a fresh 96-bit random nonce for every save and a 128-bit tag. Additional authenticated data (AAD) binds the tenant ID, workspace ID, document ID, and membership/key epoch to the envelope.
- Local storage receives only a compact versioned envelope containing cipher identifier, nonce and ciphertext. It receives no plaintext title, body, hidden key, encrypted-device secret or document JSON.
- Saving requires a valid collaboration draft with the exact tenant and document identity. Loading validates the decrypted legal schema before returning it.
- Corrupt, tampered, wrong-key, wrong-scope and stale trusted revision inputs fail closed. Quota/storage failures are visible rather than treated as successful saves. Separate private/public namespaces prevent a private document from falling back into the old opt-in **plaintext** public-demo cache.
- Encryption protects stored document bytes against passive inspection of this storage adapter, **not** document identifiers in storage keys, client compromise, malicious same-origin scripts, unauthorized key release, replay of a previously authentic old envelope, or snapshots copied before a key epoch change. A trusted minimum revision prevents accidental stale restores, not rollback from a malicious storage adversary.

## Integration boundary

Use createEncryptedDraftCache(storage, {key,tenantId,workspaceId,documentId,epoch,webCrypto}) only after independent device verification and key-unlock authority have succeeded. save(document), load({minimumRevision}), and clear() return explicit state objects. Encryption errors never cause a plaintext fallback.

The UI must not expose confidential persistence until identity/device trust and client-side key distribution have a reviewed implementation. Realtime sync must use an audited, interoperable group encryption implementation and separately authorized rooms; do not repurpose this local cache format as a new wire encryption protocol.

## Verification and pending work

npm run check includes WebCrypto round trips, ciphertext-at-rest, tampering, wrong key/scope/epoch, immutable editions, quota errors, stale revisions, and malformed envelopes. The tests exercise crypto primitives in the Node WebCrypto provider, not secure hardware, physical WebAuthn authenticators, malicious JavaScript isolation or production service compromise.

Still required: reviewed MLS upstream selection/pinning, device-key binding and recovery, epoch rekey on membership change, ciphertext-only server/backup/service lanes, multi-device interoperability tests, encrypted attachment handling, production frontend integration and E2EESA adversarial verification. DCE-003 remains **partial** and all operational acceptance remains **unverified**.
