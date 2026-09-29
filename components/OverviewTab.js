import { useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';
import { formatRupiah, monthKey, monthLabel } from '../lib/format';

export default function OverviewTab({ properties, leads, transactions, profiles }) {
  const trendRef = useRef(null);
  const statusRef = useRef(null);
  const sourceRef = useRef(null);
  const agentRef = useRef(null);
  const chartsRef = useRef({});

  const now = new Date();
  const thisMonthKey = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const trxThisMonth = transactions.filter((t) => monthKey(t.date) === thisMonthKey);
  const activeListing = properties.filter((p) => p.status === 'Tersedia').length;
  const activeLeads = leads.filter((l) => ['Baru', 'Follow-up', 'Nego'].includes(l.status)).length;
  const commissionThisMonth = trxThisMonth.reduce((s, t) => s + (Number(t.commission_amount) || 0), 0);

  useEffect(() => {
    Object.values(chartsRef.current).forEach((c) => c && c.destroy());
    chartsRef.current = {};

    // Trend closing per bulan
    if (transactions.length && trendRef.current) {
      const byMonth = {};
      transactions.forEach((t) => {
        const k = monthKey(t.date);
        if (k) byMonth[k] = (byMonth[k] || 0) + 1;
      });
      const keys = Object.keys(byMonth).sort().slice(-6);
      chartsRef.current.trend = new Chart(trendRef.current, {
        type: 'bar',
        data: { labels: keys.map(monthLabel), datasets: [{ label: 'Closing', data: keys.map((k) => byMonth[k]), backgroundColor: '#7D2233', borderRadius: 4, maxBarThickness: 36 }] },
        options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
      });
    }

    // Status listing
    if (properties.length && statusRef.current) {
      const statuses = ['Tersedia', 'Pending', 'Terjual', 'Tersewa'];
      const counts = statuses.map((s) => properties.filter((p) => p.status === s).length);
      chartsRef.current.status = new Chart(statusRef.current, {
        type: 'doughnut',
        data: { labels: statuses, datasets: [{ data: counts, backgroundColor: ['#7D2233', '#B8873A', '#A69B9D', '#D6CBAE'] }] },
        options: { plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } }, cutout: '62%' },
      });
    }

    // Sumber leads
    if (leads.length && sourceRef.current) {
      const sources = ['WhatsApp', 'Instagram', 'Facebook', 'Website', 'Referral', 'Walk-in'];
      const counts = sources.map((s) => leads.filter((l) => l.source === s).length);
      chartsRef.current.source = new Chart(sourceRef.current, {
        type: 'bar',
        data: { labels: sources, datasets: [{ data: counts, backgroundColor: '#B8873A', borderRadius: 4, maxBarThickness: 28 }] },
        options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } },
      });
    }

    // Top agent
    if (profiles.length && transactions.length && agentRef.current) {
      const data = profiles
        .map((a) => ({
          name: a.name,
          total: transactions.filter((t) => t.agent_id === a.id).reduce((s, t) => s + (Number(t.commission_amount) || 0), 0),
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 6);
      chartsRef.current.agent = new Chart(agentRef.current, {
        type: 'bar',
        data: { labels: data.map((d) => d.name), datasets: [{ data: data.map((d) => d.total), backgroundColor: '#7D2233', borderRadius: 4, maxBarThickness: 28 }] },
        options: {
          indexAxis: 'y',
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => formatRupiah(c.raw) } } },
          scales: { x: { beginAtZero: true, ticks: { callback: (v) => (v >= 1000000 ? v / 1000000 + 'jt' : v) } } },
        },
      });
    }

    return () => Object.values(chartsRef.current).forEach((c) => c && c.destroy());
  }, [properties, leads, transactions, profiles]);

  return (
    <section>
      <div className="topbar">
        <div>
          <h1>Ringkasan</h1>
          <p>Kondisi bisnis SAM Property secara keseluruhan</p>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card"><div className="kpi-label">Total Listing</div><div className="kpi-value">{properties.length}</div></div>
        <div className="kpi-card"><div className="kpi-label">Listing Tersedia</div><div className="kpi-value accent">{activeListing}</div></div>
        <div className="kpi-card"><div className="kpi-label">Leads Aktif</div><div className="kpi-value accent">{activeLeads}</div></div>
        <div className="kpi-card"><div className="kpi-label">Closing Bulan Ini</div><div className="kpi-value">{trxThisMonth.length}</div></div>
        <div className="kpi-card"><div className="kpi-label">Komisi Bulan Ini</div><div className="kpi-value gold">{formatRupiah(commissionThisMonth)}</div></div>
      </div>

      <div className="chart-grid">
        <div className="panel">
          <h3>Tren Closing per Bulan</h3>
          {transactions.length ? <canvas ref={trendRef} height="150" /> : <div className="panel-empty">Belum ada transaksi untuk ditampilkan</div>}
        </div>
        <div className="panel">
          <h3>Status Listing</h3>
          {properties.length ? <canvas ref={statusRef} height="150" /> : <div className="panel-empty">Belum ada listing untuk ditampilkan</div>}
        </div>
      </div>

      <div className="chart-grid">
        <div className="panel">
          <h3>Sumber Leads</h3>
          {leads.length ? <canvas ref={sourceRef} height="130" /> : <div className="panel-empty">Belum ada leads untuk ditampilkan</div>}
        </div>
        <div className="panel">
          <h3>Top Agen (Komisi)</h3>
          {profiles.length && transactions.length ? <canvas ref={agentRef} height="130" /> : <div className="panel-empty">Belum ada data komisi untuk ditampilkan</div>}
        </div>
      </div>
    </section>
  );
}
