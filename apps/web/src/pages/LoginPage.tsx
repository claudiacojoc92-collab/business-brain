import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login as apiLogin, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const res = await apiLogin(email, password);
      await login(res.access_token);
      // AuthProvider will set founder; routing in App.tsx redirects appropriately
      navigate('/', { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Login failed. Check your credentials.',
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#0a0f1a',
      padding: '24px 20px',
    }}>
      <form
        onSubmit={handleSubmit}
        style={{
          width: '100%',
          maxWidth: 400,
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        <h1 style={{ color: '#e8e6e1', fontSize: '1.5rem', fontWeight: 500, marginBottom: 8 }}>
          Business Brain
        </h1>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label htmlFor="email" style={{ color: '#6b7280', fontSize: '0.875rem' }}>Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            style={{
              background: '#111827',
              border: '1px solid #1f2937',
              borderRadius: 6,
              color: '#e8e6e1',
              fontSize: '1rem',
              padding: '12px 14px',
              outline: 'none',
              fontFamily: 'inherit',
            }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label htmlFor="password" style={{ color: '#6b7280', fontSize: '0.875rem' }}>Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            style={{
              background: '#111827',
              border: '1px solid #1f2937',
              borderRadius: 6,
              color: '#e8e6e1',
              fontSize: '1rem',
              padding: '12px 14px',
              outline: 'none',
              fontFamily: 'inherit',
            }}
          />
        </div>

        {error && (
          <p style={{ color: '#fca5a5', fontSize: '0.875rem', margin: 0 }}>{error}</p>
        )}

        <button
          type="submit"
          disabled={isLoading}
          style={{
            background: isLoading ? '#1f2937' : '#1e3a5f',
            border: 'none',
            borderRadius: 6,
            color: '#e8e6e1',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
            fontSize: '0.9375rem',
            padding: '12px',
            transition: 'background 150ms',
          }}
        >
          {isLoading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
