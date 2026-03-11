import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Trades from "./pages/Trades";
import Emotions from "./pages/Emotions";
import Analytics from "./pages/Analytics";
import { AnalyticsErrorBoundary } from "./components/AnalyticsErrorBoundary";
import { PageErrorBoundary } from "./components/PageErrorBoundary";
import CalendarPage from "./pages/Calendar";
import Strategies from "./pages/Strategies";
import Journal from "./pages/Journal";
import Documentation from "./pages/Documentation";
import Evaluation from "./pages/Evaluation";
import Tools from "./pages/Tools";
import Settings from "./pages/Settings";

function App() {
  return (
    <Router>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/trades" element={<PageErrorBoundary pageName="Trades"><Trades /></PageErrorBoundary>} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/strategies" element={<Strategies />} />
          <Route path="/journal" element={<Journal />} />
          <Route path="/resources" element={<Documentation />} />
          <Route path="/emotions" element={<PageErrorBoundary pageName="Emotions"><Emotions /></PageErrorBoundary>} />
          <Route path="/analytics" element={<AnalyticsErrorBoundary><Analytics /></AnalyticsErrorBoundary>} />
          <Route path="/evaluation" element={<Evaluation />} />
          <Route path="/tools" element={<Tools />} />
          <Route path="/average-down-calculator" element={<Navigate to="/tools" replace />} />
          <Route path="/dividend-calculator" element={<Navigate to="/tools?calc=dividend" replace />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </Layout>
    </Router>
  );
}

export default App;

