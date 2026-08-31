import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useUser } from '../lib/useUser';

export default function Home() {
  const router = useRouter();
  const { session, loading } = useUser();

  useEffect(() => {
    if (loading) return;
    router.replace(session ? '/dashboard' : '/login');
  }, [session, loading, router]);

  return <div className="full-loading">Memuat...</div>;
}
