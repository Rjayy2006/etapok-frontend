import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import {
  saveReportOffline,
  getOfflineReports,
  deleteOfflineReport,
} from './utils/offlineStore';

// Live Production API Endpoints
const API_BASE_URL = 'https://etapok-backend.onrender.com/api/e-tapok';
const SOCKET_URL = 'https://etapok-backend.onrender.com';

export default function App() {
  // Offline & Network Hooks
  const isOnline = useOnlineStatus();
  const [isSyncing, setIsSyncing] = useState(false);

  // Unauthenticated Navigation View: 'public' | 'login' | 'register'
  const [publicView, setPublicView] = useState('public');

  // Authentication & User State
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

  // Public & Authenticated Data
  const [reports, setReports] = useState([]);
  const [activeTab, setActiveTab] = useState('reports');
  const [toast, setToast] = useState(null);

  // Gemini AI Try-It-Out State (Public & Resident)
  const [demoImage, setDemoImage] = useState('');
  const [demoDesc, setDemoDesc] = useState('');
  const [demoResult, setDemoResult] = useState(null);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);

  // Waste Submission Form State (Authenticated Resident)
  const [newReport, setNewReport] = useState({
    description: '',
    wasteType: 'Malata',
    locationName: 'Main Street Corner, Zone 2',
    lat: 10.1333,
    lng: 124.85,
    imageUrl: '',
  });

  const socketRef = useRef(null);

  const showToast = (message, type = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // ---------------------------------------------------------------------------
  // DATA FETCHING & WEBSOCKETS
  // ---------------------------------------------------------------------------
  const fetchReports = useCallback(async () => {
    try {
      // Public endpoint or token-based fetch
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await axios.get(`${API_BASE_URL}/reports`, { headers });
      setReports(res.data);
    } catch (err) {
      console.error('Error fetching reports:', err);
    }
  }, [token]);

  useEffect(() => {
    fetchReports();

    socketRef.current = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
    });

    socketRef.current.on('report_created', (data) => {
      setReports((prev) => [data, ...prev]);
    });

    socketRef.current.on('report_updated', (updated) => {
      setReports((prev) =>
        prev.map((r) => (r._id === updated._id ? updated : r))
      );
    });

    return () => {
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, [fetchReports]);

  // ---------------------------------------------------------------------------
  // PUBLIC DEMO AI CLASSIFICATION
  // ---------------------------------------------------------------------------
  const handlePublicAiTest = async (e) => {
    e.preventDefault();
    if (!demoImage && !demoDesc) {
      showToast('Please enter a description or photo URL to test AI.', 'warning');
      return;
    }

    setAiAnalyzing(true);
    setDemoResult(null);
    try {
      const res = await axios.post(`${API_BASE_URL}/ai/classify`, {
        description: demoDesc,
        imageUrl: demoImage,
      });
      setDemoResult(res.data);
      showToast(`AI Classified as: ${res.data.category}`, 'success');
    } catch (err) {
      showToast('Public AI Demo requires active backend server.', 'error');
    } finally {
      setAiAnalyzing(false);
    }
  };

  // ---------------------------------------------------------------------------
  // AUTHENTICATION HANDLERS
  // ---------------------------------------------------------------------------
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

  // Calculate Metrics for Public & Admin Views
  const totalReports = reports.length;
  const malataCount = reports.filter((r) => r.wasteType === 'Malata').length;
  const diliMalataCount = reports.filter((r) => r.wasteType === 'Dili Malata').length;
  const collectedCount = reports.filter((r) => r.status === 'Collected').length;
  const collectionRate = totalReports ? Math.round((collectedCount / totalReports) * 100) : 0;

  // ===========================================================================
  // RENDER VIEW 1: PUBLIC LANDING DASHBOARD (WHEN NOT LOGGED IN)
  // ===========================================================================
  if (!token || !user) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
        {/* Public Navigation Bar */}
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
              <button
                onClick={() => setPublicView('login')}
                className="bg-emerald-700 hover:bg-emerald-600 px-4 py-2 rounded-xl text-xs font-bold transition"
              >
                Sign In
              </button>
              <button
                onClick={() => setPublicView('register')}
                className="bg-emerald-500 hover:bg-emerald-400 text-emerald-950 px-4 py-2 rounded-xl text-xs font-black shadow transition"
              >
                Report Waste
              </button>
            </div>
          </div>
        </header>

        {/* CONDITION 1: AUTHENTICATION FORM MODAL/PAGE */}
        {publicView === 'login' || publicView === 'register' ? (
          <div className="flex-grow flex items-center justify-center p-6 bg-emerald-950">
            <div className="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full relative">
              <button
                onClick={() => setPublicView('public')}
                className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-xs font-bold bg-gray-100 px-2.5 py-1 rounded-full"
              >
                ✕ Back
              </button>

              <div className="text-center mb-6">
                <h2 className="text-2xl font-black text-emerald-800">
                  {publicView === 'login' ? 'Sign In to E-Tapok' : 'Create Resident Account'}
                </h2>
                <p className="text-xs text-gray-500 mt-1">
                  Access your local barangay reporting portal
                </p>
              </div>

              <form onSubmit={handleAuthSubmit} className="space-y-4">
                {publicView === 'register' && (
                  <div>
                    <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Full Name</label>
                    <input
                      type="text"
                      required
                      className="w-full border border-gray-300 rounded-xl p-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                      value={authFormData.name}
                      onChange={(e) => setAuthFormData({ ...authFormData, name: e.target.value })}
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Email Address</label>
                  <input
                    type="email"
                    required
                    className="w-full border border-gray-300 rounded-xl p-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                    value={authFormData.email}
                    onChange={(e) => setAuthFormData({ ...authFormData, email: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Password</label>
                  <input
                    type="password"
                    required
                    className="w-full border border-gray-300 rounded-xl p-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                    value={authFormData.password}
                    onChange={(e) => setAuthFormData({ ...authFormData, password: e.target.value })}
                  />
                </div>

                {publicView === 'register' && (
                  <>
                    <div>
                      <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Role</label>
                      <select
                        className="w-full border border-gray-300 rounded-xl p-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                        value={authFormData.role}
                        onChange={(e) => setAuthFormData({ ...authFormData, role: e.target.value })}
                      >
                        <option value="Resident">Resident (Report Waste)</option>
                        <option value="Collector">Garbage Collector (Manage Routes)</option>
                        <option value="Admin">LGU Official (Executive Dashboard)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Barangay Zone</label>
                      <input
                        type="text"
                        required
                        className="w-full border border-gray-300 rounded-xl p-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                        value={authFormData.barangay}
                        onChange={(e) => setAuthFormData({ ...authFormData, barangay: e.target.value })}
                      />
                    </div>
                  </>
                )}

                <button
                  type="submit"
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl shadow-md transition"
                >
                  {publicView === 'login' ? 'Sign In' : 'Register'}
                </button>
              </form>

              <div className="text-center mt-6">
                <button
                  onClick={() => setPublicView(publicView === 'login' ? 'register' : 'login')}
                  className="text-emerald-700 hover:underline text-xs font-bold"
                >
                  {publicView === 'login'
                    ? "Don't have an account? Register"
                    : 'Already registered? Sign in'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* CONDITION 2: PUBLIC DASHBOARD CONTENT */
          <main className="flex-grow">
            {/* Hero Section */}
            <section className="bg-emerald-800 text-white py-16 px-6 text-center relative overflow-hidden">
              <div className="max-w-4xl mx-auto relative z-10 space-y-4">
                <span className="bg-emerald-700 text-emerald-100 text-xs font-extrabold px-3 py-1 rounded-full uppercase tracking-wider">
                  Official Municipal Sanitation Portal
                </span>
                <h2 className="text-4xl md:text-5xl font-black tracking-tight leading-tight">
                  Smarter Segregation, Cleaner Barangays
                </h2>
                <p className="text-emerald-100 text-base max-w-2xl mx-auto">
                  Report uncollected waste, track garbage collection routes in real-time, and classify items into <b>Malata</b> or <b>Dili Malata</b> using AI.
                </p>
                <div className="flex justify-center gap-4 pt-4">
                  <button
                    onClick={() => setPublicView('register')}
                    className="bg-emerald-400 hover:bg-emerald-300 text-emerald-950 font-black px-6 py-3 rounded-xl shadow-lg transition"
                  >
                    Report Waste Pickup
                  </button>
                  <button
                    onClick={() => setPublicView('login')}
                    className="bg-emerald-900 hover:bg-emerald-950 text-white font-bold px-6 py-3 rounded-xl border border-emerald-700 transition"
                  >
                    LGU Official Portal
                  </button>
                </div>
              </div>
            </section>

            {/* Public Live Statistics Grid */}
            <section className="max-w-7xl mx-auto px-6 -mt-8 relative z-20">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white p-6 rounded-2xl shadow-md border border-gray-100 text-center">
                  <p className="text-xs font-bold text-gray-400 uppercase">Total Reports Filed</p>
                  <p className="text-3xl font-black text-gray-800 mt-1">{totalReports}</p>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-md border border-gray-100 text-center">
                  <p className="text-xs font-bold text-gray-400 uppercase">Collection Rate</p>
                  <p className="text-3xl font-black text-emerald-600 mt-1">{collectionRate}%</p>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-md border border-gray-100 text-center">
                  <p className="text-xs font-bold text-gray-400 uppercase">Malata (Biodegradable)</p>
                  <p className="text-3xl font-black text-emerald-800 mt-1">{malataCount}</p>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-md border border-gray-100 text-center">
                  <p className="text-xs font-bold text-gray-400 uppercase">Dili Malata (Non-Bio)</p>
                  <p className="text-3xl font-black text-amber-600 mt-1">{diliMalataCount}</p>
                </div>
              </div>
            </section>

            {/* Interactive Public AI Classifier Demo */}
            <section className="max-w-4xl mx-auto px-6 py-12">
              <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm space-y-6">
                <div className="text-center space-y-1">
                  <span className="text-2xl">🤖</span>
                  <h3 className="text-xl font-extrabold text-gray-800">
                    Try Gemini AI Waste Segregation
                  </h3>
                  <p className="text-xs text-gray-500">
                    Test our vision AI classifier before creating an account
                  </p>
                </div>

                <form onSubmit={handlePublicAiTest} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <input
                      type="text"
                      placeholder="e.g., leftover fish bones and banana peels"
                      className="border border-gray-300 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                      value={demoDesc}
                      onChange={(e) => setDemoDesc(e.target.value)}
                    />
                    <input
                      type="url"
                      placeholder="Image URL (e.g. https://.../plastic.jpg)"
                      className="border border-gray-300 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                      value={demoImage}
                      onChange={(e) => setDemoImage(e.target.value)}
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={aiAnalyzing}
                    className="w-full bg-emerald-800 hover:bg-emerald-900 text-white font-bold py-3 rounded-xl transition"
                  >
                    {aiAnalyzing ? 'Analyzing Image...' : 'Classify Waste Now'}
                  </button>
                </form>

                {demoResult && (
                  <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-center space-y-1">
                    <span className="text-xs font-bold text-emerald-800 uppercase">AI Classification Result</span>
                    <p className="text-2xl font-black text-emerald-900">{demoResult.category}</p>
                    {demoResult.explanation && (
                      <p className="text-xs text-emerald-700">{demoResult.explanation}</p>
                    )}
                  </div>
                )}
              </div>
            </section>

            {/* Public Community Feed */}
            <section className="max-w-5xl mx-auto px-6 pb-16">
              <h3 className="text-xl font-extrabold text-gray-800 mb-6">
                Live Barangay Collection Activity
              </h3>
              <div className="space-y-3">
                {reports.slice(0, 5).map((report) => (
                  <div
                    key={report._id}
                    className="bg-white p-4 rounded-2xl border border-gray-200 flex justify-between items-center"
                  >
                    <div>
                      <span
                        className={`text-xs font-extrabold px-2.5 py-0.5 rounded-full ${
                          report.wasteType === 'Malata'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {report.wasteType}
                      </span>
                      <p className="font-bold text-sm text-gray-800 mt-1">{report.description}</p>
                      <p className="text-xs text-gray-400">📍 {report.locationName}</p>
                    </div>
                    <span
                      className={`text-xs font-bold px-3 py-1 rounded-lg ${
                        report.status === 'Collected'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-orange-100 text-orange-700'
                      }`}
                    >
                      {report.status}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </main>
        )}

        <footer className="bg-emerald-950 text-emerald-400 py-6 text-center text-xs border-t border-emerald-900">
          <p>© 2026 E-Tapok Municipal Waste Management System. All Rights Reserved.</p>
        </footer>
      </div>
    );
  }

  // ===========================================================================
  // RENDER VIEW 2: AUTHENTICATED USER PORTAL (RESIDENT / COLLECTOR / ADMIN)
  // ===========================================================================
  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Offline Banner */}
      {!isOnline && (
        <div className="bg-amber-600 text-white text-center py-2 px-4 font-semibold text-sm sticky top-0 z-50 shadow-md">
          Offline Mode Active — Reports will save locally until internet restores.
        </div>
      )}

      {/* Header */}
      <header className="bg-emerald-800 text-white shadow-md">
        <div className="max-w-7xl mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center space-x-3">
            <span className="text-2xl">🌱</span>
            <div>
              <h1 className="font-extrabold text-xl tracking-wide">E-TAPOK</h1>
              <p className="text-xs text-emerald-200">Municipal Waste Management</p>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-bold">{user.name}</p>
              <span className="text-xs bg-emerald-700 px-2.5 py-0.5 rounded-full">
                {user.role} • {user.barangay}
              </span>
            </div>
            <button
              onClick={handleLogout}
              className="bg-emerald-900 hover:bg-emerald-950 px-3.5 py-1.5 rounded-lg text-xs font-semibold border border-emerald-700 transition"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Main Authenticated Dashboard */}
      <main className="max-w-7xl mx-auto px-4 py-6 flex-grow w-full">
        <h2 className="text-2xl font-black text-gray-800 mb-4">
          Welcome, {user.name} ({user.role})
        </h2>
        {/* Reports list & authenticated controls... */}
      </main>
    </div>
  );
}