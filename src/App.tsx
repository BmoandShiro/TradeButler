import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Trades from "./pages/Trades";
import Emotions from "./pages/Emotions";
import Analytics from "./pages/Analytics";
import CalendarPage from "./pages/Calendar";
import Strategies from "./pages/Strategies";
import Evaluation from "./pages/Evaluation";

function App() {
  return (
    <Router>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/trades" element={<Trades />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/strategies" element={<Strategies />} />
          <Route path="/emotions" element={<Emotions />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/evaluation" element={<Evaluation />} />
        </Routes>
      </Layout>
    </Router>
  );
}

export default App;

