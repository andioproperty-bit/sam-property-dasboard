import { useEffect, useState } from 'react';
import Link from 'next/link';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabaseClient';
import { MIN_PASSWORD, passwordStrength, strengthLabel } from '../lib/passwordUtils';
import a from '../components/Auth.module.css';

// Dipakai untuk 2 keadaan:
// 1. Membuka link "Reset Password" dari email (sesi pemulihan)
// 2. Staf yang sudah login ingin mengganti password-nya sendiri
export default function ResetPassword() {
  const router = useRouter();
  const [stage, setStage] = useState('checking'); // checking | ready | invalid | done
  const [linkError, setLinkError] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Link kedaluwarsa / sudah dipakai: Supabase menaruh keterangan error di alamat
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const query = new URLSearchParams(window.location.search);
    const errCode = hash.get('error_code') || query.get('error_code');
    if (errCode) {
      setLinkError(
        errCode === 'otp_expired'
          ? 'Link reset sudah kedaluwarsa atau sudah pernah dipakai.'
          : 'Link reset tidak valid.'
      );
      setStage('invalid');
      return undefined;
    }

    let settled = false;
    const ready = (session) => {
      if (settled || !session) return;
      settled = true;
      setEmail(session.user?.email || '');
      setStage('ready');
    };

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN' || event === 'INITIAL_SESSION') ready(session);
    });
    supabase.auth.getSession().then(({ data }) => ready(data.session));

    // Tunggu sebentar: sesi dari link email butuh waktu untuk diproses
    const t = setTimeout(() => {
      if (!settled) {
        settled = true;
        setLinkError('Sesi reset tidak ditemukan. Minta link baru, atau masuk dulu jika ingin mengganti password.');
        setStage('invalid');
      }
    }, 4000);

    return () => {
      clearTimeout(t);
      listener.subscription.unsubscribe();
    };
  }, []);

  const level = passwordStrength(pw);
  const mismatch = pw2.length > 0 && pw !== pw2;
  const canSave = pw.length >= MIN_PASSWORD && pw === pw2 && !saving;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSave) return;
    setError('');
    setSaving(true);
    const { error: err } = await supabase.auth.updateUser({ password: pw });
    setSaving(false);
    if (err) {
      const msg = err.message || '';
      if (/different from the old/i.test(msg) || err.code === 'same_password') {
        setError('Password baru tidak boleh sama dengan password lama.');
      } else if (/weak|at least/i.test(msg) || err.code === 'weak_password') {
        setError(`Password terlalu lemah. Gunakan minimal ${MIN_PASSWORD} karakter campuran huruf dan angka.`);
      } else {
        setError('Password gagal disimpan: ' + msg);
      }
      return;
    }
    setStage('done');
    setTimeout(() => router.replace('/dashboard'), 2200);
  }

  return (
    <div className="auth-wrap">
      <Head>
        <title>Buat Password Baru · SAM Property</title>
      </Head>
      <div className="watermark-logo">
        <img src="/logo-sam-property.jpg" alt="" />
      </div>
      <div className="auth-card">
        <div className="auth-brand">Password baru</div>

        {stage === 'checking' && <div className="auth-tag">Memeriksa link…</div>}

        {stage === 'invalid' && (
          <>
            <div className="auth-error" style={{ marginTop: 14 }}>
              {linkError}
            </div>
            <Link href="/lupa-password" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', textDecoration: 'none' }}>
              Minta Link Baru
            </Link>
            <Link href="/login" className={`${a.link} ${a.back}`}>
              ‹ Kembali ke halaman masuk
            </Link>
          </>
        )}

        {stage === 'done' && (
          <>
            <div className={a.success} style={{ marginTop: 14 }}>
              Password berhasil diganti. Membuka dashboard…
            </div>
            <Link href="/dashboard" className={a.link}>
              Buka dashboard sekarang
            </Link>
          </>
        )}

        {stage === 'ready' && (
          <>
            <div className="auth-tag">
              Untuk akun <b>{email}</b>
            </div>
            {error && <div className="auth-error">{error}</div>}
            <form onSubmit={handleSubmit}>
              <div className="field">
                <label htmlFor="pw">Password baru</label>
                <div className={a.pwWrap}>
                  <input
                    id="pw"
                    type={show ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    minLength={MIN_PASSWORD}
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                    placeholder={`Minimal ${MIN_PASSWORD} karakter`}
                  />
                  <button type="button" className={a.show} onClick={() => setShow((v) => !v)}>
                    {show ? 'Sembunyi' : 'Lihat'}
                  </button>
                </div>
              </div>
              {pw.length > 0 && (
                <>
                  <div className={a.meter} aria-hidden="true">
                    {[1, 2, 3].map((i) => (
                      <span key={i} className={i <= level ? a['on' + level] : ''} />
                    ))}
                  </div>
                  <div className={a.hint}>
                    {pw.length < MIN_PASSWORD
                      ? `Kurang ${MIN_PASSWORD - pw.length} karakter lagi`
                      : `Kekuatan: ${strengthLabel(level)}`}
                  </div>
                </>
              )}
              <div className="field">
                <label htmlFor="pw2">Ulangi password baru</label>
                <input
                  id="pw2"
                  type={show ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  value={pw2}
                  onChange={(e) => setPw2(e.target.value)}
                />
              </div>
              {mismatch && <div className={a.hint} style={{ color: 'var(--danger)', marginTop: -8 }}>Password tidak sama.</div>}
              <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={!canSave}>
                {saving ? 'Menyimpan…' : 'Simpan Password Baru'}
              </button>
            </form>
            <Link href="/dashboard" className={`${a.link} ${a.back}`}>
              Batal
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
