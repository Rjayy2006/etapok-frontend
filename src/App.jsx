import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import {
  saveReportOffline,
  getOfflineReports,
  deleteOfflineReport,
} from './utils/offlineStore';

const API_BASE_URL = 'https://etapok-backend.onrender.com/api/e-tapok';
const SOCKET_URL = 'https://etapok-backend.onrender.com';

export default function App() {
  const isOnline = useOnlineStatus();
  const [isSyncing, setIsSyncing] = useState(false);
  const [publicView, setPublicView] = useState('public');

  const [token, setToken] = useState(localStorage.getItem('etapok_token') || '');
  const [user, setUser] = useState(
    JSON.parse(localStorage.getItem('etapok_user') || 'null')
  );

  const [authFormData, setAuthFormData] = useState({
    name: '',
    email: '',
    password: '',
    role: 'Resident',
    barangay: 'Barangay Central',
  });

  // Always initialize as an empty array
  const [reports, setReports] = useState([]);
  const [toast, setToast] = useState(null);
  const [demoImage, setDemoImage] = useState('');
  const [demoDesc, setDemoDesc] = useState('');
  const [demoResult, setDemoResult] = useState(null);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);

  const [newReport, setNewReport] = useState({
    description: '',
    wasteType: 'Malata',
    locationName: 'Main Street Corner, Zone 2',
    imageUrl: '',
  });

  const socketRef = useRef(null);

  const showToast = (message, type = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Safe data fetching wrapper ensuring array integrity
  const fetchReports = useCallback(async () => {
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await axios.get(`${API_BASE_URL}/reports`, { headers });
      
      if (Array.isArray(res.data)) {
        setReports(res.data);
      } else if (res.data && Array.isArray(res.data.reports)) {
        setReports(res.data.reports);
      } else {
        setReports([]);
      }
    } catch (err) {
      console.error('Error fetching reports:', err);
      setReports([]);
    }
  }, [token]);

  useEffect(() => {
    fetchReports();

    socketRef.current = io(SOCKET_URL, { transports: ['websocket', 'polling'] });

    socketRef.current.on('report_created', (data) => {
      setReports((prev) => (Array.isArray(prev) ? [data, ...prev] : [data]));
    });

    socketRef.current.on('report_updated', (updated) => {
      setReports((prev) =>
        Array.isArray(prev) ? prev.map((r) => (r._id === updated._id ? updated : r)) : []
      );
    });

    return () => {
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, [fetchReports]);

  const handlePublicAiTest = async (e) => {
    e.preventDefault();
    if (!demoImage && !demoDesc) return;
    setAiAnalyzing(true);
    try {
      const res = await axios.post(`${API_BASE_URL}/ai/classify`, {
        description: demoDesc,
        imageUrl: demoImage,
      });
      setDemoResult(res.data);
    } catch (err) {
      showToast('AI Demo failed.', 'error');
    } finally {
      setAiAnalyzing(false);
    }
  };

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    const endpoint = publicView === 'login' ? '/auth/login' : '/auth/register';
    try {
      const res = await axios.post(`${API_BASE_URL}${endpoint}`, authFormData);
      const { token: userToken, user: userData } = res.data;
      localStorage.setItem('etapok_token', userToken);
      localStorage.setItem('etapok_user', JSON.stringify(userData));
      setToken(userToken);
      setUser(userData);
    } catch (err) {
      showToast(err.response?.data?.message || 'Authentication failed', 'error');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('etapok_token');
    localStorage.removeItem('etapok_user');
    setToken('');
    setUser(null);
    setPublicView('public');
  };

  // Safe calculation guarantees no crash even if state fluctuates
  const safeReports = Array.isArray(reports) ? reports : [];
  const totalReports = safeReports.length;
  const malataCount = safeReports.filter((r) => r && r.wasteType === 'Malata').length;
  const diliMalataCount = safeReports.filter((r) => r && r.wasteType === 'Dili Malata').length;
  const collectedCount = safeReports.filter((r) => r && r.status === 'Collected').length;
  const collectionRate = totalReports ? Math.round((collectedCount / totalReports) * 100) : 0;

  if (!token || !user) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
        <header className="bg-emerald-800 text-white shadow-lg sticky top-0 z-40">
          <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
            <div className="flex items-center space-x-3 cursor-pointer" onClick={() => setPublicView('public')}>
              <span className="text-3xl">🌱</span>
              <div>
                <h1 className="font-black text-2xl tracking-wide">E-TAPOK</h1>
                <p className="text-xs text-emerald-200">Public Municipal Waste Portal</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <button onClick={() => setPublicView('login')} className="bg-emerald-700 hover:bg-emerald-600 px-4 py-2 rounded-xl text-xs font-bold">Sign In</button>
              <button onClick={() => setPublicView('register')} className="bg-emerald-500 hover:bg-emerald-400 text-emerald-950 px-4 py-2 rounded-xl text-xs font-black shadow">Report Waste</button>
            </div>
          </div>
        </header>

        {publicView === 'login' || publicView === 'register' ? (
          <div className="flex-grow flex items-center justify-center p-6 bg-emerald-950">
            <div className="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full relative">
              <button onClick={() => setPublicView('public')} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-xs font-bold bg-gray-100 px-2.5 py-1 rounded-full">✕ Back</button>
              <h2 className="text-2xl font-black text-emerald-800 text-center mb-6">{publicView === 'login' ? 'Sign In' : 'Register'}</h2>
              <form onSubmit={handleAuthSubmit} className="space-y-4">
                {publicView === 'register' && (
                  <input type="text" placeholder="Full Name" required className="w-full border p-3 rounded-xl text-sm" value={authFormData.name} onChange={(e) => setAuthFormData({ ...authFormData, name: e.target.value })} />
                )}
                <input type="email" placeholder="Email Address" required className="w-full border p-3 rounded-xl text-sm" value={authFormData.email} onChange={(e) => setAuthFormData({ ...authFormData, email: e.target.value })} />
                <input type="password" placeholder="Password" required className="w-full border p-3 rounded-xl text-sm" value={authFormData.password} onChange={(e) => setAuthFormData({ ...authFormData, password: e.target.value })} />
                <button type="submit" className="w-full bg-emerald-600 text-white font-bold py-3 rounded-xl shadow">{publicView === 'login' ? 'Sign In' : 'Register'}</button>
              </form>
            </div>
          </div>
        ) : (
          <main className="flex-grow">
            <section className="bg-emerald-800 text-white py-16 px-6 text-center">
              <h2 className="text-4xl font-black mb-3">Smarter Segregation, Cleaner Barangays</h2>
              <p className="text-emerald-100 max-w-xl mx-auto text-sm">Report uncollected waste and classify items into Malata or Dili Malata using AI.</p>
            </section>
            <section className="max-w-7xl mx-auto px-6 -mt-8">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white p-6 rounded-2xl shadow text-center"><p className="text-xs font-bold text-gray-400">Total Reports</p><p className="text-3xl font-black text-gray-800">{totalReports}</p></div>
                <div className="bg-white p-6 rounded-2xl shadow text-center"><p className="text-xs font-bold text-gray-400">Collection Rate</p><p className="text-3xl font-black text-emerald-600">{collectionRate}%</p></div>
                <div className="bg-white p-6 rounded-2xl shadow text-center"><p className="text-xs font-bold text-gray-400">Malata</p><p className="text-3xl font-black text-emerald-800">{malataCount}</p></div>
                <div className="bg-white p-6 rounded-2xl shadow text-center"><p className="text-xs font-bold text-gray-400">Dili Malata</p><p className="text-3xl font-black text-amber-600">{diliMalataCount}</p></div>
              </div>
            </section>
            <section className="max-w-5xl mx-auto px-6 py-12">
              <h3 className="text-xl font-extrabold text-gray-800 mb-6">Live Barangay Collection Activity</h3>
              <div className="space-y-3">
                {safeReports.slice(0, 5).map((report) => (
                  <div key={report._id || Math.random()} className="bg-white p-4 rounded-2xl border flex justify-between items-center">
                    <div>
                      <span className={`text-xs font-extrabold px-2.5 py-0.5 rounded-full ${report.wasteType === 'Malata' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{report.wasteType || 'General'}</span>
                      <p className="font-bold text-sm text-gray-800 mt-1">{report.description || 'No description'}</p>
                      <p className="text-xs text-gray-400">📍 {report.locationName || 'Unspecified Location'}</p>
                    </div>
                    <span className="text-xs font-bold px-3 py-1 rounded-lg bg-orange-100 text-orange-700">{report.status || 'Pending'}</span>
                  </div>
                ))}
              </div>
            </section>
          </main>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      <header className="bg-emerald-800 text-white p-4 flex justify-between items-center">
        <h1 className="font-bold text-lg">E-TAPOK Portal</h1>
        <button onClick={handleLogout} className="bg-emerald-900 px-3 py-1 rounded text-xs font-bold">Sign Out</button>
      </header>
      <main className="p-6 max-w-4xl mx-auto">
        <h2 className="text-xl font-bold mb-4">Welcome, {user.name} ({user.role})</h2>
        <div className="bg-white p-6 rounded-2xl shadow space-y-2">
          <p className="text-sm font-semibold">Active Barangay Reports: {safeReports.length}</p>
        </div>
      </main>
    </div>
  );
}