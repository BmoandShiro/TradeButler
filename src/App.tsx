import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Trades from "./pages/Trades";
import Emotions from "./pages/Emotions";
import Analytics from "./pages/Analytics";
import CalendarPage from "./pages/Calendar";

function App() {
  return (
    <Router>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/trades" element={<Trades />} />
          <Route path="/emotions" element={<Emotions />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/calendar" element={<CalendarPage />} />
        </Routes>
      </Layout>
    </Router>
  );
}

export default App;

