# Step 164 — Area preflight regression assertion correction

Step 163's Security Rules workflow passed, but the Callable/Geometry workflow failed because a static regression test expected the proposed-index local variable to be named `proposedIndex`, while the scanner uses `proposed`. The scanner source was not failing that assertion; the test was checking the wrong identifier.

Updated the regression assertions to match the scanner's actual local variable. This is a test-only correction. Re-run the CI workflows before declaring Step 164 passed.

No production scan, Firestore write, migration, deploy, or merge was performed.
