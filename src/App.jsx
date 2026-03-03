import { AuthProvider, useAuth } from './contexts/AuthContext';
import MarketingDashboard from './pages/MarketingDashboard';
import Login from './pages/Login';
import ErrorBoundary from './components/ErrorBoundary';

function AppContent() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div>Loading...</div>
      </div>
    );
  }

  return user ? <MarketingDashboard /> : <Login />;
}

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
