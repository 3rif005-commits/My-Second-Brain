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
      timeout: 1_200_000,
      retries: 0,
    },

    // Background jobs, M2: the monthly limit refuses a job BEFORE any model is
    // called (free), and the refusal shows on the Activity page, sidebar and bell.
    // Restores the limit it changes; deletes its note and job.
    {
      name: "background-activity",
      testMatch: "**/background-activity-live.spec.ts",
      dependencies: ["auth-setup"],
      use: { storageState: AUTH_FILE },
      timeout: 300_000,
      retries: 0,
    },

    // Background jobs, M3: a REAL half-price batch through the provider. Spends one
    // small batch call (~$0.005–0.03 on the tiny test PDF) plus one cancelled
    // batch. A batch usually ends in minutes but may take up to 24 h: the test
    // waits up to 25 min for it. Deletes its note and jobs.
    {
      name: "background-batch",
      testMatch: "**/background-batch-live.spec.ts",
      dependencies: ["auth-setup"],
      use: { storageState: AUTH_FILE },
      timeout: 1_800_000,
      retries: 0,
    },

    // Background jobs, M5 live-pass helper: creates a real note + schedule
    // and prints its ids for a companion script to fast-forward. Free.
    {
      name: "background-schedule-setup",
      testMatch: "**/background-schedule-setup.spec.ts",
      dependencies: ["auth-setup"],
      use: { storageState: AUTH_FILE },
      timeout: 240_000,
      retries: 0,
    },

    // Background jobs, M4: "when a source is added", live and free — two
    // sources settling close together must produce one job, waiting out the
    // real 2-minute debounce and the scheduler's own tick. Trashes its note.
    {
      name: "background-trigger",
      testMatch: "**/background-trigger-live.spec.ts",
      dependencies: ["auth-setup"],
      use: { storageState: AUTH_FILE },
      timeout: 400_000,
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
