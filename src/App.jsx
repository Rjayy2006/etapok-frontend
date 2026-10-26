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
  const [syncCount, setSyncCount] = useState(0);

  // Authentication & User State
  const [token, setToken] = useState(localStorage.getItem('etapok_token') || '');
  const [user, setUser] = useState(
    JSON.parse(localStorage.getItem('etapok_user') || 'null')
  );
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'register'
  const [authFormData, setAuthFormData] = useState({
    name: '',
    email: '',
    password: '',
    role: 'Resident', // 'Resident' | 'Collector' | 'Admin'
    barangay: 'Barangay Central',
  });

  // Data & Dashboard State
  const [reports, setReports] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [activeTab, setActiveTab] = useState('reports'); // 'reports' | 'dashboard' | 'perks'
  const [toast, setToast] = useState(null);

  // Waste Submission Form State
  const [newReport, setNewReport] = useState({
    description: '',
    wasteType: 'Malata', // 'Malata' (Biodegradable) | 'Dili Malata' (Non-biodegradable)
    locationName: 'Main Street Corner, Zone 2',
    lat: 10.1333,
    lng: 124.85,
    imageUrl: '',
  });

  // Gemini AI Analysis State
  const [aiAnalyzing, setAiAnalyzing] = useState(false);

  // Socket.io Ref
  const socketRef = useRef(null);

  // Trigger Toast Notification
  const showToast = (message, type = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // ---------------------------------------------------------------------------
  // 1. AUTO-SYNC ENGINE: Upload Offline IndexedDB Reports when Online
  // ---------------------------------------------------------------------------
  const syncPendingOfflineReports = useCallback(async () => {
    if (!token || isSyncing) return;

    try {
      const offlineQueue = await getOfflineReports();
      if (!offlineQueue || offlineQueue.length === 0) return;

      setIsSyncing(true);
      let syncedCounter = 0;

      for (const item of offlineQueue) {
        try {
          // Exclude internal IndexedDB tempId before pushing to server
          const { tempId, isOfflineQueued, ...payload } = item;

          await axios.post(`${API_BASE_URL}/reports`, payload, {
            headers: { Authorization: `Bearer ${token}` },
          });

          // Delete from IndexedDB upon successful upload
          await deleteOfflineReport(tempId);
          syncedCounter++;
        } catch (err) {
          console.error(`Failed to sync offline report tempId #${item.tempId}`, err);
          break; // Stop sync loop if server rejects or drops connection
        }
      }

      if (syncedCounter > 0) {
        setSyncCount(syncedCounter);
        showToast(`Successfully synced ${syncedCounter} offline report(s) to the cloud!`, 'success');
        fetchReports();
      }
    } catch (err) {
      console.error('Error in offline sync execution:', err);
    } finally {
      setIsSyncing(false);
    }
  }, [token, isSyncing]);

  useEffect(() => {
    if (isOnline) {
      syncPendingOfflineReports();
    }
  }, [isOnline, syncPendingOfflineReports]);

  // ---------------------------------------------------------------------------
  // 2. DATA FETCHING & WEBSOCKET BROADCASTING
  // ---------------------------------------------------------------------------
  const fetchReports = useCallback(async () => {
    if (!token) return;
    try {
      const res = await axios.get(`${API_BASE_URL}/reports`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setReports(res.data);
    } catch (err) {
      console.error('Error fetching reports:', err);
    }
  }, [token]);

  const fetchAnalytics = useCallback(async () => {
    if (!token || user?.role !== 'Admin') return;
    try {
      const res = await axios.get(`${API_BASE_URL}/analytics`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setAnalytics(res.data);
    } catch (err) {
      console.error('Error fetching analytics:', err);
    }
  }, [token, user]);

  useEffect(() => {
    if (!token) return;

    fetchReports();
    if (user?.role === 'Admin') fetchAnalytics();

    // Initialize WebSockets
    socketRef.current = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
    });

    socketRef.current.on('report_created', (data) => {
      setReports((prev) => [data, ...prev]);
      showToast(`📢 New waste pickup request submitted in ${data.locationName}!`, 'info');
    });

    socketRef.current.on('report_updated', (updated) => {
      setReports((prev) =>
        prev.map((r) => (r._id === updated._id ? updated : r))
      );
      showToast(`✨ Pickup status updated to "${updated.status}"`, 'success');
    });

    return () => {
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, [token, fetchReports, fetchAnalytics, user]);

  // ---------------------------------------------------------------------------
  // 3. AUTHENTICATION HANDLERS
  // ---------------------------------------------------------------------------
  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    const endpoint = authMode === 'login' ? '/auth/login' : '/auth/register';

    try {
      const res = await axios.post(`${API_BASE_URL}${endpoint}`, authFormData);
      const { token: userToken, user: userData } = res.data;

      localStorage.setItem('etapok_token', userToken);
      localStorage.setItem('etapok_user', JSON.stringify(userData));

      setToken(userToken);
      setUser(userData);
      showToast(`Welcome to E-Tapok, ${userData.name}!`, 'success');
    } catch (err) {
      const errMsg = err.response?.data?.message || 'Authentication failed. Please try again.';
      showToast(errMsg, 'error');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('etapok_token');
    localStorage.removeItem('etapok_user');
    setToken('');
    setUser(null);
    setReports([]);
    setAnalytics(null);
    showToast('Signed out successfully.', 'info');
  };

  // ---------------------------------------------------------------------------
  // 4. REPORT SUBMISSION (ONLINE & OFFLINE INTERCEPTION)
  // ---------------------------------------------------------------------------
  const handleCreateReport = async (e) => {
    e.preventDefault();

    const reportPayload = {
      ...newReport,
      residentName: user.name,
      residentId: user._id,
      barangay: user.barangay,
      status: 'Pending',
    };

    // OFFLINE BRANCH
    if (!isOnline) {
      try {
        await saveReportOffline(reportPayload);
        // Optimistic UI update for immediate feedback
        setReports((prev) => [
          { ...reportPayload, _id: `temp_${Date.now()}`, isOfflineQueued: true },
          ...prev,
        ]);
        showToast('📶 You are offline! Report stored locally & queued for auto-sync.', 'warning');
        setNewReport({ ...newReport, description: '', imageUrl: '' });
      } catch (err) {
        showToast('Failed to save report locally.', 'error');
      }
      return;
    }

    // ONLINE BRANCH
    try {
      await axios.post(`${API_BASE_URL}/reports`, reportPayload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      showToast('Waste pickup report created successfully!', 'success');
      setNewReport({ ...newReport, description: '', imageUrl: '' });
      fetchReports();
    } catch (err) {
      showToast('Failed to submit report to server.', 'error');
    }
  };

  // ---------------------------------------------------------------------------
  // 5. GEMINI VISION AI CLASSIFICATION
  // ---------------------------------------------------------------------------
  const handleClassifyWasteWithAI = async () => {
    if (!isOnline) {
      showToast('⚠️ Gemini AI Vision requires an active internet connection.', 'warning');
      return;
    }
    if (!newReport.imageUrl && !newReport.description) {
      showToast('Please provide an image URL or description for AI analysis.', 'warning');
      return;
    }

    setAiAnalyzing(true);
    try {
      const res = await axios.post(
        `${API_BASE_URL}/ai/classify`,
        { description: newReport.description, imageUrl: newReport.imageUrl },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const { category, explanation } = res.data;
      setNewReport((prev) => ({ ...prev, wasteType: category }));
      showToast(`🤖 AI Vision Result: Classified as "${category}"! ${explanation || ''}`, 'info');
    } catch (err) {
      showToast('AI classification failed. Defaulting to manual selection.', 'error');
    } finally {
      setAiAnalyzing(false);
    }
  };

  // ---------------------------------------------------------------------------
  // 6. REPORT STATUS UPDATE (COLLECTOR / ADMIN)
  // ---------------------------------------------------------------------------
  const handleUpdateStatus = async (reportId, newStatus) => {
    try {
      await axios.put(
        `${API_BASE_URL}/reports/${reportId}`,
        { status: newStatus },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      showToast(`Report marked as ${newStatus}`, 'success');
      fetchReports();
    } catch (err) {
      showToast('Failed to update report status.', 'error');
    }
  };

  // ---------------------------------------------------------------------------
  // 7. LGU EXECUTIVE CSV EXPORT
  // ---------------------------------------------------------------------------
  const handleExportCSV = () => {
    if (!reports || reports.length === 0) {
      showToast('No report records available to export.', 'warning');
      return;
    }

    const headers = ['Report ID,Resident Name,Barangay,Waste Type,Location,Status,Created At\n'];
    const rows = reports.map((r) =>
      `"${r._id}","${r.residentName || 'N/A'}","${r.barangay || 'N/A'}","${r.wasteType}","${r.locationName}","${r.status}","${r.createdAt || ''}"`
    );

    const blob = new Blob([headers.concat(rows).join('\n')], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `E-Tapok_Waste_Report_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    showToast('LGU Waste Analytics CSV exported successfully!', 'success');
  };

  // ===========================================================================
  // RENDER: AUTHENTICATION SCREEN
  // ===========================================================================
  if (!token || !user) {
    return (
      <div className="min-h-screen bg-emerald-900 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full">
          <div className="text-center mb-6">
            <h1 className="text-3xl font-extrabold text-emerald-800">🌱 E-Tapok</h1>
            <p className="text-gray-600 text-sm mt-1">
              Smart Municipal Waste Segregation & Reporting Portal
            </p>
          </div>

          <form onSubmit={handleAuthSubmit} className="space-y-4">
            {authMode === 'register' && (
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-emerald-500 outline-none"
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
                className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-emerald-500 outline-none"
                value={authFormData.email}
                onChange={(e) => setAuthFormData({ ...authFormData, email: e.target.value })}
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Password</label>
              <input
                type="password"
                required
                className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-emerald-500 outline-none"
                value={authFormData.password}
                onChange={(e) => setAuthFormData({ ...authFormData, password: e.target.value })}
              />
            </div>

            {authMode === 'register' && (
              <>
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase mb-1">System Role</label>
                  <select
                    className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-emerald-500 outline-none"
                    value={authFormData.role}
                    onChange={(e) => setAuthFormData({ ...authFormData, role: e.target.value })}
                  >
                    <option value="Resident">Resident (Report Waste)</option>
                    <option value="Collector">Garbage Collector (Manage Pickups)</option>
                    <option value="Admin">LGU Barangay Official (Dashboard)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Barangay Zone</label>
                  <input
                    type="text"
                    required
                    className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-emerald-500 outline-none"
                    value={authFormData.barangay}
                    onChange={(e) => setAuthFormData({ ...authFormData, barangay: e.target.value })}
                  />
                </div>
              </>
            )}

            <button
              type="submit"
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-lg shadow-md transition-all"
            >
              {authMode === 'login' ? 'Sign In to Portal' : 'Register Account'}
            </button>
          </form>

          <div className="text-center mt-6">
            <button
              onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
              className="text-emerald-700 hover:underline text-sm font-semibold"
            >
              {authMode === 'login'
                ? "Don't have an account? Register"
                : 'Already have an account? Sign In'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ===========================================================================
  // RENDER: MAIN APPLICATION DASHBOARD
  // ===========================================================================
  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Offline Alert Banner */}
      {!isOnline && (
        <div className="bg-amber-600 text-white text-center py-2 px-4 font-semibold text-sm sticky top-0 z-50 shadow-md flex items-center justify-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-white animate-ping"></span>
          <span>Offline Mode Active — Submissions will save locally and auto-sync when connection restores.</span>
        </div>
      )}

      {/* Auto-Sync Banner */}
      {isSyncing && (
        <div className="bg-blue-600 text-white text-center py-2 px-4 font-semibold text-sm sticky top-0 z-50 shadow-md">
          🔄 Uploading cached offline waste reports to cloud...
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-50 px-5 py-3 rounded-xl shadow-2xl text-white font-medium flex items-center gap-2 ${
            toast.type === 'error'
              ? 'bg-rose-600'
              : toast.type === 'warning'
              ? 'bg-amber-600'
              : toast.type === 'success'
              ? 'bg-emerald-600'
              : 'bg-slate-800'
          }`}
        >
          <span>{toast.message}</span>
        </div>
      )}

      {/* Navigation Header */}
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

      {/* Tab Navigation */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 flex space-x-6">
          <button
            onClick={() => setActiveTab('reports')}
            className={`py-3 text-sm font-bold border-b-2 ${
              activeTab === 'reports'
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            📋 Pickup Reports ({reports.length})
          </button>

          {user.role === 'Admin' && (
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`py-3 text-sm font-bold border-b-2 ${
                activeTab === 'dashboard'
                  ? 'border-emerald-600 text-emerald-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              📊 LGU Analytics Dashboard
            </button>
          )}

          <button
            onClick={() => setActiveTab('perks')}
            className={`py-3 text-sm font-bold border-b-2 ${
              activeTab === 'perks'
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            🏆 Resident Rewards & Score
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 py-6 flex-grow w-full">
        {activeTab === 'reports' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Resident Report Submission Card */}
            {user.role === 'Resident' && (
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
                <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                  <span>📸</span> Report Waste Pickup
                </h2>

                <form onSubmit={handleCreateReport} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">
                      Waste Description / Notes
                    </label>
                    <textarea
                      required
                      rows="3"
                      placeholder="e.g., 2 bags of food scraps and garden trimmings..."
                      className="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                      value={newReport.description}
                      onChange={(e) =>
                        setNewReport({ ...newReport, description: e.target.value })
                      }
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">
                      Waste Image URL (Optional for AI classification)
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="url"
                        placeholder="https://example.com/waste.jpg"
                        className="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                        value={newReport.imageUrl}
                        onChange={(e) =>
                          setNewReport({ ...newReport, imageUrl: e.target.value })
                        }
                      />
                      <button
                        type="button"
                        onClick={handleClassifyWasteWithAI}
                        disabled={aiAnalyzing}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-3 py-2 rounded-lg transition-all whitespace-nowrap"
                      >
                        {aiAnalyzing ? 'Analyzing...' : '🤖 AI Classify'}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">
                      Local Governance Waste Classification
                    </label>
                    <select
                      className="w-full border border-gray-300 rounded-lg p-2.5 text-sm font-semibold focus:ring-2 focus:ring-emerald-500 outline-none"
                      value={newReport.wasteType}
                      onChange={(e) =>
                        setNewReport({ ...newReport, wasteType: e.target.value })
                      }
                    >
                      <option value="Malata">Malata (Biodegradable / Food Waste)</option>
                      <option value="Dili Malata">Dili Malata (Non-Biodegradable / Plastics)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">
                      Pickup Address / Landmark
                    </label>
                    <input
                      type="text"
                      required
                      className="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                      value={newReport.locationName}
                      onChange={(e) =>
                        setNewReport({ ...newReport, locationName: e.target.value })
                      }
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-lg shadow transition-all"
                  >
                    {isOnline ? '🚀 Submit Pickup Request' : '💾 Save Offline Report'}
                  </button>
                </form>
              </div>
            )}

            {/* Reports List View */}
            <div
              className={`space-y-4 ${
                user.role === 'Resident' ? 'lg:col-span-2' : 'lg:col-span-3'
              }`}
            >
              <h2 className="text-lg font-bold text-gray-800">
                Active Barangay Waste Feed
              </h2>

              {reports.length === 0 ? (
                <div className="bg-white p-8 rounded-2xl text-center border border-gray-200 text-gray-500">
                  No waste collection reports recorded yet.
                </div>
              ) : (
                reports.map((report) => (
                  <div
                    key={report._id}
                    className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-4"
                  >
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className={`text-xs font-extrabold px-2.5 py-0.5 rounded-full ${
                            report.wasteType === 'Malata'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {report.wasteType}
                        </span>

                        {report.isOfflineQueued && (
                          <span className="text-xs bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full font-bold">
                            📲 Pending Offline Sync
                          </span>
                        )}

                        <span className="text-xs text-gray-400">
                          {report.createdAt
                            ? new Date(report.createdAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : 'Just now'}
                        </span>
                      </div>

                      <p className="font-semibold text-gray-800">{report.description}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        📍 {report.locationName} • Reported by: {report.residentName || 'Resident'}
                      </p>
                    </div>

                    <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-end">
                      <span
                        className={`text-xs font-bold px-3 py-1 rounded-lg ${
                          report.status === 'Collected'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-orange-100 text-orange-700'
                        }`}
                      >
                        {report.status}
                      </span>

                      {(user.role === 'Collector' || user.role === 'Admin') && (
                        <div className="flex gap-2">
                          {report.status !== 'Collected' && (
                            <button
                              onClick={() => handleUpdateStatus(report._id, 'Collected')}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition"
                            >
                              Mark Collected
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Executive LGU Analytics Dashboard */}
        {activeTab === 'dashboard' && user.role === 'Admin' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-black text-gray-800">LGU Executive Analytics</h2>
              <button
                onClick={handleExportCSV}
                className="bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs px-4 py-2.5 rounded-xl shadow transition"
              >
                📥 Export Master CSV Report
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm text-center">
                <p className="text-xs font-bold text-gray-500 uppercase">Total Reports</p>
                <p className="text-4xl font-extrabold text-emerald-800 mt-2">
                  {reports.length}
                </p>
              </div>

              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm text-center">
                <p className="text-xs font-bold text-gray-500 uppercase">Malata (Biodegradable)</p>
                <p className="text-4xl font-extrabold text-emerald-600 mt-2">
                  {reports.filter((r) => r.wasteType === 'Malata').length}
                </p>
              </div>

              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm text-center">
                <p className="text-xs font-bold text-gray-500 uppercase">Dili Malata (Non-Bio)</p>
                <p className="text-4xl font-extrabold text-amber-600 mt-2">
                  {reports.filter((r) => r.wasteType === 'Dili Malata').length}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Resident Gamified Score & Perks */}
        {activeTab === 'perks' && (
          <div className="bg-white p-8 rounded-2xl border border-gray-200 shadow-sm max-w-2xl mx-auto text-center space-y-4">
            <h2 className="text-2xl font-black text-gray-800">🏆 Eco-Accountability Score</h2>
            <div className="inline-block bg-emerald-100 text-emerald-900 px-6 py-4 rounded-3xl">
              <p className="text-xs font-bold uppercase tracking-wider">Current Rank Tier</p>
              <p className="text-4xl font-extrabold mt-1">🌱 Eco Champion</p>
              <p className="text-sm font-semibold text-emerald-700 mt-1">150 Points Earned</p>
            </div>
            <p className="text-sm text-gray-600">
              Properly segregate waste into <i>Malata</i> and <i>Dili Malata</i> to earn points redeemable for barangay community perks and tax discounts!
            </p>
          </div>
        )}
      </main>
    </div>
  );
}