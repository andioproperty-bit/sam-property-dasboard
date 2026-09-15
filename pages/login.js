import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabaseClient';
import { useUser } from '../lib/useUser';

export default function Login() {
  const router = useRouter();
  const { session, loading } = useUser();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && session) router.replace('/dashboard');
  }, [session, loading, router]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (error) {
      setError('Email atau password salah.');
      return;
    }
    router.replace('/dashboard');
  }

  return (
    <div className="auth-wrap">
      <div className="watermark-logo"><img src="/logo-sam-property.jpg" alt="" /></div>
      <div className="auth-card">
        <div className="auth-brand">SAM Property</div>
        <div className="auth-tag">Masuk ke dashboard internal</div>

        {error && <div className="auth-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nama@sampropertyagency.com"
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={submitting}>
            {submitting ? 'Memproses...' : 'Masuk'}
          </button>
        </form>

        <div className="auth-note">
          Belum punya akun? Akun staf internal dibuat oleh Admin, bukan lewat pendaftaran sendiri.
          Hubungi Admin SAM Property untuk dibuatkan akses.
        </div>
      </div>
    </div>
  );
}
