import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import BottomNav from './components/BottomNav';
import MonthlyCheckNag from './components/MonthlyCheckNag';
import Login from './pages/Login';
import ProfileSetup from './pages/ProfileSetup';
import ProfileEdit from './pages/ProfileEdit';
import ThankYouCalls from './pages/ThankYouCalls';
import AuStyleBonus from './pages/AuStyleBonus';
import PointSettings from './pages/PointSettings';
import KddiResults from './pages/KddiResults';
import BotSend from './pages/BotSend';
import DataCleanup from './pages/DataCleanup';
import Home from './pages/Home';
import Report from './pages/Report';
import TargetDashboard from './pages/TargetDashboard';
import TargetSetting from './pages/TargetSetting';
import PersonalTarget from './pages/PersonalTarget';
import PersonalIncentive from './pages/PersonalIncentive';
import StoreMonthlyCheck from './pages/StoreMonthlyCheck';
import Manage from './pages/Manage';
import KpiDashboard from './pages/KpiDashboard';
import EventSummary from './pages/EventSummary';
import Pipeline from './pages/Pipeline';
import IncentiveSettings from './pages/IncentiveSettings';
import ExcelExport from './pages/ExcelExport';

function Protected({ children }) {
  const { user, profile, loading } = useAuth();
  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0F0D1A', color: '#FBBF24', fontSize: 14 }}>読み込み中…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!profile) return <ProfileSetup />;   // 初回：プロフィール未登録なら登録画面
  return children;
}

function Layout() {
  return (
    <div style={{ minHeight: '100vh', background: '#0F0D1A', color: '#fff', paddingBottom: 72 }}>
      <MonthlyCheckNag />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/report" element={<Report />} />
        <Route path="/target" element={<TargetDashboard />} />
        <Route path="/target-setting" element={<TargetSetting />} />
        <Route path="/me" element={<PersonalTarget />} />
        <Route path="/incentive" element={<PersonalIncentive />} />
        <Route path="/monthly-check" element={<StoreMonthlyCheck />} />
        <Route path="/manage" element={<Manage />} />
        <Route path="/kpi" element={<KpiDashboard />} />
        <Route path="/events" element={<EventSummary />} />
        <Route path="/pipeline" element={<Pipeline />} />
        <Route path="/incentive-settings" element={<IncentiveSettings />} />
        <Route path="/excel" element={<ExcelExport />} />
        <Route path="/profile-edit" element={<ProfileEdit />} />
        <Route path="/thank-you-calls" element={<ThankYouCalls />} />
        <Route path="/austyle-bonus" element={<AuStyleBonus />} />
        <Route path="/point-settings" element={<PointSettings />} />
        <Route path="/kddi-results" element={<KddiResults />} />
        <Route path="/bot-send" element={<BotSend />} />
        <Route path="/data-cleanup" element={<DataCleanup />} />
      </Routes>
      <BottomNav />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/*" element={<Protected><Layout /></Protected>} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
