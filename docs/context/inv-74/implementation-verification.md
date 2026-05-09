# INV-74 Implementation Verification

## Task

Implement INV-74 using the experiment-selected design from `experiment-brief.md`.

## Finding

The implementation already exists on master. The explicit routing via `composeHeadlessStartup` was implemented in a prior workflow. This branch's only delta from master is `docs/context/inv-74/experiment-brief.md`.

## Verification Points

### Code Verification

| Checkpoint | File | Location | Status |
|---|---|---|---|
| `composeHeadlessStartup` exists | `packages/runtime-service/src/composition.ts` | lines 97-101 | VERIFIED |
| Exported from package | `packages/runtime-service/src/index.ts` | line 5 | VERIFIED |
| Explicit routing in main.ts | `packages/app/src/main.ts` | lines 417-419 | VERIFIED |
| `HeadlessDeps.runtimeServices` field | `packages/app/src/headless.ts` | line 102 | VERIFIED |
| Import in main.ts | `packages/app/src/main.ts` | line 72 | VERIFIED |

### Rejected Design Absent

The module-level singleton pattern (rejected in experiment brief) is not used. The module-level `let runtimeServices` in main.ts is assigned via explicit conditional routing, not implicit access.

### Experiment Results

| Experiment | Threshold | Result |
|---|---|---|
| 1: Composition shell contract | 10/10 pass | 10/10 pass - PASS |
| 2: Headless bridge parity | 17/17 pass | 20/20 pass (3 tests added since brief) - PASS |
| 3: Type safety boundary | exit 0 | exit 0 - PASS |
| 4: Full app integration | 0 failures | 877 pass, 1 skip, 0 fail - PASS |

## Conclusion

No code changes needed. The experiment-selected design is fully implemented and all four experiment gates pass. The experiment brief's conclusions are consumed by the existing implementation.
