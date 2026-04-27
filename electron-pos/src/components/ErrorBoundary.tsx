import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-surface-1 flex flex-col items-center justify-center p-4">
          <div className="bg-surface-2 border border-danger/30 rounded-xl p-8 max-w-lg w-full text-center shadow-float">
            <div className="w-16 h-16 bg-danger/10 rounded-full flex items-center justify-center mx-auto mb-6">
              <AlertTriangle className="w-8 h-8 text-danger" />
            </div>
            <h1 className="text-2xl font-bold text-text-primary mb-2">Something went wrong</h1>
            <p className="text-text-secondary mb-6">
              The application encountered an unexpected error. Your data should be safe, as it is saved locally.
            </p>
            
            <div className="bg-surface-1 rounded p-4 mb-6 overflow-auto max-h-32 text-left border border-surface-4">
              <p className="text-xs font-mono text-danger/80 break-all">
                {this.state.error?.message || "Unknown error"}
              </p>
            </div>

            <button 
              onClick={() => window.location.reload()} 
              className="btn-primary w-full flex items-center justify-center gap-2 h-12"
            >
              <RefreshCw className="w-4 h-4" /> Restart Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
