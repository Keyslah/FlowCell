import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const sourcePath = join(import.meta.dirname, "..", "src", "pages", "installed-page", "InstalledPageWindowPage.tsx");
const source = readFileSync(sourcePath, "utf8");
const parsed = ts.createSourceFile("InstalledPageWindowPage.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = parsed.statements.filter(statement => ts.isFunctionDeclaration(statement) &&
  ["escapeInlineScript", "buildBridgeSource"].includes(statement.name?.text));
assert.equal(functions.length, 2, "execute the production bridge builder and its escaping helper");
const compiled = ts.transpileModule(functions.map(statement => statement.getText(parsed)).join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;
const buildBridgeSource = new Function("installProgramUndoKeys", `${compiled}\nreturn buildBridgeSource;`)(() => {});

const unknownOutcome = /FLOWCELL_THEME_OUTCOME_UNKNOWN:/;
const settle = () => new Promise(resolve => setImmediate(resolve));

function bridgeHarness() {
  const messages = [];
  const listeners = new Map();
  const window = {
    location: { href: "https://flowcell-page.localhost/index.html" },
    ipc: { postMessage: serialized => messages.push(JSON.parse(serialized)) }
  };
  const nonce = "fixture-theme-nonce";
  const descriptor = {
    pageId: "theme", programName: "Blender", label: "Theme", tooltip: "Theme controls",
    config: {}, assets: [], refreshEvents: [], themeContribution: null,
    embeddedTheme: true, coreOwned: true
  };
  const context = vm.createContext({
    window,
    addEventListener(type, listener) {
      const handlers = listeners.get(type) ?? [];
      handlers.push(listener);
      listeners.set(type, handlers);
    }
  });
  vm.runInContext(buildBridgeSource(descriptor, nonce), context, { filename: "installed-theme-bridge.js" });
  const send = message => {
    for (const listener of listeners.get("message") ?? []) {
      listener({ source: window, data: { channel: "flowcell-installed-page", nonce, ...message } });
    }
  };
  return {
    api: window.flowcellPage,
    messages,
    send,
    reply(request, result = null) {
      send({ type: "response", requestId: request.requestId, ok: true, result });
    },
    actions: () => messages.filter(message => message.type === "request"),
    themeResponse: requestId => messages.find(message => message.type === "theme-response" && message.requestId === requestId)
  };
}

test("cancelling before invocation skips the handler and permits a subsequent operation", async () => {
  const h = bridgeHarness();
  const operations = [];
  h.api.setThemeHandler(operation => {
    operations.push(operation);
    return "captured";
  });
  h.send({ type: "theme-request", requestId: "cancel-before-start", operation: "apply", value: {} });
  h.send({ type: "theme-cancel", requestId: "cancel-before-start" });
  await settle();
  assert.deepEqual(operations, []);
  assert.equal(h.themeResponse("cancel-before-start").ok, false);
  assert.match(h.themeResponse("cancel-before-start").error, unknownOutcome);
  assert.equal(h.actions().length, 0);

  h.send({ type: "theme-request", requestId: "next-capture", operation: "capture" });
  await settle();
  assert.deepEqual(operations, ["capture"]);
  assert.equal(h.themeResponse("next-capture").ok, true);
  assert.equal(h.themeResponse("next-capture").result, "captured");
});

test("cancelling an awaited action rejects it and late replies cannot continue or persist", async () => {
  const h = bridgeHarness();
  let continuations = 0;
  let persistenceWrites = 0;
  h.api.setThemeHandler(async () => {
    await h.api.request("theme.apply-bundle", { fields: {} });
    continuations += 1;
    await h.api.request("state.write", { changed: true });
    persistenceWrites += 1;
  });
  h.send({ type: "theme-request", requestId: "cancel-during-action", operation: "apply", value: {} });
  await settle();
  const [action] = h.actions();
  assert.equal(action.actionId, "theme.apply-bundle");

  h.send({ type: "theme-cancel", requestId: "cancel-during-action" });
  await settle();
  assert.equal(h.themeResponse("cancel-during-action").ok, false);
  assert.match(h.themeResponse("cancel-during-action").error, unknownOutcome);

  h.reply(action, { applied: true });
  await settle();
  assert.equal(continuations, 0);
  assert.equal(persistenceWrites, 0);
  assert.equal(h.actions().length, 1);
  assert.equal(h.messages.filter(message => message.type === "theme-response" &&
    message.requestId === "cancel-during-action").length, 1);

  h.api.setThemeHandler(async () => h.api.request("state.read"));
  h.send({ type: "theme-request", requestId: "next-operation", operation: "capture" });
  await settle();
  const nextAction = h.actions().at(-1);
  assert.equal(nextAction.actionId, "state.read");
  h.reply(nextAction, { current: true });
  await settle();
  assert.equal(h.themeResponse("next-operation").ok, true);
  assert.deepEqual(h.themeResponse("next-operation").result, { current: true });
});

test("a cancelled handler cannot issue a compensating action from its rejection path", async () => {
  const h = bridgeHarness();
  let caught = 0;
  h.api.setThemeHandler(async () => {
    try {
      await h.api.request("theme.apply-bundle");
    } catch {
      caught += 1;
      await h.api.request("theme.rollback");
    }
  });
  h.send({ type: "theme-request", requestId: "cancel-catch", operation: "apply" });
  await settle();
  h.send({ type: "theme-cancel", requestId: "cancel-catch" });
  await settle();
  assert.equal(caught, 1);
  assert.equal(h.actions().length, 1);
  assert.equal(h.themeResponse("cancel-catch").ok, false);
  assert.match(h.themeResponse("cancel-catch").error, unknownOutcome);
});

test("a second request cannot invoke the handler while the first is awaiting an action", async () => {
  const h = bridgeHarness();
  let calls = 0;
  h.api.setThemeHandler(async () => {
    calls += 1;
    return h.api.request("theme.apply-bundle");
  });
  h.send({ type: "theme-request", requestId: "first", operation: "apply" });
  h.send({ type: "theme-request", requestId: "duplicate", operation: "apply" });
  await settle();
  assert.equal(calls, 1);
  assert.equal(h.actions().length, 1);
  assert.equal(h.themeResponse("duplicate").ok, false);
  assert.match(h.themeResponse("duplicate").error, /already running/);
  h.reply(h.actions()[0], "finished");
  await settle();
  assert.equal(h.themeResponse("first").ok, true);
  assert.equal(h.themeResponse("first").result, "finished");
});

test("cancellation with another nonce or request ID cannot cancel the active operation", async () => {
  const h = bridgeHarness();
  h.api.setThemeHandler(() => h.api.request("theme.apply-bundle"));
  h.send({ type: "theme-request", requestId: "active", operation: "apply" });
  await settle();
  h.send({ type: "theme-cancel", nonce: "wrong-nonce", requestId: "active" });
  h.send({ type: "theme-cancel", requestId: "another-request" });
  await settle();
  assert.equal(h.themeResponse("active"), undefined);
  h.reply(h.actions()[0], { applied: true });
  await settle();
  assert.equal(h.themeResponse("active").ok, true);
  assert.deepEqual(h.themeResponse("active").result, { applied: true });
});

test("cancellation suppresses a late handler success even when no page action is pending", async () => {
  const h = bridgeHarness();
  let release;
  h.api.setThemeHandler(() => new Promise(resolve => { release = resolve; }));
  h.send({ type: "theme-request", requestId: "late-handler", operation: "apply" });
  await settle();
  h.send({ type: "theme-cancel", requestId: "late-handler" });
  release("late success");
  await settle();
  assert.equal(h.themeResponse("late-handler").ok, false);
  assert.match(h.themeResponse("late-handler").error, unknownOutcome);
  assert.equal(h.actions().length, 0);
});
