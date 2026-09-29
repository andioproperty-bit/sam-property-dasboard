import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../../lib/supabaseClient';
import { useUser } from '../../lib/useUser';
import { useToast } from '../../lib/useToast';
import Sidebar from '../../components/Sidebar';
import OverviewTab from '../../components/OverviewTab';
import ListingsTab from '../../components/ListingsTab';
import LeadsTab from '../../components/LeadsTab';
   import ChatTab from '../../components/ChatTab';
import TransactionsTab from '../../components/TransactionsTab';
import StaffTab from '../../components/StaffTab';

export default function Dashboard() {
  const router = useRouter();
  const { session, user, profile, isAdmin, loading } = useUser();
  const { showToast, ToastEl } = useToast();

  const [activeTab, setActiveTab] = useState('overview');
  const [data, setData] = useState({ properties: [], leads: [], transactions: [], profiles: [] });
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    if (!loading && !session) router.replace('/login');
  }, [session, loading, router]);

  const fetchAll = useCallback(async () => {
    setDataLoading(true);
    const [props, leads, trx, profs] = await Promise.all([
      supabase.from('properties').select('*'),
      supabase.from('leads').select('*'),
      supabase.from('transactions').select('*'),
      supabase.from('profiles').select('*'),
    ]);
    setData({
      properties: props.data || [],
      leads: leads.data || [],
      transactions: trx.data || [],
      profiles: profs.data || [],
    });
    setDataLoading(false);
  }, []);

  useEffect(() => {
    if (session) fetchAll();
  }, [session, fetchAll]);

  if (loading || !session || !profile) {
    return <div className="full-loading">Memuat dashboard...</div>;
  }

  return (
    <div className="app">
      <Sidebar activeTab={activeTab} onChangeTab={setActiveTab} profile={profile} isAdmin={isAdmin} />
      <main className="main">
        <div className="watermark-logo"><img src="/logo-sam-property.jpg" alt="" /></div>
        {dataLoading ? (
          <div className="full-loading" style={{ minHeight: '40vh' }}>Memuat data...</div>
        ) : (
          <>
            {activeTab === 'overview' && (
              <OverviewTab properties={data.properties} leads={data.leads} transactions={data.transactions} profiles={data.profiles} />
            )}
            {activeTab === 'listings' && (
              <ListingsTab properties={data.properties} profiles={data.profiles} user={user} isAdmin={isAdmin} refresh={fetchAll} showToast={showToast} />
            )}
            {activeTab === 'leads' && (
              <LeadsTab leads={data.leads} properties={data.properties} profiles={data.profiles} user={user} isAdmin={isAdmin} refresh={fetchAll} showToast={showToast} />
                 {activeTab === 'chat' && (
     <ChatTab user={user} isAdmin={isAdmin} profiles={data.profiles} showToast={showToast} />
            )}
            {activeTab === 'transactions' && (
              <TransactionsTab transactions={data.transactions} properties={data.properties} leads={data.leads} profiles={data.profiles} user={user} isAdmin={isAdmin} refresh={fetchAll} showToast={showToast} />
            )}
            {activeTab === 'staff' && isAdmin && (
              <StaffTab profiles={data.profiles} transactions={data.transactions} isAdmin={isAdmin} refresh={fetchAll} showToast={showToast} />
            )}
          </>
        )}
      </main>
      {ToastEl}
    </div>
  );
}
