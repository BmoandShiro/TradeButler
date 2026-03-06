import React, { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  pageName?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  remountKey: number;
}

export class PageErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, remountKey: 0 };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, remountKey: 0 };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Page error:", error, errorInfo);
  }

  retry = () => {
    this.setState((prev: State) => ({ ...prev, hasError: false, error: null, remountKey: prev.remountKey + 1 }));
  };

  render() {
    if (this.state.hasError && this.state.error) {
      const pageName = this.props.pageName ?? "This page";
      return (
        <div style={{ padding: "30px", maxWidth: "560px" }}>
          <h1 style={{ fontSize: "24px", fontWeight: "600", marginBottom: "12px" }}>Something went wrong</h1>
          <p style={{ color: "var(--text-secondary)", marginBottom: "16px", fontSize: "14px" }}>
            {pageName} hit an error. Try retrying or switching data mode (Demo / Real / Paper).
          </p>
          <pre style={{ background: "var(--bg-tertiary)", padding: "12px", borderRadius: "8px", fontSize: "12px", overflow: "auto", marginBottom: "16px" }}>
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={this.retry}
            style={{
              padding: "10px 20px",
              fontSize: "14px",
              fontWeight: "600",
              background: "var(--accent)",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    const child = React.Children.only(this.props.children);
    return React.cloneElement(child as React.ReactElement<{ key?: number }>, { key: this.state.remountKey });
  }
}
