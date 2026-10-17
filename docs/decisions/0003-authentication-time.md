# Decision: freshness follows the actual provider login

Self-review found that a newly issued app session could start a new five-minute administration window even when the provider authentication was already several minutes old. No production identity service had been deployed.

Require the trusted login adapter to carry the verified provider `auth_time` into a separate stored `authenticated_at` column. App session creation/expiration remain separate. Sensitive actions use actual authentication age. Do not silently invent authentication time for older rows; preserve them and require a new login. A small future-clock allowance accommodates provider clock skew, while a backward app-clock jump denies sessions issued in the apparent future.

Migration 001 remains immutable. Migration 002 adds the evidence and enforces it for new writes. The ordered checksum-checked runner applies both atomically. Enable routes only after the updated schema and service are ready; old writers fail the new constraint. No new provider, resource or secret is required. Provider/server clock accuracy and future step-up UI remain explicit operational work.
