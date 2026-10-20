# Step 164 — Area preflight regression assertion correction

Step 163's Security Rules workflow passed, but the Callable/Geometry workflow failed because a static regression test expected the proposed-index local variable to be named `proposedIndex`, while the scanner uses `proposed`. The scanner source was not failing that assertion; the test was checking the wrong identifier.

Updated the regression assertions to match the scanner's actual local variable. This is a test-only correction. Re-run the CI workflows before declaring Step 164 passed.

No production scan, Firestore write, migration, deploy, or merge was performed.


## Fresh CI verification
After the corrected assertion was included in the branch, both workflows completed successfully on commit `ddd1e0f85a565c5425c73e5c58a4d83876f6eb40`:
- Trusted Location Geometry and Callable Tests: PASS — run [39175096643](https://github.com/dojoplatform2026/DOJO-WALK-Firebase/actions/runs/39175096643)
- Test Firestore Security Rules: PASS — run [39175096697](https://github.com/dojoplatform2026/DOJO-WALK-Firebase/actions/runs/39175096697)

The earlier failure on `ab5d2ca26a2284f585d71e6812b2a0b552d6ae4a` was superseded by this successful run. This confirms CI for the corrected assertion and documentation commit; it does not mean the District-aware production callable migration is complete.
