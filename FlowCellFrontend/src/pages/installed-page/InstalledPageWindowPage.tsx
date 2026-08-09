import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useMemo, useRef, useState } from "react";

import type { InstalledPageWindowContext } from "../../lib/windowContext";
import {
  isInstalledPageCoreActionPlan,
  runInstalledPageCoreAction
} from "./installedPageCoreBroker";
import "./installedPageWindowPage.css";

interface InstalledPageTextResource {
  path: string;
  content: string;
}

interface InstalledPageAssetResource {
  path: string;
  mimeType: string;
  base64: string;
}

interface InstalledPageDescriptor {
  ownerButtonId: string;
  programId: string;
  programName: string;
  panelName: string;
  fileName: string;
  sourceRecordId: string;
  installedOwnerRoot: string;
  pageId: string;
  label: string;
  tooltip: string;
  entryHtml: string;
  scripts: InstalledPageTextResource[];
  styles: InstalledPageTextResource[];
  assets: InstalledPageAssetResource[];
  window: {
    title: string;
    width: number;
    height: number;
    minWidth: number;
    minHeight: number;
    alwaysOnTop: boolean;
  };
  declaredResourcePaths: string[];
  declaredActions: unknown[];
  declaredCapabilities: string[];
  ownerRuntimeStateNamespace: string;
  sharedProgramDataNamespace?: string;
  supportedDataFormats: string[];
  config: unknown;
  refreshEvents: string[];
}

interface PageRequestMessage {
  channel: "flowcell-installed-page";
  type: "request";
  nonce: string;
  requestId: string;
  actionId: string;
  payload: unknown;
}

interface PageSecurityProbeMessage {
  channel: "flowcell-installed-page";
  type: "security-probe";
  nonce: string;
  href: string;
  hasTauriInternals: boolean;
  hasTauriInvoke: boolean;
  hasTauriGlobal: boolean;
  hasNodeProcess: boolean;
  hasFlowcellPage: boolean;
  hasRawWryIpc: boolean;
}

interface InstalledPageNativeMessage {
  messageJson: string;
}

interface CompletedPageActionResult {
  kind: "complete";
  value: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPageRequestMessage(value: unknown, nonce: string): value is PageRequestMessage {
  if (!isRecord(value)) return false;
  return value.channel === "flowcell-installed-page" &&
    value.type === "request" &&
    value.nonce === nonce &&
    typeof value.requestId === "string" &&
    value.requestId.length > 0 &&
    value.requestId.length <= 160 &&
    typeof value.actionId === "string" &&
    value.actionId.length > 0 &&
    value.actionId.length <= 160;
}

function isPageSecurityProbeMessage(
  value: unknown,
  nonce: string
): value is PageSecurityProbeMessage {
  if (!isRecord(value)) return false;
  return value.channel === "flowcell-installed-page" &&
    value.type === "security-probe" &&
    value.nonce === nonce &&
    typeof value.href === "string" &&
    typeof value.hasTauriInternals === "boolean" &&
    typeof value.hasTauriInvoke === "boolean" &&
    typeof value.hasTauriGlobal === "boolean" &&
    typeof value.hasNodeProcess === "boolean" &&
    typeof value.hasFlowcellPage === "boolean" &&
    typeof value.hasRawWryIpc === "boolean";
}

function escapeInlineScript(source: string): string {
  return source.replace(/<\/script/gi, "<\\/script");
}

function replaceDeclaredAssetPaths(
  source: string,
  assets: readonly InstalledPageAssetResource[]
): string {
  return [...assets]
    .sort((left, right) => right.path.length - left.path.length)
    .reduce((current, asset) => {
      const dataUrl = `data:${asset.mimeType};base64,${asset.base64}`;
      return current.split(asset.path).join(dataUrl);
    }, source);
}

function insertBeforeClosingTag(source: string, tag: "head" | "body", content: string): string {
  const pattern = new RegExp(`</${tag}\\s*>`, "i");
  if (pattern.test(source)) return source.replace(pattern, `${content}</${tag}>`);
  if (tag === "head") return `${content}${source}`;
  return `${source}${content}`;
}

function sanitizeEntryHtml(source: string): string {
  const parsed = new DOMParser().parseFromString(source, "text/html");
  parsed.querySelectorAll(
    "script, style, link, base, iframe, frame, frameset, object, embed, portal, template, meta[http-equiv]"
  ).forEach((element) => element.remove());
  parsed.querySelectorAll("*").forEach((element) => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLocaleLowerCase("en");
      const value = attribute.value.trim().toLocaleLowerCase("en");
      const isEventHandler = name.startsWith("on");
      const isActiveDocumentAttribute = [
        "srcdoc", "action", "formaction", "ping", "integrity", "nonce"
      ].includes(name);
      const isUnsafeUrl = ["src", "href", "xlink:href", "poster"].includes(name) &&
        Boolean(value) &&
        !value.startsWith("data:") &&
        !value.startsWith("blob:") &&
        !value.startsWith("#");
      if (isEventHandler || isActiveDocumentAttribute || isUnsafeUrl || name === "style") {
        element.removeAttribute(attribute.name);
      }
    }
  });
  return `<!doctype html>\n${parsed.documentElement.outerHTML}`;
}

function buildBridgeSource(descriptor: InstalledPageDescriptor, nonce: string): string {
  const publicDescriptor = {
    pageId: descriptor.pageId,
    label: descriptor.label,
    tooltip: descriptor.tooltip,
    config: descriptor.config,
    assets: Object.fromEntries(descriptor.assets.map((asset) => [
      asset.path,
      `data:${asset.mimeType};base64,${asset.base64}`
    ])),
    refreshEvents: descriptor.refreshEvents
  };
  return escapeInlineScript(`(() => {
    "use strict";
    const channel = "flowcell-installed-page";
    const nonce = ${JSON.stringify(nonce)};
    const nativePostMessage = window.ipc && typeof window.ipc.postMessage === "function"
      ? window.ipc.postMessage.bind(window.ipc)
      : null;
    if (!nativePostMessage) throw new Error("The isolated FlowCell page bridge is unavailable.");
    const sendNative = (message) => nativePostMessage(JSON.stringify(message));
    const tauriInternals = window.__TAURI_INTERNALS__;
    const hasTauriInternals = Object.prototype.hasOwnProperty.call(window, "__TAURI_INTERNALS__");
    const hasTauriInvoke = Boolean(tauriInternals && typeof tauriInternals.invoke === "function");
    const hasTauriGlobal = Object.prototype.hasOwnProperty.call(window, "__TAURI__");
    const hasNodeProcess = Boolean(window.process && window.process.versions && window.process.versions.node);
    const sendSecurityProbe = (hasFlowcellPage) => sendNative(Object.freeze({
      channel,
      type: "security-probe",
      nonce,
      href: window.location.href,
      hasTauriInternals,
      hasTauriInvoke,
      hasTauriGlobal,
      hasNodeProcess,
      hasFlowcellPage,
      hasRawWryIpc: Boolean(window.ipc && typeof window.ipc.postMessage === "function")
    }));
    if (hasTauriInternals || hasTauriInvoke || hasTauriGlobal || hasNodeProcess) {
      sendSecurityProbe(false);
      throw new Error("Installed page isolation failed closed because a privileged runtime was exposed.");
    }
    const pending = new Map();
    let sequence = 0;
    const descriptor = Object.freeze(${JSON.stringify(publicDescriptor)});
    const request = (actionId, payload = {}) => new Promise((resolve, reject) => {
      if (typeof actionId !== "string" || !actionId.trim()) {
        reject(new Error("A declared page action ID is required."));
        return;
      }
      const requestId = String(Date.now()) + "-" + String(++sequence);
      pending.set(requestId, { resolve, reject });
      sendNative({ channel, type: "request", nonce, requestId, actionId, payload });
    });
    Object.defineProperty(window, "flowcellPage", {
      value: Object.freeze({ descriptor, request }),
      writable: false,
      configurable: false
    });
    sendSecurityProbe(Boolean(window.flowcellPage && typeof window.flowcellPage.request === "function"));
    addEventListener("message", (event) => {
      if (event.source !== window || !event.data || event.data.channel !== channel ||
          event.data.nonce !== nonce) return;
      if (event.data.type === "response") {
        const entry = pending.get(event.data.requestId);
        if (!entry) return;
        pending.delete(event.data.requestId);
        if (event.data.ok === true) entry.resolve(event.data.result);
        else entry.reject(new Error(typeof event.data.error === "string" ? event.data.error : "Page action failed."));
      } else if (event.data.type === "refresh") {
        dispatchEvent(new CustomEvent("flowcell:page-refresh", { detail: {
          eventId: event.data.eventId,
          payload: event.data.payload
        }}));
      }
    });
    addEventListener("DOMContentLoaded", () => {
      document.addEventListener("submit", (event) => event.preventDefault(), true);
      document.addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target.closest("a") : null;
        if (target) event.preventDefault();
      }, true);
      dispatchEvent(new CustomEvent("flowcell:page-ready", { detail: descriptor }));
    }, { once: true });
  })();`);
}

function buildIsolatedPageDocument(descriptor: InstalledPageDescriptor, nonce: string): string {
  const csp = [
    "default-src 'none'",
    "base-uri 'none'",
    "connect-src 'none'",
    "child-src 'none'",
    "font-src data:",
    "form-action 'none'",
    "frame-src 'none'",
    "img-src data: blob:",
    "manifest-src 'none'",
    "media-src data: blob:",
    "object-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "worker-src 'none'"
  ].join("; ");
  const head = [
    `<meta http-equiv="Content-Security-Policy" content=${JSON.stringify(csp)}>`,
    '<meta name="referrer" content="no-referrer">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    ...descriptor.styles.map((style) =>
      `<style data-flowcell-page-resource=${JSON.stringify(style.path)}>${replaceDeclaredAssetPaths(style.content, descriptor.assets)}</style>`
    )
  ].join("\n");
  const scripts = [
    `<script>${buildBridgeSource(descriptor, nonce)}</script>`,
    ...descriptor.scripts.map((script) =>
      `<script data-flowcell-page-resource=${JSON.stringify(script.path)}>${escapeInlineScript(
        replaceDeclaredAssetPaths(script.content, descriptor.assets)
      )}</script>`
    )
  ].join("\n");
  let document = sanitizeEntryHtml(
    replaceDeclaredAssetPaths(descriptor.entryHtml, descriptor.assets)
  );
  document = insertBeforeClosingTag(document, "head", head);
  document = insertBeforeClosingTag(document, "body", scripts);
  return document;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function InstalledPageWindowPage({
  context
}: {
  context: InstalledPageWindowContext;
}) {
  const [descriptor, setDescriptor] = useState<InstalledPageDescriptor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isolationVerified, setIsolationVerified] = useState(false);
  const closeInProgressRef = useRef(false);
  const nonce = useMemo(() => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }, []);
  const pageDocument = useMemo(
    () => descriptor ? buildIsolatedPageDocument(descriptor, nonce) : "",
    [descriptor, nonce]
  );

  useEffect(() => {
    let disposed = false;
    setDescriptor(null);
    setError(null);
    setIsolationVerified(false);
    void invoke<InstalledPageDescriptor>("resolve_installed_page", {
      ownerButtonId: context.ownerButtonId,
      programName: context.programName,
      panelName: context.panelName,
      fileName: context.fileName,
      pageId: context.pageId
    }).then(async (resolved) => {
      if (disposed) return;
      setDescriptor(resolved);
      await getCurrentWindow().setTitle(`FlowCell - ${resolved.window.title}`).catch(() => {});
    }).catch((reason) => {
      if (!disposed) setError(formatError(reason));
    });
    return () => {
      disposed = true;
    };
  }, [context]);

  useEffect(() => {
    if (!descriptor) return;
    let disposed = false;
    let unlistenNative: UnlistenFn | null = null;
    let unlistenClose: UnlistenFn | null = null;
    let unlistenResize: UnlistenFn | null = null;
    let isolationProofReceived = false;
    let isolationProofTimeout: ReturnType<typeof setTimeout> | null = null;
    const postToPage = (message: Record<string, unknown>) =>
      invoke<void>("post_installed_page_webview_message", {
        messageJson: JSON.stringify(message)
      });
    const handlePageRequest = (message: PageRequestMessage) => {
      if (disposed) return;
      const payloadJson = JSON.stringify(message.payload ?? null);
      if (payloadJson.length > 1024 * 1024) {
        void postToPage({
          channel: "flowcell-installed-page",
          type: "response",
          nonce,
          requestId: message.requestId,
          ok: false,
          error: "Page action payload exceeds the 1 MiB request limit."
        }).catch((reason) => {
          if (!disposed) setError(formatError(reason));
        });
        return;
      }
      const identity = {
        ownerButtonId: context.ownerButtonId,
        programName: context.programName,
        panelName: context.panelName,
        fileName: context.fileName,
        pageId: context.pageId
      };
      void invoke<CompletedPageActionResult | unknown>("run_installed_page_action", {
        ...identity,
        actionId: message.actionId,
        payloadJson
      }).then(async (runResult) => {
        if (isInstalledPageCoreActionPlan(runResult)) {
          const brokerResponse = await runInstalledPageCoreAction(
            identity,
            message.actionId,
            runResult
          );
          return invoke<unknown>("complete_installed_page_core_action", {
            ...identity,
            actionId: message.actionId,
            responseJson: JSON.stringify(brokerResponse)
          });
        }
        if (!isRecord(runResult) || runResult.kind !== "complete") {
          throw new Error("Installed page action returned an invalid broker result.");
        }
        return (runResult as unknown as CompletedPageActionResult).value;
      }).then((result) => postToPage({
        channel: "flowcell-installed-page",
        type: "response",
        nonce,
        requestId: message.requestId,
        ok: true,
        result
      })).catch((reason) => {
        void postToPage({
          channel: "flowcell-installed-page",
          type: "response",
          nonce,
          requestId: message.requestId,
          ok: false,
          error: formatError(reason)
        }).catch((postReason) => {
          if (!disposed) setError(formatError(postReason));
        });
      });
    };
    void (async () => {
      const disposeNative = await listen<InstalledPageNativeMessage>(
        "flowcell-installed-page-native-message",
        (event) => {
          if (disposed || typeof event.payload?.messageJson !== "string") return;
          let message: unknown;
          try {
            message = JSON.parse(event.payload.messageJson);
          } catch {
            return;
          }
          if (isPageSecurityProbeMessage(message, nonce)) {
            isolationProofReceived = true;
            if (isolationProofTimeout !== null) {
              clearTimeout(isolationProofTimeout);
              isolationProofTimeout = null;
            }
            const verified = message.href === "https://flowcell-page.localhost/index.html" &&
              !message.hasTauriInternals &&
              !message.hasTauriInvoke &&
              !message.hasTauriGlobal &&
              !message.hasNodeProcess &&
              message.hasFlowcellPage &&
              message.hasRawWryIpc;
            setIsolationVerified(verified);
            if (!verified) {
              setError("Installed page isolation failed closed because its default execution context was not isolated.");
              void invoke("unmount_installed_page_webview").catch(() => {});
            }
            return;
          }
          if (isPageRequestMessage(message, nonce)) handlePageRequest(message);
        }
      );
      if (disposed) {
        disposeNative();
        return;
      }
      unlistenNative = disposeNative;
      const currentWindow = getCurrentWindow();
      const disposeClose = await currentWindow.onCloseRequested((event) => {
        event.preventDefault();
        if (closeInProgressRef.current) return;
        closeInProgressRef.current = true;
        void invoke<void>("unmount_installed_page_webview").then(async () => {
          if (!disposed) await currentWindow.destroy();
        }).catch((reason) => {
          if (!disposed) setError(formatError(reason));
        }).finally(() => {
          closeInProgressRef.current = false;
        });
      });
      if (disposed) {
        disposeClose();
        await invoke("unmount_installed_page_webview").catch(() => {});
        return;
      }
      unlistenClose = disposeClose;
      await invoke("mount_installed_page_webview", {
        html: pageDocument,
        nonce
      });
      if (disposed) {
        await invoke("unmount_installed_page_webview").catch(() => {});
        return;
      }
      if (!isolationProofReceived) {
        isolationProofTimeout = setTimeout(() => {
          isolationProofTimeout = null;
          if (disposed || isolationProofReceived) return;
          setIsolationVerified(false);
          setError("Installed page isolation failed closed because its default-world proof was not received.");
          void invoke("unmount_installed_page_webview").catch(() => {});
        }, 5_000);
      }
      const disposeResize = await currentWindow.onResized(({ payload }) => {
        void invoke("resize_installed_page_webview", {
          width: payload.width,
          height: payload.height
        }).catch((reason) => {
          if (!disposed) setError(formatError(reason));
        });
      });
      if (disposed) disposeResize(); else unlistenResize = disposeResize;
    })().catch((reason) => {
      if (!disposed) {
        setIsolationVerified(false);
        setError(formatError(reason));
      }
      void invoke("unmount_installed_page_webview").catch(() => {});
    });
    return () => {
      disposed = true;
      if (isolationProofTimeout !== null) clearTimeout(isolationProofTimeout);
      unlistenNative?.();
      unlistenClose?.();
      unlistenResize?.();
      void invoke("unmount_installed_page_webview").catch(() => {});
    };
  }, [context, descriptor, nonce, pageDocument]);

  useEffect(() => {
    if (!descriptor || !isolationVerified || descriptor.refreshEvents.length === 0) return;
    let disposed = false;
    const unlisten: UnlistenFn[] = [];
    void Promise.all(descriptor.refreshEvents.map(async (eventId) => {
      const dispose = await listen<unknown>(eventId, (event) => {
        void invoke("post_installed_page_webview_message", {
          messageJson: JSON.stringify({
            channel: "flowcell-installed-page",
            type: "refresh",
            nonce,
            eventId,
            payload: event.payload
          })
        }).catch((reason) => {
          if (!disposed) setError(formatError(reason));
        });
      });
      if (disposed) dispose(); else unlisten.push(dispose);
    })).catch((reason) => {
      if (!disposed) setError(formatError(reason));
    });
    return () => {
      disposed = true;
      unlisten.forEach((dispose) => dispose());
    };
  }, [descriptor, isolationVerified, nonce]);

  if (error) {
    return (
      <main className="installed-page-host installed-page-host--error">
        <h1>Installed page unavailable</h1>
        <p>{error}</p>
      </main>
    );
  }
  if (!descriptor || !isolationVerified) {
    return <main className="installed-page-host installed-page-host--loading">Loading installed page…</main>;
  }
  return <main className="installed-page-host" aria-label={descriptor.window.title} />;
}
