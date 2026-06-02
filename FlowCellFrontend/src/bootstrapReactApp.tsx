import React, { Component, type ComponentType, type ErrorInfo, type ReactNode } from "react";
import ReactDOM from "react-dom/client";

type RootComponentModule = {
  default: ComponentType;
};

type RootErrorBoundaryProps = {
  children: ReactNode;
};

type RootErrorBoundaryState = {
  error: Error | null;
};

type LoadRootComponent = () => Promise<RootComponentModule>;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatCrashDetail(detail: unknown): string {
  if (detail instanceof Error) {
    return detail.stack || detail.message;
  }

  if (typeof detail === "string") {
    return detail;
  }

  try {
    return JSON.stringify(detail, null, 2);
  } catch {
    return String(detail);
  }
}

function writeFatalScreen(title: string, detail: unknown) {
  const rootElement = document.getElementById("root");
  if (!rootElement) {
    return;
  }

  rootElement.innerHTML = `
    <section class="app-crash-screen">
      <h1>${escapeHtml(title)}</h1>
      <pre>${escapeHtml(formatCrashDetail(detail))}</pre>
    </section>
  `;
}

class RootErrorBoundary extends Component<RootErrorBoundaryProps, RootErrorBoundaryState> {
  state: RootErrorBoundaryState = {
    error: null
  };

  static getDerivedStateFromError(error: Error): RootErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("FlowCell root render failed.", error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return (
        <section className="app-crash-screen">
          <h1>FlowCell window failed to render.</h1>
          <pre>{formatCrashDetail(this.state.error)}</pre>
        </section>
      );
    }

    return this.props.children;
  }
}

export async function bootstrapReactApp(loadRootComponent: LoadRootComponent) {
  window.addEventListener("error", (event) => {
    writeFatalScreen("FlowCell window crashed.", event.error ?? event.message);
  });

  window.addEventListener("unhandledrejection", (event) => {
    writeFatalScreen("FlowCell window rejected during startup.", event.reason);
  });

  try {
    const { default: RootComponent } = await loadRootComponent();
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        <RootErrorBoundary>
          <RootComponent />
        </RootErrorBoundary>
      </React.StrictMode>
    );
  } catch (error) {
    writeFatalScreen("FlowCell window failed before React mounted.", error);
  }
}
