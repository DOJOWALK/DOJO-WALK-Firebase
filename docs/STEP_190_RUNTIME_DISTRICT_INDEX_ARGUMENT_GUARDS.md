# Step 190 — Runtime District Index Argument Guards

## Change
- Added explicit runtime validation for the District-aware index type in both parent-tuple and index-ID helpers.
- Added explicit non-string name validation before normalization.
- Added regression tests for an unknown type and a non-string name.

## Why
TypeScript unions help compile-time callers but do not protect JavaScript/runtime inputs. These guards produce stable, intentional errors instead of incidental property-access or string-method exceptions.

## Safety
- The District-aware helpers remain additive and are not wired into production callable writes.
- No Firestore data changed; no production scan, migration, deployment, or merge performed.
- CI pending.
