import React from "react";
import { clearCachedData } from "../utils/session";
import Button from "./Button";

const RELOAD_KEY = "mmp:chunk-reload-at";

// A page's code file is missing (usually: a new version was deployed while this tab was open).
const isChunkError = (error) =>
  error?.name === "ChunkLoadError" || /Loading (CSS )?chunk|dynamically imported module|Unexpected token '<'/i.test(String(error?.message || ""));

const reloadedRecently = () => {
  try {
    return Date.now() - Number(window.sessionStorage.getItem(RELOAD_KEY) || 0) < 15000;
  } catch {
    return true; // storage blocked: never risk a reload loop
  }
};

/**
 * Catches errors while drawing a page so the app never goes blank:
 * - missing page code after a deploy → reload once to get the new version;
 * - any other error → drop saved page data (it may be stale) and redraw once;
 * - still failing → a small "Something went wrong" card with Reload.
 * resetKey (the current path) clears the error when the user moves on.
 */
export default class ErrorBoundary extends React.Component {
  state = { error: null, retried: false };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Kept in the console so the cause can be found later.
    console.error("[MarkMePresent] page error", error, info?.componentStack);
    if (isChunkError(error) && !reloadedRecently()) {
      try {
        window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
      } catch {
        // ignore
      }
      window.location.reload();
      return;
    }
    if (!this.state.retried) {
      clearCachedData();
      window.setTimeout(() => this.setState({ error: null, retried: true }), 0);
    }
  }

  componentDidUpdate(previousProps) {
    if (previousProps.resetKey !== this.props.resetKey && (this.state.error || this.state.retried)) {
      this.setState({ error: null, retried: false });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (!this.state.retried && !isChunkError(this.state.error)) return null; // redrawing in a moment
    return (
      <div className="ui-crash" role="alert">
        <h1 className="ui-crash__title">Something went wrong</h1>
        <p className="ui-crash__text">This page hit a problem. Reloading usually fixes it.</p>
        <div className="ui-crash__actions">
          <Button onClick={() => window.location.reload()}>Reload</Button>
          <Button variant="ghost" onClick={() => window.location.assign("/")}>Go home</Button>
        </div>
      </div>
    );
  }
}
