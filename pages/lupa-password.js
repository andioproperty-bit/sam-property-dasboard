import { useState } from 'react';
import Link from 'next/link';
import Head from 'next/head';
import { supabase } from '../lib/supabaseClient';
import { waAdminUrl } from '../lib/passwordUtils';
import a from '../components/Auth.module.css';

export default function LupaPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setSubmitting(false);
    if (err) {
      const code = err.code || '';
      if (err.status === 429 || code.includes('rate_limit')) {
        setError('Terlalu banyak permintaan dalam waktu singkat. Coba lagi beberapa menit lagi, atau hubungi Admin.');
      } else if (code === 'email_address_not_authorized' || /not authorized/i.test(err.message)) {
        setError('Email reset belum bisa dikirim ke alamat ini. Hubungi Admin untuk direset langsung.');
      } else {
        setError('Email reset gagal dikirim. Hubungi Admin untuk direset langsung.');
      }
      return;
    }
    setSent(true);
  }

  const waText = `Halo Admin SAM Property, saya lupa password dashboard. Email akun saya: ${email.trim() || '(isi email)'}. Mohon dibantu reset. Terima kasih.`;

  return (
    <div className="auth-wrap">
      <Head>
        <title>Lupa Password · SAM Property</title>
      </Head>
      <div className="watermark-logo">
        <img src="/logo-sam-property.jpg" alt="" />
      </div>
      <div className="auth-card">
        <div className="auth-brand">Lupa password</div>
        <div className="auth-tag">Masukkan email akun Anda. Kami kirimkan link untuk membuat password baru.</div>

        {sent ? (
          <div className={a.success}>
            Jika <b>{email.trim()}</b> terdaftar, link reset sudah dikirim. Buka email tersebut (cek juga folder Spam/Promosi),
            lalu klik <b>Reset Password</b>. Link berlaku 1 jam.
          </div>
        ) : (
          <>
            {error && <div className="auth-error">{error}</div>}
            <form onSubmit={handleSubmit}>
              <div className="field">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nama@gmail.com"
                />
              </div>
              <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={submitting}>
                {submitting ? 'Mengirim…' : 'Kirim Link Reset'}
              </button>
            </form>
          </>
        )}

        <div className={a.help}>
          Email tidak masuk atau lupa email yang dipakai? Admin bisa langsung membuatkan password baru.
          <a className={a.waBtn} href={waAdminUrl(waText)} target="_blank" rel="noreferrer">
            Hubungi Admin via WhatsApp
          </a>
        </div>
        <Link href="/login" className={`${a.link} ${a.back}`}>
          ‹ Kembali ke halaman masuk
        </Link>
      </div>
    </div>
  );
}
