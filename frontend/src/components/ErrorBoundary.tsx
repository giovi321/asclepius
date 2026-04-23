import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  /** Logical label for the boundary, shown in the fallback copy. */
  label?: string;
}

interface State {
  error: Error | null;
}

/**
 * Per-page error boundary: catches render-time exceptions so one crashing
 * page doesn't blank the whole app shell. The fallback keeps navigation
 * visible (we wrap below the layout, not around it) and offers a reload.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error("ErrorBoundary caught:", error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="p-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-5">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <h2 className="text-base font-semibold">
              {this.props.label ? `Something went wrong in ${this.props.label}` : "Something went wrong"}
            </h2>
          </div>
          <p className="text-sm text-muted-foreground">
            The page failed to render. Other areas of the app should still work. Try reloading the page
            or navigating elsewhere.
          </p>
          <pre className="max-h-48 overflow-auto rounded bg-background/60 p-2 text-xs text-foreground/80">
            {this.state.error.message}
          </pre>
          <div className="flex gap-2">
            <button
              onClick={this.reset}
              className="inline-flex items-center gap-1 rounded-md border px-3 py-1 text-sm hover:bg-accent"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </button>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-1 rounded-md border px-3 py-1 text-sm hover:bg-accent"
            >
              Reload page
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
