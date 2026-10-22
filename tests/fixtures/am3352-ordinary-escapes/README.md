# Native AM3352 ordinary escape reproduction

Run `bun test tests/am3352-ordinary-escape-repro.test.ts`.

The loader derives the case entirely from the existing public `am3352-fresh-native` and `am3352-shared-pairs` fixtures. Native pad IDs resolve to their centers in the latter's obstacles; byte buses use standalone maximum lengths. The existing joint pair planner generates the six-conductor seed at runtime. No additional captured board data or intermediate copper is committed.

- DDR_D13: four-quadrant policy returns no route; expanded sites produce a candidate below its 20.200 mm ceiling using 0.30 mm drill / 0.50 mm land vias.
- DDR_CSn0: expanded sites still fail. Independently removing either DQS pair does not help; removing only CK succeeds with both DQS pairs retained.

The tests reproduce current behavior. A stacked fix must retain the controls, admit the expanded-site candidate, and repair the generated pair rather than remove it. Candidate-stage controls do not establish a completed board. Full pipeline acceptance must still enforce connectivity, DRC, whole-copper bus skew and physical pair coupling.
