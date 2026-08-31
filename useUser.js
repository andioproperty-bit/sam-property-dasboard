import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';

// session: undefined = belum dicek, null = tidak login, object = login
export function useUser() {
  const [session, setSession] = useState(undefined);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess ?? null);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session === undefined) return;
    if (!session) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }
    setProfileLoading(true);
    supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .single()
      .then(({ data, error }) => {
        if (error) console.error('Gagal memuat profil:', error.message);
        setProfile(data ?? null);
        setProfileLoading(false);
      });
  }, [session]);

  return {
    session,
    user: session ? session.user : null,
    profile,
    isAdmin: profile?.role === 'admin',
    loading: session === undefined || profileLoading,
  };
}
