# Sodium repository guidance

Before changing this app:

1. Read `SODIUM_MASTER_STATE.md` completely.
2. Inspect the actual working tree and recent commits; the repository is the implementation source of truth.
3. Preserve uncommitted work from other Sodium development threads.
4. Keep the current visual identity, swirl icon, data, and working features unless the user explicitly requests a change.
5. Treat migrations as additive and data-preserving. Verify whether a migration is already live before rerunning it.
6. Use the user's supplied surf photographs in documentation and marketing assets; do not introduce random stock or AI surf photography.
7. Do not update PDFs or one-pagers for minor UI changes unless the user asks.

When a conversation introduces a durable product decision, update `SODIUM_MASTER_STATE.md` so future Sodium chats inherit it from the repository.
