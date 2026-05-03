import React from 'react';

interface State {
  hasError: boolean;
}

class ErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2rem', textAlign: 'center', fontFamily: 'inherit' }}>
          <p style={{ marginBottom: '1rem' }}>Something went wrong. Please refresh the page.</p>
          <button
            onClick={() => this.setState({ hasError: false })}
            style={{ padding: '8px 16px', cursor: 'pointer', borderRadius: '8px', border: '1px solid #ccc' }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
