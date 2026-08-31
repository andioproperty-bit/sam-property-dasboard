import { supabase } from '../lib/supabaseClient';

const NAV_ITEMS = [
  { key: 'overview', label: 'Ringkasan', icon: <path d="M3 11l9-8 9 8M5 10v10h14V10" /> },
  { key: 'listings', label: 'Listing Properti', icon: <><rect x="3" y="7" width="18" height="14" rx="1" /><path d="M8 7V4h8v3" /></> },
  { key: 'leads', label: 'Leads', icon: <><circle cx="9" cy="8" r="3.2" /><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" /><path d="M16 8.5a3 3 0 110 5.4" /><path d="M21.5 20c0-2.8-1.7-4.9-4-5.7" /></> },
  { key: 'transactions', label: 'Transaksi', icon: <><path d="M6 3h9l3 3v15H6z" /><path d="M9 8h6M9 12h6M9 16h4" /></> },
  { key: 'staff', label: 'Staf & Peran', icon: <><rect x="3" y="4" width="18" height="16" rx="1.5" /><path d="M7 9h10M7 13h10M7 17h6" /></> },
];

export default function Sidebar({ activeTab, onChangeTab, profile, isAdmin }) {
  async function handleLogout() {
    await supabase.auth.signOut();
    window.location.href = '/login';
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-name">SAM Property</div>
        <div className="brand-tag">Dashboard Operasional</div>
      </div>
      <nav>
        {NAV_ITEMS.filter((item) => item.key !== 'staff' || isAdmin).map((item) => (
          <button
            key={item.key}
            className={'nav-item' + (activeTab === item.key ? ' active' : '')}
            onClick={() => onChangeTab(item.key)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              {item.icon}
            </svg>
            {item.label}
          </button>
        ))}
      </nav>
      <div className="sidebar-user">
        {profile?.name || 'Pengguna'}
        <br />
        <span className="role-badge">{isAdmin ? 'Admin' : 'Agen'}</span>
      </div>
      <button className="sidebar-logout" onClick={handleLogout}>Keluar</button>
    </aside>
  );
}
