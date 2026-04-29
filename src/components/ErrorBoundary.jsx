import React from 'react';
import './ErrorBoundary.css';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-container">
          <div className="error-boundary-card">
            <div className="error-boundary-icon">💥</div>
            <h2 className="error-boundary-title">Something went wrong</h2>
            <p className="error-boundary-message">
              {this.state.error?.message || 'An unexpected error occurred in the application.'}
            </p>
            {this.state.errorInfo && (
              <details className="error-boundary-details">
                <summary>Show technical details</summary>
                <pre className="error-boundary-stack">
                  <code>{this.state.error?.stack}</code>
                </pre>
              </details>
            )}
            <div className="error-boundary-actions">
              <button className="btn btn-primary" onClick={this.handleReset}>
                Try Again
              </button>
              <button className="btn btn-ghost" onClick={() => window.location.reload()}>
                Reload Page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
