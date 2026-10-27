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

  // User Current Geolocation State
  const [currentGps, setCurrentGps] = useState({ lat: 10.1336, lng: 124.8415 });

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
    locationName: 'Lib-og',
    lat: null,
    lng: null,
    imageUrl: '',
  });

  const socketRef = useRef(null);

  const showToast = (message, type = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Detect Live Device Geolocation
  useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          setCurrentGps({ lat, lng });
        },
        (err) => {
          console.warn('Geolocation access denied:', err.message);
        }
      );
    }
  }, []);

  // GPS Button Handler
  const handleGetGpsLocation = () => {
    if ('geolocation' in navigator) {
      showToast('Fetching GPS coordinates...', 'info');
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          setCurrentGps({ lat, lng });
          setNewReport((prev) => ({
            ...prev,
            lat,
            lng,
            locationName: prev.locationName || `GPS Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
          }));
          showToast('📍 GPS Location Captured!', 'success');
        },
        () => {
          showToast('Could not fetch GPS location. Check browser permissions.', 'warning');
        }
      );
    } else {
      showToast('Geolocation is not supported by your browser.', 'error');
    }
  };

  // File Upload Handlers
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

  // --- READ (R) ---
  const fetchReports = useCallback(async () => {
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await axios.get(`${API_BASE_URL}/reports`, { headers });
      setReports(Array.isArray(res.data) ? res.data : res.data.reports || []);
    } catch (err) {
      console.error('Error fetching reports:', err);
      setReports([]);
    }
  }, [token]);

  // Offline Sync
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

  // Socket Listener Setup for Live Realtime CRUD Updates
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

    socketRef.current.on('report_deleted', (deletedId) => {
      setReports((prev) =>
        Array.isArray(prev) ? prev.filter((r) => r._id !== deletedId) : []
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
      showToast(err.response?.data?.message || 'Authentication failed.', 'error');
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

  // --- CREATE (C) ---
  const handleCreateReport = async (e) => {
    e.preventDefault();

    // Guard: Collectors cannot submit waste reports
    if (user?.role === 'Collector') {
      showToast('Garbage Collectors are not permitted to submit waste reports.', 'warning');
      return;
    }

    if (!newReport.description) {
      showToast('Please provide a waste description.', 'warning');
      return;
    }

    const reportPayload = {
      ...newReport,
      lat: newReport.lat || currentGps.lat,
      lng: newReport.lng || currentGps.lng,
      barangay: user?.barangay || 'Barangay Central',
      userName: user?.name || 'Anonymous Resident',
    };

    if (!isOnline) {
      await saveReportOffline(reportPayload);
      showToast('Saved offline. Will automatically sync when reconnected!', 'info');
      setNewReport({ description: '', wasteType: 'Malata', locationName: 'Lib-og', lat: null, lng: null, imageUrl: '' });
      return;
    }

    try {
      await axios.post(`${API_BASE_URL}/reports`, reportPayload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      showToast('Waste report submitted successfully!', 'success');
      setNewReport({ description: '', wasteType: 'Malata', locationName: 'Lib-og', lat: null, lng: null, imageUrl: '' });
      setActiveTab('reports');
      fetchReports();
    } catch (err) {
      showToast('Failed to submit report.', 'error');
    }
  };

  // --- UPDATE (U) ---
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

  // --- DELETE (D) ---
  const handleDeleteReport = async (reportId) => {
    if (!window.confirm('Are you sure you want to delete this waste report?')) return;

    try {
      await axios.delete(`${API_BASE_URL}/reports/${reportId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      showToast('Report deleted successfully.', 'info');
      fetchReports();
    } catch (err) {
      showToast('Failed to delete report.', 'error');
    }
  };

  // AI Classifier Handler
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
      showToast('AI analysis failed.', 'error');
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
              <p className="text-emerald-100 max-w-xl mx-auto text-sm">Report uncollected waste, manage collection routes, and classify items into Malata or Dili Malata using AI.</p>
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

  // Authenticated Portal Dashboard
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

      {/* Navigation Tabs Bar */}
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

          {/* TAB VISIBILITY: Only Residents and Admins see "Report Uncollected Waste" */}
          {(user.role === 'Resident' || user.role === 'Admin') && (
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
          )}

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

        {/* TAB 1: REPORTS FEED (READ, UPDATE, DELETE) */}
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
                        <p className="text-xs text-gray-500 mt-1">📍 Location / Barangay: <span className="font-semibold text-gray-700">{report.locationName || 'Unspecified Zone'}</span></p>
                      </div>

                      <span className={`text-xs font-bold px-3 py-1 rounded-xl ${
                        report.status === 'Collected' ? 'bg-emerald-100 text-emerald-800' :
                        report.status === 'In Progress' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'
                      }`}>
                        {report.status || 'Pending'}
                      </span>
                    </div>

                    {report.imageUrl && (
                      <img src={report.imageUrl} alt="Report Waste" className="w-full h-48 object-cover rounded-xl border" />
                    )}

                    <div className="pt-2 border-t flex items-center justify-between gap-2">
                      <span className="text-xs text-gray-400 font-medium">
                        Reported by: {report.userName || 'Resident'}
                      </span>

                      <div className="flex gap-2">
                        {(user.role === 'Admin' || user.role === 'Collector') && (
                          <>
                            <button
                              onClick={() => handleStatusUpdate(report._id, 'In Progress')}
                              className="bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold text-xs px-3 py-2 rounded-xl transition"
                            >
                              In Progress
                            </button>
                            <button
                              onClick={() => handleStatusUpdate(report._id, 'Collected')}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-3 py-2 rounded-xl transition"
                            >
                              Collected
                            </button>
                          </>
                        )}

                        {(user.role === 'Admin' || user.name === report.userName) && (
                          <button
                            onClick={() => handleDeleteReport(report._id)}
                            className="bg-red-50 hover:bg-red-100 text-red-600 font-bold text-xs px-3 py-2 rounded-xl transition"
                          >
                            🗑️ Delete
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: CREATE WASTE REPORT (Only rendered for Residents and Admins) */}
        {activeTab === 'new-report' && (user.role === 'Resident' || user.role === 'Admin') && (
          <div className="max-w-2xl mx-auto bg-white p-8 rounded-3xl border shadow-sm space-y-6">
            <div>
              <h3 className="text-xl font-black text-gray-800">Submit Waste Report</h3>
              <p className="text-xs text-gray-500">Provide the details and barangay location of the uncollected waste</p>
            </div>

            <form onSubmit={handleCreateReport} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Waste Description</label>
                <textarea
                  required
                  rows={3}
                  placeholder="Describe the uncollected waste (e.g., 2 bags of plastic bottles near the store)"
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
                  <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Location / Barangay Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Abgao, Lib-og, Combado, Tunga-tunga"
                    className="w-full border rounded-xl p-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                    value={newReport.locationName}
                    onChange={(e) => setNewReport({ ...newReport, locationName: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <button
                  type="button"
                  onClick={handleGetGpsLocation}
                  className="w-full bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold text-xs py-2.5 rounded-xl transition flex items-center justify-center space-x-1.5"
                >
                  <span>📡 Attach Current Device GPS Location</span>
                </button>
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

        {/* TAB 3: GEMINI AI CLASSIFIER */}
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