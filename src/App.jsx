import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { io } from 'socket.io-client';
import L from 'leaflet';

const API_BASE_URL = 'https://etapok-backend.onrender.com/api/e-tapok';
const SOCKET_URL = 'https://etapok-backend.onrender.com';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const createCustomIcon = (color) =>
  new L.Icon({
    iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-${color}.png`,
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41],
  });

const redIcon = createCustomIcon('red');
const greenIcon = createCustomIcon('green');

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('etapok_token') || '');

  // Auth Form States
  const [isRegistering, setIsRegistering] = useState(false);
  const [authName, setAuthName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authRole, setAuthRole] = useState('Resident');
  const [authBarangay, setAuthBarangay] = useState('Brgy. Central');

  // App & Reports States
  const [reports, setReports] = useState([]);
  const [viewMode, setViewMode] = useState('list');
  const [addressText, setAddressText] = useState('');
  const [wasteType, setWasteType] = useState('Malata');
  const [searchQuery, setSearchQuery] = useState('');

  // Analytics State (Phase 3)
  const [analytics, setAnalytics] = useState({
    totalReports: 0,
    pendingReports: 0,
    collectedReports: 0,
    malataCount: 0,
    diliMalataCount: 0,
    collectionRate: 0,
    malataPercentage: 0,
  });

  // AI Helper States
  const [aiInput, setAiInput] = useState('');
  const [imagePreview, setImagePreview] = useState(null);
  const [aiResponse, setAiResponse] = useState(null);
  const [isAiLoading, setIsAiLoading] = useState(false);

  // Rewards & Toasts
  const [showRewardsModal, setShowRewardsModal] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [pointHistory, setPointHistory] = useState([
    { id: 1, action: 'Initial Welcome Bonus', points: '+100', date: 'Account Creation' }
  ]);

  const showToast = (message, type = 'success') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  };

  const fetchUserProfile = async (authToken) => {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      const data = await res.json();
      if (data.success) {
        setCurrentUser(data.user);
      } else {
        handleLogout();
      }
    } catch (err) {
      handleLogout();
    }
  };

  const fetchAnalytics = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE_URL}/reports/analytics`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setAnalytics(data.data);
      }
    } catch (err) {
      console.error('Analytics fetch error:', err);
    }
  };

  useEffect(() => {
    if (token) {
      fetchUserProfile(token);
    }
  }, [token]);

  // Real-Time Socket.io Listeners
  useEffect(() => {
    const socket = io(SOCKET_URL);

    socket.on('report:created', (newReport) => {
      setReports((prev) => [newReport, ...prev.filter((r) => r._id !== newReport._id)]);
      showToast(`📍 New Pickup Request: ${newReport.addressText}`, 'info');
      fetchAnalytics();
    });

    socket.on('report:collected', (updatedReport) => {
      setReports((prev) =>
        prev.map((r) => (r._id === updatedReport._id ? updatedReport : r))
      );
      showToast(`✅ Pickup Completed at ${updatedReport.addressText}`, 'success');
      if (token) fetchUserProfile(token);
      fetchAnalytics();
    });

    socket.on('report:deleted', (deletedId) => {
      setReports((prev) => prev.filter((r) => r._id !== deletedId));
      fetchAnalytics();
    });

    return () => {
      socket.disconnect();
    };
  }, [token]);

  const handleAuth = async (e) => {
    e.preventDefault();
    const endpoint = isRegistering ? '/auth/register' : '/auth/login';
    const payload = isRegistering
      ? { name: authName, email: authEmail, password: authPassword, role: authRole, barangay: authBarangay }
      : { email: authEmail, password: authPassword };

    try {
      const res = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        localStorage.setItem('etapok_token', data.token);
        setToken(data.token);
        setCurrentUser(data.user);
        showToast(`Welcome ${data.user.name}!`, 'success');
      } else {
        showToast(data.message, 'error');
      }
    } catch (err) {
      showToast('Authentication server error', 'error');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('etapok_token');
    setToken('');
    setCurrentUser(null);
  };

  const fetchReports = async () => {
    try {
      const url = searchQuery
        ? `${API_BASE_URL}/reports?search=${encodeURIComponent(searchQuery)}`
        : `${API_BASE_URL}/reports`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.success) {
        setReports(data.data);
      }
    } catch (err) {
      console.error('Error fetching reports:', err);
    }
  };

  useEffect(() => {
    if (currentUser) {
      fetchReports();
      fetchAnalytics();
    }
  }, [currentUser, searchQuery]);

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setImagePreview(reader.result);
      reader.readAsDataURL(file);
    }
  };

  const handleAddReport = async (e) => {
    e.preventDefault();
    if (!addressText) return;

    const mockLat = 10.1333 + (Math.random() - 0.5) * 0.02;
    const mockLng = 124.8500 + (Math.random() - 0.5) * 0.02;

    try {
      const res = await fetch(`${API_BASE_URL}/reports`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          wasteType,
          addressText,
          latitude: mockLat,
          longitude: mockLng,
          aiAssisted: !!aiResponse,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setAddressText('');
        setAiResponse(null);
        setImagePreview(null);
        setAiInput('');
      } else {
        showToast(data.message, 'error');
      }
    } catch (err) {
      showToast('Failed to submit report', 'error');
    }
  };

  const handleCollect = async (id) => {
    try {
      const res = await fetch(`${API_BASE_URL}/reports/${id}/collect`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await res.json();
      if (data.success) {
        setPointHistory((prev) => [
          { id: Date.now(), action: 'Valid Pickup Confirmed', points: '+10', date: 'Just now' },
          ...prev,
        ]);
      } else {
        showToast(data.message, 'error');
      }
    } catch (err) {
      showToast('Failed to mark as collected', 'error');
    }
  };

  const handleDelete = async (id) => {
    try {
      const res = await fetch(`${API_BASE_URL}/reports/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (!data.success) {
        showToast(data.message, 'error');
      }
    } catch (err) {
      showToast('Failed to cancel request', 'error');
    }
  };

  const handleAiCheck = async () => {
    if (!aiInput && !imagePreview) return;
    setIsAiLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/ai/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemDescription: aiInput, imageBase64: imagePreview }),
      });
      const data = await res.json();
      if (data.success) {
        setAiResponse(data.data);
        setWasteType(data.data.classification);
        showToast(`AI Classified: ${data.data.classification}`, 'info');
      }
    } catch (err) {
      showToast('AI classification failed', 'error');
    } finally {
      setIsAiLoading(false);
    }
  };

  // CSV Export Handler for LGU Reports
  const exportCSV = () => {
    const headers = ['Report ID,Waste Type,Status,Address,Created At\n'];
    const rows = reports.map(
      (r) => `${r._id},${r.wasteType},${r.status},"${r.addressText.replace(/"/g, '""')}",${r.createdAt}`
    );
    const blob = new Blob([headers.concat(rows).join('\n')], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `E-Tapok_LGU_Report_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    showToast('LGU waste report downloaded (.CSV)', 'success');
  };

  const StatusBadge = ({ status }) => (
    <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
      status === 'Collected' ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : 'bg-amber-100 text-amber-800 border border-amber-300'
    }`}>
      {status === 'Collected' ? '✓ Collected' : '⏳ Pending'}
    </span>
  );

  const score = currentUser?.accountabilityScore || 100;
  const nextMilestone = score >= 200 ? 500 : score >= 100 ? 200 : 100;
  const progressPercent = Math.min(100, Math.round((score / nextMilestone) * 100));

  if (!currentUser) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4 font-sans">
        <div className="bg-white p-6 rounded-lg shadow-md w-full max-w-md border border-gray-200">
          <h1 className="text-2xl font-bold text-center text-green-700 mb-1">E-Tapok Portal</h1>
          <p className="text-xs text-center text-gray-500 mb-6">
            {isRegistering ? 'Create a new account' : 'Sign in to access your portal'}
          </p>

          <form onSubmit={handleAuth} className="space-y-3">
            {isRegistering && (
              <>
                <input
                  type="text"
                  placeholder="Full Name"
                  className="w-full border p-2 rounded text-sm"
                  value={authName}
                  onChange={(e) => setAuthName(e.target.value)}
                  required
                />
                <input
                  type="text"
                  placeholder="Barangay / Zone"
                  className="w-full border p-2 rounded text-sm"
                  value={authBarangay}
                  onChange={(e) => setAuthBarangay(e.target.value)}
                  required
                />
                <select
                  className="w-full border p-2 rounded text-sm bg-white"
                  value={authRole}
                  onChange={(e) => setAuthRole(e.target.value)}
                >
                  <option value="Resident">Resident Role</option>
                  <option value="Collector">Garbage Collector Role</option>
                  <option value="Admin">Barangay Admin / LGU Official</option>
                </select>
              </>
            )}

            <input
              type="email"
              placeholder="Email Address"
              className="w-full border p-2 rounded text-sm"
              value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)}
              required
            />
            <input
              type="password"
              placeholder="Password"
              className="w-full border p-2 rounded text-sm"
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
              required
            />

            <button
              type="submit"
              className="w-full bg-green-600 text-white p-2 rounded font-bold hover:bg-green-700 text-sm cursor-pointer"
            >
              {isRegistering ? 'Register Account' : 'Sign In'}
            </button>
          </form>

          <div className="mt-4 text-center">
            <button
              onClick={() => setIsRegistering(!isRegistering)}
              className="text-xs text-blue-600 hover:underline font-semibold cursor-pointer"
            >
              {isRegistering ? 'Already have an account? Sign In' : "Don't have an account? Register"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto font-sans relative">
      <div className="fixed top-5 right-5 z-50 space-y-2 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto px-4 py-3 rounded-lg shadow-lg text-white font-medium text-sm flex items-center justify-between min-w-64 ${
              toast.type === 'success' ? 'bg-emerald-600' : toast.type === 'error' ? 'bg-rose-600' : 'bg-blue-600'
            }`}
          >
            <span>{toast.message}</span>
          </div>
        ))}
      </div>

      <div className="flex justify-between items-center mb-8 border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold text-green-700">E-Tapok System</h1>
          <p className="text-xs text-gray-500">
            Logged in as: <strong className="text-gray-800">{currentUser.name}</strong> ({currentUser.role} - {currentUser.barangay})
          </p>
        </div>
        <button onClick={handleLogout} className="text-xs bg-red-50 text-red-600 px-3 py-1.5 rounded border border-red-200 font-semibold cursor-pointer">
          Logout
        </button>
      </div>

      {currentUser.role === 'Resident' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            <div className="bg-gradient-to-br from-green-50 to-emerald-100 p-5 rounded-lg mb-6 border border-green-300 shadow-sm">
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="font-bold text-gray-700 text-sm">Accountability Score</h2>
                  <p className="text-3xl font-extrabold text-green-700">{score} pts</p>
                </div>
                <span className="text-2xl">{score >= 200 ? '🥇' : score >= 100 ? '🥈' : '🥉'}</span>
              </div>

              <div className="mt-3">
                <div className="flex justify-between text-xs font-semibold text-gray-600 mb-1">
                  <span>Level: {score >= 200 ? 'Zero-Waste Champion' : score >= 100 ? 'Green Citizen' : 'Eco Novice'}</span>
                  <span>{score}/{nextMilestone} pts</span>
                </div>
                <div className="w-full bg-gray-200 h-2 rounded-full overflow-hidden">
                  <div className="bg-green-600 h-full transition-all duration-500" style={{ width: `${progressPercent}%` }}></div>
                </div>
              </div>

              <button
                onClick={() => setShowRewardsModal(!showRewardsModal)}
                className="mt-3 w-full bg-white text-green-800 border border-green-300 font-semibold py-1.5 px-3 rounded text-xs hover:bg-green-50 cursor-pointer shadow-xs"
              >
                🎁 View Perks & Point History
              </button>
            </div>

            {showRewardsModal && (
              <div className="bg-white p-4 rounded-lg shadow border border-green-200 mb-6 text-xs">
                <h4 className="font-bold text-gray-800 text-sm mb-2 border-b pb-1">Redeemable Barangay Perks</h4>
                <ul className="space-y-2 mb-4">
                  <li className="flex justify-between items-center p-2 bg-gray-50 rounded border">
                    <span>🌱 Free Vegetable Seed Packets</span>
                    <span className="font-bold text-green-700">50 pts</span>
                  </li>
                  <li className="flex justify-between items-center p-2 bg-gray-50 rounded border">
                    <span>📄 50% Off Barangay Clearance Fee</span>
                    <span className="font-bold text-green-700">150 pts</span>
                  </li>
                </ul>

                <h4 className="font-bold text-gray-800 text-sm mb-2 border-b pb-1">Point History</h4>
                <ul className="space-y-1">
                  {pointHistory.map((item) => (
                    <li key={item.id} className="flex justify-between text-gray-600 py-1 border-b border-gray-100">
                      <span>{item.action} ({item.date})</span>
                      <span className="font-bold text-green-600">{item.points}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="bg-white p-4 rounded shadow border">
              <h3 className="font-bold mb-2 text-sm">AI Waste Segregation Helper</h3>
              <input
                type="text"
                placeholder="e.g. Banana peel, plastic bottle"
                className="w-full border p-2 rounded mb-2 text-sm"
                value={aiInput}
                onChange={(e) => setAiInput(e.target.value)}
              />

              <div className="mb-3">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageChange}
                  className="w-full text-xs text-gray-500 file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 cursor-pointer"
                />
                {imagePreview && <img src={imagePreview} alt="Preview" className="w-16 h-16 mt-2 object-cover rounded border" />}
              </div>

              <button
                onClick={handleAiCheck}
                disabled={isAiLoading || (!aiInput && !imagePreview)}
                className="w-full bg-blue-600 text-white p-2 rounded font-semibold text-sm cursor-pointer disabled:opacity-50"
              >
                {isAiLoading ? 'Analyzing...' : 'Ask AI Vision Classifier'}
              </button>

              {aiResponse && (
                <div className="text-xs p-3 bg-gray-50 border rounded mt-2">
                  <p className="font-bold text-green-700">{aiResponse.classification}</p>
                  <p className="mt-1">{aiResponse.explanation}</p>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white p-4 rounded shadow border">
            <h3 className="font-bold mb-4 text-sm">Report Garbage Out</h3>
            <form onSubmit={handleAddReport} className="mb-6">
              <input
                type="text"
                placeholder="Exact Location (e.g., Gate 3, Mabini St.)"
                className="w-full border p-2 rounded mb-2 text-sm"
                value={addressText}
                onChange={(e) => setAddressText(e.target.value)}
                required
              />
              <select
                className="w-full border p-2 rounded mb-2 text-sm bg-white"
                value={wasteType}
                onChange={(e) => setWasteType(e.target.value)}
              >
                <option value="Malata">Malata (Biodegradable)</option>
                <option value="Dili Malata">Dili Malata (Non-Biodegradable)</option>
              </select>
              <button type="submit" className="w-full bg-green-600 text-white p-2 rounded font-semibold text-sm cursor-pointer">
                Submit Pickup Request
              </button>
            </form>

            <h3 className="font-bold mb-2 text-sm">My Active Reports</h3>
            <ul className="space-y-2">
              {reports.filter((r) => r.status === 'Pending').map((report) => (
                <li key={report._id} className="flex justify-between items-center bg-gray-50 p-3 rounded border text-sm">
                  <div>
                    <div className="flex items-center space-x-2 mb-1">
                      <span className="font-bold">{report.wasteType}</span>
                      <StatusBadge status={report.status} />
                    </div>
                    <span className="text-xs text-gray-600">{report.addressText}</span>
                  </div>
                  <button onClick={() => handleDelete(report._id)} className="text-red-500 font-semibold text-xs cursor-pointer">
                    Cancel
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {currentUser.role === 'Collector' && (
        <div className="bg-white p-4 rounded shadow border">
          <div className="flex justify-between items-center mb-4">
            <input
              type="text"
              placeholder="Search by street or waste type..."
              className="border p-2 rounded text-sm w-2/3"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />

            <div className="flex bg-gray-100 p-1 rounded border">
              <button
                onClick={() => setViewMode('list')}
                className={`px-3 py-1 rounded text-xs font-bold cursor-pointer ${
                  viewMode === 'list' ? 'bg-white shadow text-green-700' : 'text-gray-600'
                }`}
              >
                List View
              </button>
              <button
                onClick={() => setViewMode('map')}
                className={`px-3 py-1 rounded text-xs font-bold cursor-pointer ${
                  viewMode === 'map' ? 'bg-white shadow text-green-700' : 'text-gray-600'
                }`}
              >
                Map View
              </button>
            </div>
          </div>

          <h3 className="font-bold mb-3 text-sm">
            Active Pickup Points ({reports.filter((r) => r.status === 'Pending').length})
          </h3>

          {viewMode === 'list' ? (
            <div className="space-y-3">
              {reports.map((report) => (
                <div key={report._id} className="p-4 rounded border flex justify-between items-center bg-white">
                  <div>
                    <h4 className="font-bold text-base">{report.addressText}</h4>
                    <div className="flex items-center space-x-2 mt-1">
                      <span className={`px-2 py-0.5 rounded text-xs text-white font-medium ${report.wasteType === 'Malata' ? 'bg-green-600' : 'bg-gray-600'}`}>
                        {report.wasteType}
                      </span>
                      <StatusBadge status={report.status} />
                    </div>
                  </div>
                  {report.status === 'Pending' && (
                    <button onClick={() => handleCollect(report._id)} className="bg-orange-500 text-white px-4 py-2 rounded font-bold text-sm cursor-pointer">
                      Mark Collected
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="h-96 w-full rounded border overflow-hidden">
              <MapContainer center={[10.1333, 124.8500]} zoom={14} style={{ height: '100%', width: '100%' }}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                {reports.map((report) => (
                  <Marker
                    key={report._id}
                    position={[report.latitude || 10.1333, report.longitude || 124.8500]}
                    icon={report.status === 'Collected' ? greenIcon : redIcon}
                  >
                    <Popup>
                      <div className="p-1">
                        <h4 className="font-bold text-sm">{report.addressText}</h4>
                        <p className="text-xs text-gray-600 mt-1">Type: {report.wasteType}</p>
                        {report.status === 'Pending' && (
                          <button onClick={() => handleCollect(report._id)} className="bg-orange-500 text-white px-2 py-1 rounded text-xs font-bold w-full mt-2 cursor-pointer">
                            Mark Collected
                          </button>
                        )}
                      </div>
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            </div>
          )}
        </div>
      )}

      {/* Phase 3: Barangay Admin & LGU Analytics View */}
      {currentUser.role === 'Admin' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold text-gray-800">Barangay Executive Analytics Dashboard</h2>
            <button
              onClick={exportCSV}
              className="bg-green-700 text-white px-4 py-2 rounded text-xs font-bold hover:bg-green-800 shadow cursor-pointer flex items-center space-x-1"
            >
              <span>📥 Export LGU Report (.CSV)</span>
            </button>
          </div>

          {/* Key Metrics Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded shadow border border-gray-200">
              <p className="text-xs font-semibold text-gray-500">Total Reports Logged</p>
              <p className="text-2xl font-black text-gray-800">{analytics.totalReports}</p>
            </div>
            <div className="bg-white p-4 rounded shadow border border-gray-200">
              <p className="text-xs font-semibold text-gray-500">Pending Pickups</p>
              <p className="text-2xl font-black text-amber-600">{analytics.pendingReports}</p>
            </div>
            <div className="bg-white p-4 rounded shadow border border-gray-200">
              <p className="text-xs font-semibold text-gray-500">Collection Efficiency</p>
              <p className="text-2xl font-black text-emerald-600">{analytics.collectionRate}%</p>
            </div>
            <div className="bg-white p-4 rounded shadow border border-gray-200">
              <p className="text-xs font-semibold text-gray-500">Malata Segregation Ratio</p>
              <p className="text-2xl font-black text-blue-600">{analytics.malataPercentage}%</p>
            </div>
          </div>

          {/* Waste Breakdown Bar */}
          <div className="bg-white p-5 rounded shadow border border-gray-200">
            <h3 className="font-bold text-sm text-gray-800 mb-3">Waste Category Breakdown</h3>
            <div className="w-full bg-gray-200 h-4 rounded-full overflow-hidden flex">
              <div
                className="bg-green-600 h-full transition-all duration-500"
                style={{ width: `${analytics.malataPercentage}%` }}
              ></div>
              <div
                className="bg-gray-600 h-full transition-all duration-500"
                style={{ width: `${100 - analytics.malataPercentage}%` }}
              ></div>
            </div>
            <div className="flex justify-between text-xs font-semibold mt-2">
              <span className="text-green-700">🌱 Malata (Biodegradable): {analytics.malataCount}</span>
              <span className="text-gray-700">📦 Dili Malata (Non-Bio): {analytics.diliMalataCount}</span>
            </div>
          </div>

          {/* All Barangay Master Log Table */}
          <div className="bg-white p-4 rounded shadow border border-gray-200">
            <h3 className="font-bold text-sm text-gray-800 mb-3">All Live Pickup Requests</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-100 border-b text-gray-700">
                    <th className="p-2 font-bold">Location</th>
                    <th className="p-2 font-bold">Category</th>
                    <th className="p-2 font-bold">Status</th>
                    <th className="p-2 font-bold">Date Created</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((r) => (
                    <tr key={r._id} className="border-b hover:bg-gray-50">
                      <td className="p-2 font-semibold text-gray-800">{r.addressText}</td>
                      <td className="p-2">
                        <span className={`px-2 py-0.5 rounded text-white text-[10px] font-bold ${r.wasteType === 'Malata' ? 'bg-green-600' : 'bg-gray-600'}`}>
                          {r.wasteType}
                        </span>
                      </td>
                      <td className="p-2">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="p-2 text-gray-500">{new Date(r.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}