import React, { Component, type ReactNode } from "react";

const FILTER_KEYS = [
  "tradebutler_analytics_filter_strategy_ids",
  "tradebutler_analytics_filter_symbols",
  "tradebutler_analytics_filter_sides",
  "tradebutler_analytics_filter_types",
  "tradebutler_analytics_filter_position_size_min",
  "tradebutler_analytics_filter_position_size_max",
  "tradebutler_analytics_filter_positions",
  "tradebutler_analytics_filter_timeframes",
  "tradebutler_analytics_filter_r_min",
  "tradebutler_analytics_filter_r_max",
];

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  remountKey: number;
}

export class AnalyticsErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, remountKey: 0 };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, remountKey: 0 };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Analytics error:", error, errorInfo);
  }

  clearFiltersAndRetry = () => {
    FILTER_KEYS.forEach((key) => localStorage.removeItem(key));
    this.setState((prev: State) => ({ ...prev, hasError: false, error: null, remountKey: prev.remountKey + 1 }));
  };

  render() {
    if (this.state.hasError && this.state.error) {
      return (
        <div style={{ padding: "30px", maxWidth: "560px" }}>
          <h1 style={{ fontSize: "24px", fontWeight: "600", marginBottom: "12px" }}>Something went wrong</h1>
          <p style={{ color: "var(--text-secondary)", marginBottom: "16px", fontSize: "14px" }}>
            The analytics page hit an error, often when a filter (e.g. Symbol) is applied. Clearing filters and retrying usually fixes it.
          </p>
          <pre style={{ background: "var(--bg-tertiary)", padding: "12px", borderRadius: "8px", fontSize: "12px", overflow: "auto", marginBottom: "16px" }}>
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={this.clearFiltersAndRetry}
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
            Clear filters and retry
          </button>
        </div>
      );
    }
    const child = React.Children.only(this.props.children);
    return React.cloneElement(child as React.ReactElement<{ key?: number }>, { key: this.state.remountKey });
  }
}
