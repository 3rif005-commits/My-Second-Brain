import { defineConfig } from "@playwright/test";
import path from "path";

const AUTH_FILE = path.join(process.cwd(), "e2e/.auth/user.json");

export default defineConfig({
  testDir: "./e2e",
  timeout: 60000,
  retries: 1,

  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    viewport: { width: 1280, height: 800 },
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  reporter: [["list"]],

  projects: [
    // 1. Auth setup — runs first, saves session to e2e/.auth/user.json
    {
      name: "auth-setup",
      testMatch: "**/setup/auth.setup.ts",
    },

    // 2. Protected-route tests — run WITHOUT auth (tests explicitly clear state)
    {
      name: "protected-routes",
      testMatch: "**/01-protected-routes.spec.ts",
    },

    // 3. Note CRUD tests — run WITH the saved auth session
    {
      name: "notes-crud",
      testMatch: "**/02-notes-crud.spec.ts",
      dependencies: ["auth-setup"],
      use: { storageState: AUTH_FILE },
    },

    // 4. Workspace action bar — drop a source, check the jobs it offers.
    //    No model call: the drop policy is "suggest" and the test stops at the
    //    offer, so it does not depend on a provider's daily quota.
    {
      name: "workspace-skills",
      testMatch: "**/workspace-skills.spec.ts",
      dependencies: ["auth-setup"],
      use: { storageState: AUTH_FILE },
      timeout: 240_000,
    },

    // 4b. A skill run on real lectures. SPENDS MODEL QUOTA — run it on purpose,
    //     never as part of a sweep. Needs LECTURE_A / LECTURE_B.
    {
      name: "skills-live",
      testMatch: /(compare-sources|selection-skills|study-guide|undo-refusal|chat-job|one-ai|panel-job|panel-guide-three)-live\.spec\.ts/,
      dependencies: ["auth-setup"],
      use: { storageState: AUTH_FILE },
      timeout: 600_000,
      retries: 0,          // a retry is a second paid run
    },

    // 4c. Skills from the app-wide AI panel — free: attaches, runs no model.
    {
      name: "panel-skills",
      testMatch: "**/panel-skills.spec.ts",
      dependencies: ["auth-setup"],
      use: { storageState: AUTH_FILE },
      timeout: 240_000,
    },

    // 4d. Settings → Skills. Free; restores whatever it changes.
    {
      name: "settings-skills",
      testMatch: "**/settings-skills.spec.ts",
      dependencies: ["auth-setup"],
      use: { storageState: AUTH_FILE },
      timeout: 180_000,
    },

    // 4c. The run card's failure path. Free, but only meaningful against a
    //     backend started with MAX_USD_PER_RUN=0.001 (every job refused).
    // The remote MCP server (5.4), live and free: Allow page, token, tools.
    {
      name: "mcp-remote",
      testMatch: "**/mcp-remote-live.spec.ts",
      dependencies: ["auth-setup"],
      use: { storageState: AUTH_FILE },
      retries: 0,
    },

    // Background jobs (5.3), live: Run later → card → Run now → result card
    // labelled Background → Put in note → Undo; then queue + Cancel. Spends one
    // small call (the tiny test PDF); deletes its note.
    {
      name: "background-jobs",
      testMatch: "**/background-jobs-live.spec.ts",
      dependencies: ["auth-setup"],
      use: { storageState: AUTH_FILE },
      timeout: 540_000,
      retries: 0,
    },

    {
      name: "run-card",
      testMatch: "**/run-card-failure.spec.ts",
      dependencies: ["auth-setup"],
      use: { storageState: AUTH_FILE },
      timeout: 180_000,
    },

    // 5. Phase 2 ingest tests — PDF + YouTube URL
    {
      name: "ingest",
      testMatch: "**/03-ingest.spec.ts",
      dependencies: ["auth-setup"],
      use: { storageState: AUTH_FILE },
      timeout: 360_000, // LLM generation can be slow on free-tier models
    },
  ],
});
