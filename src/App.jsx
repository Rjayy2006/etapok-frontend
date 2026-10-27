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

  // Auth State
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

  // Data & App Navigation State
  const [reports, setReports] = useState([]);
  const [activeTab, setActiveTab] = useState('reports');
  const [filterWasteType, setFilterWasteType] = useState('All');
  const [toast, setToast] = useState(null);

  // AI Classification State
  const [aiImage, setAiImage] = useState('');
  const [aiDesc, setAiDesc] = useState('');
  const [aiResult, setAiResult] = useState(null);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);

  // Waste Submission Form State
  const [newReport, setNewReport] = useState({
    description: '',
    wasteType: 'Malata',
    locationName: 'Main Street Corner, Zone 2',
    imageUrl: '',
  });

  const socketRef = useRef(null);
  const mapContainerRef = useRef(null);
  const leafletMapRef = useRef(null);

  const showToast = (message, type = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Load Leaflet Map CSS Dynamically
  useEffect(() => {
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
  }, []);

  // File Readers for Base64 Uploads
  const handleReportFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setNewReport((prev) => ({ ...prev, imageUrl: reader.result }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAiFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setAiImage(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  // Fetch Reports from Backend
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

  // Offline Auto-Sync Logic
  const syncOfflineReports = useCallback(async () => {
    if (!isOnline || !token) return;
    try {
      const offlineData = await getOfflineReports();
      if (!offlineData || offlineData.length === 0) return;
      
      setIsSyncing(true);
      for (const item of offlineData) {
        try {
          await axios.post(`${API_BASE_URL}/reports`, item, {
            headers: { Authorization: `Bearer ${token}` },
          });
          await deleteOfflineReport(item.id);
        } catch (e) {
          console.error('Failed to sync offline item', item, e);
        }
      }
      showToast('Offline reports synchronized successfully!', 'success');
      fetchReports();
    } catch (err) {
      console.error('Error during sync:', err);
    } finally {
      setIsSyncing(false);
    }
  }, [isOnline, token, fetchReports]);

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

  useEffect(() => {
    if (isOnline) {
      syncOfflineReports();
    }
  }, [isOnline, syncOfflineReports]);

  // Leaflet Interactive Map Initialization
  useEffect(() => {
    if (activeTab === 'map' && mapContainerRef.current) {
      if (!leafletMapRef.current && window.L) {
        const map = window.L.map(mapContainerRef.current).setView([10.3157, 123.8854], 13);
        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap contributors',
        }).addTo(map);

        leafletMapRef.current = map;
      }

      // Add report markers
      if (leafletMapRef.current && window.L) {
        const safeArr = Array.isArray(reports) ? reports : [];
        safeArr.forEach((r, idx) => {
          if (r) {
            const lat = 10.3157 + (idx * 0.005 - 0.01);
            const lng = 123.8854 + (idx * 0.005 - 0.01);
            window.L.marker([lat, lng])
              .addTo(leafletMapRef.current)
              .bindPopup(`<b>${r.wasteType || 'Waste'}</b><br>${r.description || ''}<br>📍 ${r.locationName || ''}`);
          }
        });
      }
    }
  }, [activeTab, reports]);

  // Auth Handlers
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
      showToast(`Welcome back, ${userData.name}!`, 'success');
    } catch (err) {
      const errMsg = err.response?.data?.message || 'Authentication failed.';
      showToast(errMsg, 'error');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('etapok_token');
    localStorage.removeItem('etapok_user');
    setToken('');
    setUser(null);
    setPublicView('public');
    showToast('Signed out successfully.', 'info');
  };

  // Report Creation & Status Management
  const handleCreateReport = async (e) => {
    e.preventDefault();
    if (!newReport.description) {
      showToast('Please provide a waste description.', 'warning');
      return;
    }

    const reportPayload = {
      ...newReport,
      barangay: user?.barangay || 'Barangay Central',
      userName: user?.name || 'Anonymous Resident',
    };

    if (!isOnline) {
      await saveReportOffline(reportPayload);
      showToast('Saved offline. Will automatically sync when reconnected!', 'info');
      setNewReport({ description: '', wasteType: 'Malata', locationName: 'Main Street Corner, Zone 2', imageUrl: '' });
      return;
    }

    try {
      await axios.post(`${API_BASE_URL}/reports`, reportPayload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      showToast('Waste report submitted successfully!', 'success');
      setNewReport({ description: '', wasteType: 'Malata', locationName: 'Main Street Corner, Zone 2', imageUrl: '' });
      setActiveTab('reports');
      fetchReports();
    } catch (err) {
      showToast('Failed to submit report.', 'error');
    }
  };

  const handleStatusUpdate = async (reportId, newStatus) => {
    try {
      await axios.put(
        `${API_BASE_URL}/reports/${reportId}/status`,
        { status: newStatus },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      showToast(`Report updated to "${newStatus}"`, 'success');
      fetchReports();
    } catch (err) {
      showToast('Failed to update status.', 'error');
    }
  };

  // AI Classification Handler
  const handleAiClassify = async (e) => {
    e.preventDefault();
    if (!aiDesc && !aiImage) {
      showToast('Please enter a description or upload an image file.', 'warning');
      return;
    }

    setAiAnalyzing(true);
    setAiResult(null);
    try {
      const res = await axios.post(`${API_BASE_URL}/ai/classify`, {
        description: aiDesc,
        imageUrl: aiImage,
      });
      setAiResult(res.data);
      if (res.data?.category) {
        setNewReport((prev) => ({ ...prev, wasteType: res.data.category }));
      }
      showToast('AI classification completed!', 'success');
    } catch (err) {
      showToast('AI analysis failed. Please try again.', 'error');
    } finally {
      setAiAnalyzing(false);
    }
  };

  // Metrics
  const safeReports = Array.isArray(reports) ? reports : [];
  const totalReports = safeReports.length;
  const malataCount = safeReports.filter((r) => r && r.wasteType === 'Malata').length;
  const diliMalataCount = safeReports.filter((r) => r && r.wasteType === 'Dili Malata').length;
  const collectedCount = safeReports.filter((r) => r && r.status === 'Collected').length;
  const collectionRate = totalReports ? Math.round((collectedCount / totalReports) * 100) : 0;

  const filteredReports = safeReports.filter((r) => {
    if (filterWasteType === 'All') return true;
    return r && r.wasteType === filterWasteType;
  });

  // Public View
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
              <button onClick={() => setPublicView('login')} className="bg-emerald-700 hover:bg-emerald-600 px-4 py-2 rounded-xl text-xs font-bold transition">Sign In</button>
              <button onClick={() => setPublicView('register')} className="bg-emerald-500 hover:bg-emerald-400 text-emerald-950 px-4 py-2 rounded-xl text-xs font-black shadow transition">Report Waste</button>
            </div>
          </div>
        </header>

        {publicView === 'login' || publicView === 'register' ? (
          <div className="flex-grow flex items-center justify-center p-6 bg-emerald-950">
            <div className="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full relative">
              <button onClick={() => setPublicView('public')} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-xs font-bold bg-gray-100 px-2.5 py-1 rounded-full">✕ Back</button>
              <h2 className="text-2xl font-black text-emerald-800 text-center mb-1">{publicView === 'login' ? 'Sign In' : 'Register'}</h2>
              <p className="text-xs text-gray-500 text-center mb-6">Access your local barangay portal</p>
              
              <form onSubmit={handleAuthSubmit} className="space-y-4">
                {publicView === 'register' && (
                  <div>
                    <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Full Name</label>
                    <input type="text" required className="w-full border rounded-xl p-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" value={authFormData.name} onChange={(e) => setAuthFormData({ ...authFormData, name: e.target.value })} />
                  </div>
                )}
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Email</label>
                  <input type="email" required className="w-full border rounded-xl p-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" value={authFormData.email} onChange={(e) => setAuthFormData({ ...authFormData, email: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Password</label>
                  <input type="password" required className="w-full border rounded-xl p-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" value={authFormData.password} onChange={(e) => setAuthFormData({ ...authFormData, password: e.target.value })} />
                </div>
                {publicView === 'register' && (
                  <>
                    <div>
                      <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Role</label>
                      <select className="w-full border rounded-xl p-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" value={authFormData.role} onChange={(e) => setAuthFormData({ ...authFormData, role: e.target.value })}>
                        <option value="Resident">Resident (Report Waste)</option>
                        <option value="Collector">Garbage Collector (Manage Routes)</option>
                        <option value="Admin">LGU Official (Executive Dashboard)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Barangay Zone</label>
                      <input type="text" required className="w-full border rounded-xl p-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" value={authFormData.barangay} onChange={(e) => setAuthFormData({ ...authFormData, barangay: e.target.value })} />
                    </div>
                  </>
                )}
                <button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl shadow transition">{publicView === 'login' ? 'Sign In' : 'Register'}</button>
              </form>
            </div>
          </div>
        ) : (
          <main className="flex-grow">
            <section className="bg-emerald-800 text-white py-16 px-6 text-center">
              <h2 className="text-4xl font-black mb-3">Smarter Segregation, Cleaner Barangays</h2>
              <p className="text-emerald-100 max-w-xl mx-auto text-sm">Report uncollected waste, track garbage routes, and classify items into Malata or Dili Malata using AI.</p>
            </section>
            <section className="max-w-7xl mx-auto px-6 -mt-8">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white p-6 rounded-2xl shadow text-center"><p className="text-xs font-bold text-gray-400">Total Reports</p><p className="text-3xl font-black text-gray-800">{totalReports}</p></div>
                <div className="bg-white p-6 rounded-2xl shadow text-center"><p className="text-xs font-bold text-gray-400">Collection Rate</p><p className="text-3xl font-black text-emerald-600">{collectionRate}%</p></div>
                <div className="bg-white p-6 rounded-2xl shadow text-center"><p className="text-xs font-bold text-gray-400">Malata</p><p className="text-3xl font-black text-emerald-800">{malataCount}</p></div>
                <div className="bg-white p-6 rounded-2xl shadow text-center"><p className="text-xs font-bold text-gray-400">Dili Malata</p><p className="text-3xl font-black text-amber-600">{diliMalataCount}</p></div>
              </div>
            </section>
          </main>
        )}
      </div>
    );
  }

  // Authenticated Portal
  return (
    <div className="min-h-screen bg-gray-100 flex flex-col font-sans">
      {toast && (
        <div className={`fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl shadow-lg text-white font-bold text-sm ${
          toast.type === 'error' ? 'bg-red-600' : toast.type === 'success' ? 'bg-emerald-600' : 'bg-blue-600'
        }`}>
          {toast.message}
        </div>
      )}

      {!isOnline && (
        <div className="bg-amber-600 text-white text-center py-2 px-4 font-bold text-xs sticky top-0 z-50">
          ⚠️ Offline Mode Active — Reports will be stored locally until connection is restored.
        </div>
      )}

      <header className="bg-emerald-800 text-white shadow-md">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center space-x-3">
            <span className="text-3xl">🌱</span>
            <div>
              <h1 className="font-black text-xl tracking-wide">E-TAPOK PORTAL</h1>
              <p className="text-xs text-emerald-200">
                {user.role} Dashboard • {user.barangay}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            {isSyncing && (
              <span className="text-xs bg-emerald-700 px-3 py-1 rounded-full animate-pulse">
                🔄 Syncing Local Data...
              </span>
            )}
            <div className="text-right hidden sm:block">
              <p className="text-sm font-bold">{user.name}</p>
              <p className="text-xs text-emerald-200">{user.email}</p>
            </div>
            <button
              onClick={handleLogout}
              className="bg-emerald-950 hover:bg-emerald-900 px-4 py-2 rounded-xl text-xs font-bold border border-emerald-700 transition"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Navigation Tabs (Including Restored Live Map) */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 flex space-x-6 text-sm font-bold">
          <button
            onClick={() => setActiveTab('reports')}
            className={`py-4 border-b-2 transition ${
              activeTab === 'reports'
                ? 'border-emerald-600 text-emerald-800'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            📋 Barangay Feed ({safeReports.length})
          </button>

          <button
            onClick={() => setActiveTab('map')}
            className={`py-4 border-b-2 transition ${
              activeTab === 'map'
                ? 'border-emerald-600 text-emerald-800'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            🗺️ Live Barangay Map
          </button>

          <button
            onClick={() => setActiveTab('new-report')}
            className={`py-4 border-b-2 transition ${
              activeTab === 'new-report'
                ? 'border-emerald-600 text-emerald-800'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            ➕ Report Uncollected Waste
          </button>

          <button
            onClick={() => setActiveTab('ai')}
            className={`py-4 border-b-2 transition ${
              activeTab === 'ai'
                ? 'border-emerald-600 text-emerald-800'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            🤖 Gemini AI Classifier
          </button>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-6 py-8 flex-grow w-full space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-2xl border shadow-sm text-center">
            <span className="text-xs font-bold text-gray-400 uppercase">Total Reports</span>
            <p className="text-2xl font-black text-gray-800 mt-1">{totalReports}</p>
          </div>
          <div className="bg-white p-5 rounded-2xl border shadow-sm text-center">
            <span className="text-xs font-bold text-gray-400 uppercase">Collection Efficiency</span>
            <p className="text-2xl font-black text-emerald-600 mt-1">{collectionRate}%</p>
          </div>
          <div className="bg-white p-5 rounded-2xl border shadow-sm text-center">
            <span className="text-xs font-bold text-gray-400 uppercase">Malata (Bio)</span>
            <p className="text-2xl font-black text-emerald-800 mt-1">{malataCount}</p>
          </div>
          <div className="bg-white p-5 rounded-2xl border shadow-sm text-center">
            <span className="text-xs font-bold text-gray-400 uppercase">Dili Malata (Non-Bio)</span>
            <p className="text-2xl font-black text-amber-600 mt-1">{diliMalataCount}</p>
          </div>
        </div>

        {/* TAB 1: REPORTS FEED */}
        {activeTab === 'reports' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-black text-gray-800">Barangay Waste Feed</h3>
              <div className="flex items-center space-x-2 text-xs font-bold text-gray-600">
                <span>Filter:</span>
                <select
                  className="border rounded-xl px-3 py-1.5 outline-none bg-white"
                  value={filterWasteType}
                  onChange={(e) => setFilterWasteType(e.target.value)}
                >
                  <option value="All">All Categories</option>
                  <option value="Malata">Malata (Biodegradable)</option>
                  <option value="Dili Malata">Dili Malata (Non-Bio)</option>
                </select>
              </div>
            </div>

            {filteredReports.length === 0 ? (
              <div className="bg-white p-12 rounded-2xl text-center border text-gray-400">
                <p className="text-sm font-bold">No waste reports recorded yet.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredReports.map((report) => (
                  <div key={report._id || Math.random()} className="bg-white p-6 rounded-2xl border shadow-sm space-y-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <span className={`text-xs font-black px-3 py-1 rounded-full ${
                          report.wasteType === 'Malata' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                        }`}>
                          {report.wasteType || 'General Waste'}
                        </span>
                        <h4 className="font-extrabold text-base text-gray-900 mt-2">{report.description}</h4>
                        <p className="text-xs text-gray-500">📍 {report.locationName || 'Unspecified Zone'}</p>
                      </div>

                      <span className={`text-xs font-bold px-3 py-1 rounded-xl ${
                        report.status === 'Collected' ? 'bg-blue-100 text-blue-800' :
                        report.status === 'In Progress' ? 'bg-amber-100 text-amber-800' : 'bg-orange-100 text-orange-800'
                      }`}>
                        {report.status || 'Pending'}
                      </span>
                    </div>

                    {report.imageUrl && (
                      <img src={report.imageUrl} alt="Report Waste" className="w-full h-48 object-cover rounded-xl border" />
                    )}

                    {(user.role === 'Admin' || user.role === 'Collector') && (
                      <div className="pt-2 border-t flex gap-2">
                        <button
                          onClick={() => handleStatusUpdate(report._id, 'In Progress')}
                          className="flex-1 bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold text-xs py-2 rounded-xl transition"
                        >
                          Mark In Progress
                        </button>
                        <button
                          onClick={() => handleStatusUpdate(report._id, 'Collected')}
                          className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs py-2 rounded-xl transition"
                        >
                          Mark Collected
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: LIVE MAP VIEW */}
        {activeTab === 'map' && (
          <div className="bg-white p-6 rounded-3xl border shadow-sm space-y-4">
            <div>
              <h3 className="text-xl font-black text-gray-800">Live Barangay Waste Map</h3>
              <p className="text-xs text-gray-500">Real-time OpenStreetMap locations for pending and collected waste reports</p>
            </div>
            <div ref={mapContainerRef} className="w-full h-96 rounded-2xl border shadow-inner z-10"></div>
          </div>
        )}

        {/* TAB 3: CREATE WASTE REPORT */}
        {activeTab === 'new-report' && (
          <div className="max-w-2xl mx-auto bg-white p-8 rounded-3xl border shadow-sm space-y-6">
            <div>
              <h3 className="text-xl font-black text-gray-800">Submit Waste Report</h3>
              <p className="text-xs text-gray-500">Notify municipal garbage collection trucks in real-time</p>
            </div>

            <form onSubmit={handleCreateReport} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Waste Description</label>
                <textarea
                  required
                  rows={3}
                  placeholder="Describe the uncollected waste"
                  className="w-full border rounded-xl p-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                  value={newReport.description}
                  onChange={(e) => setNewReport({ ...newReport, description: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Segregation Type</label>
                  <select
                    className="w-full border rounded-xl p-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                    value={newReport.wasteType}
                    onChange={(e) => setNewReport({ ...newReport, wasteType: e.target.value })}
                  >
                    <option value="Malata">Malata (Biodegradable)</option>
                    <option value="Dili Malata">Dili Malata (Non-Bio)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Location / Zone</label>
                  <input
                    type="text"
                    required
                    className="w-full border rounded-xl p-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                    value={newReport.locationName}
                    onChange={(e) => setNewReport({ ...newReport, locationName: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Upload Photo (Optional)</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleReportFileChange}
                  className="w-full border rounded-xl p-2.5 text-sm file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-emerald-100 file:text-emerald-800 hover:file:bg-emerald-200 cursor-pointer"
                />
                {newReport.imageUrl && (
                  <div className="mt-3 inline-block">
                    <img src={newReport.imageUrl} alt="Selected Preview" className="h-28 rounded-xl border object-cover shadow-sm" />
                    <button
                      type="button"
                      onClick={() => setNewReport({ ...newReport, imageUrl: '' })}
                      className="block mt-1 text-xs text-red-600 font-bold hover:underline"
                    >
                      ✕ Remove Photo
                    </button>
                  </div>
                )}
              </div>

              <button
                type="submit"
                className="w-full bg-emerald-700 hover:bg-emerald-800 text-white font-bold py-3.5 rounded-xl shadow transition"
              >
                Submit Waste Pickup Request
              </button>
            </form>
          </div>
        )}

        {/* TAB 4: GEMINI AI CLASSIFIER */}
        {activeTab === 'ai' && (
          <div className="max-w-2xl mx-auto bg-white p-8 rounded-3xl border shadow-sm space-y-6">
            <div className="text-center space-y-1">
              <span className="text-3xl">🤖</span>
              <h3 className="text-xl font-black text-gray-800">Gemini AI Waste Classifier</h3>
              <p className="text-xs text-gray-500">Unsure whether item is Malata or Dili Malata? Upload a file or picture.</p>
            </div>

            <form onSubmit={handleAiClassify} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Item Description</label>
                <input
                  type="text"
                  placeholder="e.g., banana peel, plastic bottle, cardboard box"
                  className="w-full border rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                  value={aiDesc}
                  onChange={(e) => setAiDesc(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Select / Upload Image File</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleAiFileChange}
                  className="w-full border rounded-xl p-2.5 text-sm file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-emerald-100 file:text-emerald-800 hover:file:bg-emerald-200 cursor-pointer"
                />
                {aiImage && (
                  <div className="mt-3 inline-block">
                    <img src={aiImage} alt="AI Preview" className="h-28 rounded-xl border object-cover shadow-sm" />
                    <button
                      type="button"
                      onClick={() => setAiImage('')}
                      className="block mt-1 text-xs text-red-600 font-bold hover:underline"
                    >
                      ✕ Remove Photo
                    </button>
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={aiAnalyzing}
                className="w-full bg-emerald-800 hover:bg-emerald-900 text-white font-bold py-3.5 rounded-xl transition"
              >
                {aiAnalyzing ? 'Analyzing Item with AI...' : 'Classify Item'}
              </button>
            </form>

            {aiResult && (
              <div className="p-5 rounded-2xl bg-emerald-50 border border-emerald-200 text-center space-y-2">
                <span className="text-xs font-bold text-emerald-800 uppercase">AI Recommendation</span>
                <p className="text-3xl font-black text-emerald-900">{aiResult.category}</p>
                {aiResult.explanation && <p className="text-xs text-emerald-700">{aiResult.explanation}</p>}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}