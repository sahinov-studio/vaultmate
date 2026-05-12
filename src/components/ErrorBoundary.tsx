import { Component, type ReactNode } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("VaultMate UI error:", error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 px-4">
        <div className="w-full max-w-lg rounded-2xl border border-red-500/30 bg-slate-900 p-8 text-center shadow-xl">
          <div className="mb-4 flex flex-col items-center gap-2">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/20">
              <AlertTriangle className="h-6 w-6 text-red-500" />
            </div>
            <h1 className="text-lg font-semibold text-white">Something went wrong</h1>
          </div>
          <p className="mb-4 text-sm text-slate-400">
            VaultMate encountered an unexpected error. Your vault data is safe — try
            reloading the app.
          </p>
          <pre className="mb-5 max-h-40 overflow-auto rounded-lg bg-slate-950 px-3 py-2 text-left text-xs text-red-300">
            {this.state.error.message}
          </pre>
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            <RotateCw className="h-4 w-4" /> Reload
          </button>
        </div>
      </div>
    );
  }
}
