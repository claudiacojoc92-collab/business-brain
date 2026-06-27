import { useAuth } from '../auth/AuthContext';

export function DashboardPage() {
  const { founder, logout } = useAuth();

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0a0f1a',
      padding: '40px 20px',
      color: '#e8e6e1',
    }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 48 }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 500 }}>Business Brain</h1>
          <button
            onClick={logout}
            style={{
              background: 'none',
              border: '1px solid #1f2937',
              color: '#6b7280',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: '0.875rem',
              padding: '6px 14px',
              borderRadius: 4,
            }}
          >
            Sign out
          </button>
        </div>

        <p style={{ color: '#6b7280', fontSize: '1rem', lineHeight: 1.7 }}>
          Welcome, {founder?.name ?? 'founder'}. Your first brief arrives Monday morning.
        </p>
      </div>
    </div>
  );
}
